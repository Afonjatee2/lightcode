import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  ProjectLocation,
  PrData,
  PrState,
  PrCheck,
  PrFile,
  PrReviewDecision,
  GhCheckAvailableResult,
  GhGetPrChecksResult,
  GhGetPrFilesResult,
  GhGetPrDiffResult,
} from "@/shared/contracts";
import { toWslUncPath } from "@/shared/wsl";
import { buildAgentCommand, parallelWslCommandsAsync, quotePosixShellArg } from "./agents/base";

const execFileAsync = promisify(execFile);
const GH_TIMEOUT = 30_000;

// `gh` reports an unreachable remote with the GraphQL message
// "Could not resolve to a Repository with the name '<owner>/<name>'". This
// happens when the git remote points at a repo that doesn't exist on GitHub
// or that the authenticated user can't see (renamed, private, transferred).
// Polling endpoints treat this as "no PR" so the UI doesn't surface a toast
// on every branch change.
function isRepoNotFoundError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  return (
    lower.includes("could not resolve to a repository") ||
    lower.includes("no such repository") ||
    lower.includes("repository not found")
  );
}

function classifyError(error: unknown, operation: string): Error {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  if (
    lower.includes("command not found") ||
    lower.includes("is not recognized") ||
    lower.includes("enoent")
  ) {
    return new Error(
      `GitHub CLI (gh) is not installed or not on PATH. Install it from https://cli.github.com`,
    );
  }

  if (
    lower.includes("authentication failed") ||
    lower.includes("not logged in") ||
    lower.includes("gh auth login") ||
    lower.includes("no oauth token")
  ) {
    return new Error(`GitHub CLI is not authenticated. Run "gh auth login" in the terminal.`);
  }

  return new Error(`gh ${operation} failed: ${msg}`);
}

async function runGh(location: ProjectLocation, args: string[]): Promise<string> {
  const spec = buildAgentCommand(location, "gh", args);
  const { stdout } = await execFileAsync(spec.command, spec.args, {
    windowsHide: true,
    timeout: GH_TIMEOUT,
    cwd: spec.cwd,
    env: spec.env ? { ...process.env, ...spec.env } : process.env,
  });
  return stdout;
}

function mapPrState(raw: { state: string; isDraft: boolean }): PrState {
  if (raw.isDraft) return "draft";
  const s = raw.state?.toUpperCase?.() ?? "";
  if (s === "MERGED") return "merged";
  if (s === "CLOSED") return "closed";
  return "open";
}

const FAILURE_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

// `gh pr {list,view} --json statusCheckRollup` returns an array of CheckRun
// (status/conclusion) and StatusContext (state) entries — not a single string.
// Aggregate so any failing check turns the PR red, even when later checks
// finish green; otherwise stay yellow until everything completes.
export function aggregateChecksStatus(rollup: unknown): string | undefined {
  if (!Array.isArray(rollup) || rollup.length === 0) return undefined;
  let hasPending = false;
  for (const entry of rollup) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const state = typeof e.state === "string" ? e.state.toUpperCase() : "";
    if (state === "ERROR" || state === "FAILURE") return "FAILURE";
    if (state === "PENDING" || state === "EXPECTED") {
      hasPending = true;
      continue;
    }
    const conclusion = typeof e.conclusion === "string" ? e.conclusion.toUpperCase() : "";
    if (FAILURE_CONCLUSIONS.has(conclusion)) return "FAILURE";
    const status = typeof e.status === "string" ? e.status.toUpperCase() : "";
    if (status && status !== "COMPLETED") hasPending = true;
  }
  return hasPending ? "PENDING" : "SUCCESS";
}

function mapPrData(raw: Record<string, unknown>, viewerLogin?: string): PrData {
  const result: PrData = {
    number: raw.number as number,
    state: mapPrState({ state: raw.state as string, isDraft: raw.isDraft as boolean }),
    title: (raw.title as string) ?? "",
    url: (raw.url as string) ?? "",
    baseBranch: (raw.baseRefName as string) ?? "",
    isDraft: (raw.isDraft as boolean) ?? false,
    updatedAt: (raw.updatedAt as string) ?? "",
  };
  const rd = raw.reviewDecision as string | undefined;
  if (rd) result.reviewDecision = rd;
  const author = raw.author as { login?: unknown } | null | undefined;
  const authorLogin = author && typeof author.login === "string" ? author.login : undefined;
  if (authorLogin && viewerLogin) {
    result.viewerDidAuthor = authorLogin === viewerLogin;
  }
  const cs = aggregateChecksStatus(raw.statusCheckRollup);
  if (cs) result.checksStatus = cs;
  const mergeable = typeof raw.mergeable === "string" ? raw.mergeable : undefined;
  if (mergeable === "MERGEABLE" || mergeable === "CONFLICTING" || mergeable === "UNKNOWN") {
    result.mergeable = mergeable;
  }
  const mss = typeof raw.mergeStateStatus === "string" ? raw.mergeStateStatus : undefined;
  if (
    mss === "BEHIND" ||
    mss === "BLOCKED" ||
    mss === "CLEAN" ||
    mss === "DIRTY" ||
    mss === "DRAFT" ||
    mss === "HAS_HOOKS" ||
    mss === "UNKNOWN" ||
    mss === "UNSTABLE"
  ) {
    result.mergeStateStatus = mss;
  }
  return result;
}

/** Stable cache key for {@link GitHubService.viewerLoginCache}. */
function locationKey(location: ProjectLocation): string {
  if (location.kind === "wsl") return `wsl:${location.distro}:${location.linuxPath}`;
  return `${location.kind}:${location.path}`;
}

export class GitHubService {
  /** `gh api user` is the same answer per (kind, path) — cache to avoid one call per PR fetch. */
  private viewerLoginCache = new Map<string, string | null>();

  async checkGhAvailable(location: ProjectLocation): Promise<GhCheckAvailableResult> {
    try {
      await runGh(location, ["--version"]);
      return { available: true };
    } catch {
      return { available: false };
    }
  }

  private async getViewerLogin(location: ProjectLocation): Promise<string | undefined> {
    const key = locationKey(location);
    const cached = this.viewerLoginCache.get(key);
    if (cached !== undefined) return cached ?? undefined;
    try {
      const stdout = await runGh(location, ["api", "user", "--jq", ".login"]);
      const login = stdout.trim();
      this.viewerLoginCache.set(key, login || null);
      return login || undefined;
    } catch {
      this.viewerLoginCache.set(key, null);
      return undefined;
    }
  }

  async createPr(
    location: ProjectLocation,
    branch: string,
    baseBranch: string,
    title: string,
    body: string,
    isDraft: boolean,
  ): Promise<PrData> {
    // Write body to temp file to avoid shell escaping issues. For WSL projects,
    // gh runs inside the distro and can't read a Windows path, so write into
    // the distro's /tmp via UNC and pass the Linux path to --body-file.
    const filename = `lightcode-pr-body-${Date.now()}.md`;
    const writePath =
      location.kind === "wsl"
        ? toWslUncPath(location.distro, `/tmp/${filename}`)
        : join(tmpdir(), filename);
    const cliPath = location.kind === "wsl" ? `/tmp/${filename}` : writePath;
    try {
      await writeFile(writePath, body, "utf-8");
      const createArgs = [
        "pr",
        "create",
        "--base",
        baseBranch,
        "--head",
        branch,
        "--title",
        title,
        "--body-file",
        cliPath,
        ...(isDraft ? ["--draft"] : []),
      ];
      await runGh(location, createArgs);

      // gh pr create doesn't support --json; fetch the new PR via gh pr view
      const [viewStdout, viewerLogin] = await Promise.all([
        runGh(location, [
          "pr",
          "view",
          branch,
          "--json",
          "number,url,state,title,baseRefName,isDraft,reviewDecision,statusCheckRollup,updatedAt,mergeable,mergeStateStatus,author",
        ]),
        this.getViewerLogin(location),
      ]);
      return mapPrData(JSON.parse(viewStdout), viewerLogin);
    } catch (err) {
      throw classifyError(err, "pr create");
    } finally {
      await unlink(writePath).catch(() => {});
    }
  }

  async getPrForBranch(location: ProjectLocation, branch: string): Promise<PrData | null> {
    const prListArgs = [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "all",
      "--limit",
      "1",
      "--json",
      "number,url,state,title,baseRefName,isDraft,reviewDecision,statusCheckRollup,updatedAt,mergeable,mergeStateStatus,author",
    ];

    // WSL: collapse `gh pr list` + `gh api user` (for viewerDidAuthor) into a
    // single wsl.exe spawn running the two gh calls in parallel. Saves one
    // bash-init cycle (~500–1000ms on cold paths).
    if (location.kind === "wsl") {
      const cachedLogin = this.viewerLoginCache.get(locationKey(location));
      const needsLogin = cachedLogin === undefined;
      const commands = [
        { cwd: location.linuxPath, cmd: `gh ${prListArgs.map(quotePosixShellArg).join(" ")}` },
        ...(needsLogin ? [{ cwd: location.linuxPath, cmd: `gh api user --jq .login` }] : []),
      ];
      try {
        const results = await parallelWslCommandsAsync(location.distro, commands, {
          timeoutMs: GH_TIMEOUT,
        });
        const prResult = results[0]!;
        if (!prResult.ok) {
          throw new Error(`gh pr list exited ${prResult.exitCode}`);
        }
        let viewerLogin: string | undefined;
        if (needsLogin && results[1]?.ok) {
          viewerLogin = results[1].stdout.trim() || undefined;
          this.viewerLoginCache.set(locationKey(location), viewerLogin ?? null);
        } else if (cachedLogin) {
          viewerLogin = cachedLogin;
        }
        const items = JSON.parse(prResult.stdout);
        if (!Array.isArray(items) || items.length === 0) return null;
        return mapPrData(items[0], viewerLogin);
      } catch (err) {
        throw classifyError(err, "pr list");
      }
    }

    // Non-WSL: per-call spawn overhead is negligible — keep simple Promise.all.
    try {
      const [stdout, viewerLogin] = await Promise.all([
        runGh(location, prListArgs),
        this.getViewerLogin(location),
      ]);
      const items = JSON.parse(stdout);
      if (!Array.isArray(items) || items.length === 0) return null;
      return mapPrData(items[0], viewerLogin);
    } catch (err) {
      if (isRepoNotFoundError(err)) return null;
      throw classifyError(err, "pr list");
    }
  }

  async mergePr(
    location: ProjectLocation,
    prNumber: number,
    method: "merge" | "squash" | "rebase",
    admin = false,
  ): Promise<void> {
    try {
      const args = ["pr", "merge", String(prNumber), `--${method}`, "--delete-branch"];
      if (admin) args.push("--admin");
      await runGh(location, args);
    } catch (err) {
      throw classifyError(err, "pr merge");
    }
  }

  async closePr(location: ProjectLocation, prNumber: number): Promise<void> {
    try {
      await runGh(location, ["pr", "close", String(prNumber)]);
    } catch (err) {
      throw classifyError(err, "pr close");
    }
  }

  async reopenPr(location: ProjectLocation, prNumber: number): Promise<void> {
    try {
      await runGh(location, ["pr", "reopen", String(prNumber)]);
    } catch (err) {
      throw classifyError(err, "pr reopen");
    }
  }

  async markPrReady(location: ProjectLocation, prNumber: number): Promise<void> {
    try {
      await runGh(location, ["pr", "ready", String(prNumber)]);
    } catch (err) {
      throw classifyError(err, "pr ready");
    }
  }

  /** `gh pr update-branch <n>` — merge (or rebase) the base branch into the PR branch. */
  async updatePrBranch(location: ProjectLocation, prNumber: number, rebase = false): Promise<void> {
    try {
      const args = ["pr", "update-branch", String(prNumber)];
      if (rebase) args.push("--rebase");
      await runGh(location, args);
    } catch (err) {
      throw classifyError(err, "pr update-branch");
    }
  }

  async getPrChecks(location: ProjectLocation, branch: string): Promise<GhGetPrChecksResult> {
    try {
      const stdout = await runGh(location, [
        "pr",
        "checks",
        branch,
        "--json",
        "name,state,conclusion",
      ]);
      const items = JSON.parse(stdout);
      const checks: PrCheck[] = Array.isArray(items)
        ? items.map((c: Record<string, string>) => ({
            name: c.name ?? "",
            state: c.state ?? "",
            conclusion: c.conclusion ?? "",
          }))
        : [];
      return { checks };
    } catch (err) {
      throw classifyError(err, "pr checks");
    }
  }

  async getPrFiles(location: ProjectLocation, prNumber: number): Promise<GhGetPrFilesResult> {
    try {
      const stdout = await runGh(location, ["pr", "view", String(prNumber), "--json", "files"]);
      const parsed = JSON.parse(stdout) as { files?: unknown };
      const raw = Array.isArray(parsed.files) ? parsed.files : [];
      const files: PrFile[] = raw.map((entry) => {
        const e = entry as Record<string, unknown>;
        return {
          path: typeof e.path === "string" ? e.path : "",
          additions: typeof e.additions === "number" ? e.additions : 0,
          deletions: typeof e.deletions === "number" ? e.deletions : 0,
        };
      });
      return { files };
    } catch (err) {
      throw classifyError(err, "pr view --json files");
    }
  }

  async getPrDiff(location: ProjectLocation, prNumber: number): Promise<GhGetPrDiffResult> {
    try {
      const stdout = await runGh(location, ["pr", "diff", String(prNumber)]);
      return { diff: stdout };
    } catch (err) {
      throw classifyError(err, "pr diff");
    }
  }

  async submitPrReview(
    location: ProjectLocation,
    prNumber: number,
    decision: PrReviewDecision,
    body: string,
  ): Promise<void> {
    const flag =
      decision === "approve"
        ? "--approve"
        : decision === "request-changes"
          ? "--request-changes"
          : "--comment";
    const trimmed = body ?? "";
    if (decision !== "approve" && trimmed.trim().length === 0) {
      throw new Error("Review body is required for comment and request-changes.");
    }

    if (trimmed.length === 0) {
      try {
        await runGh(location, ["pr", "review", String(prNumber), flag]);
        return;
      } catch (err) {
        throw classifyError(err, "pr review");
      }
    }

    const filename = `lightcode-pr-review-${Date.now()}.md`;
    const writePath =
      location.kind === "wsl"
        ? toWslUncPath(location.distro, `/tmp/${filename}`)
        : join(tmpdir(), filename);
    const cliPath = location.kind === "wsl" ? `/tmp/${filename}` : writePath;
    try {
      await writeFile(writePath, trimmed, "utf-8");
      await runGh(location, ["pr", "review", String(prNumber), flag, "--body-file", cliPath]);
    } catch (err) {
      throw classifyError(err, "pr review");
    } finally {
      await unlink(writePath).catch(() => {});
    }
  }
}
