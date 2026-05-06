import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, normalize, posix } from "node:path";
import { promisify } from "node:util";
import type { GitRemoteInfo, ProjectLocation, RemoteHostPlatform } from "@/shared/contracts";
import { resolveLightcodePaths } from "@/shared/lightcodePaths";
import { errorDetail, msg } from "@/shared/messages";
import { getProjectName } from "@/shared/wsl";
import { sanitizeWorktreeBranchName, sanitizeWorktreePathSegment } from "@/shared/worktree";
import { buildAgentCommand, readWslCommandOutputAsync } from "../agents/base";
import { mkdir } from "node:fs/promises";

const execFileAsync = promisify(execFile);

export const GIT_STATUS_TIMEOUT = 10_000;
export const GIT_DIFF_TIMEOUT = 15_000;
export const GIT_NETWORK_TIMEOUT = 30_000;
export const GIT_DEFAULT_TIMEOUT = 15_000;
// Operations that invoke user-defined hooks (pre-commit lint/typecheck/test, etc.).
// Generous bound so common hook chains complete; still finite so a hung hook can't pin the UI forever.
export const GIT_HOOK_TIMEOUT = 300_000;

export async function execGit(
  location: ProjectLocation,
  args: string[],
  options?: { timeout?: number; allowNonZeroExit?: boolean },
): Promise<string> {
  const timeout = options?.timeout ?? GIT_DEFAULT_TIMEOUT;
  const maxBuffer = 50 * 1024 * 1024;

  try {
    if (location.kind === "wsl") {
      const spec = buildAgentCommand(location, "git", args, undefined, { GIT_OPTIONAL_LOCKS: "0" });
      const { stdout } = await execFileAsync(spec.command, spec.args, {
        windowsHide: true,
        timeout,
        maxBuffer,
      });
      return stdout;
    }

    const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
    const { stdout } = await execFileAsync("git", args, {
      cwd: location.path,
      env,
      timeout,
      maxBuffer,
      windowsHide: true,
    });
    return stdout;
  } catch (error: unknown) {
    if (options?.allowNonZeroExit && error && typeof error === "object" && "stdout" in error) {
      const stdout = String((error as { stdout: unknown }).stdout);
      if (stdout) {
        return stdout;
      }
    }
    throw new Error(msg("git.commandFailed", { command: args[0]!, detail: errorDetail(error) }), {
      cause: error,
    });
  }
}

export function toForwardSlash(path: string): string {
  return path.replace(/\\/g, "/");
}

export function normalizeWorktreePath(location: ProjectLocation, path: string): string {
  if (location.kind === "wsl") {
    return path;
  }
  return normalize(path).replace(/\\/g, "/").toLowerCase();
}

export function getLocationIdentity(location: ProjectLocation): string {
  if (location.kind === "wsl") {
    return `wsl:${location.distro}:${location.linuxPath}`;
  }
  if (location.kind === "windows") {
    return `windows:${toForwardSlash(location.path).toLowerCase()}`;
  }
  return `posix:${location.path}`;
}

function getWorktreeRepoDirName(location: ProjectLocation): string {
  const repoName = sanitizeWorktreePathSegment(getProjectName(location));
  const hash = createHash("sha256").update(getLocationIdentity(location)).digest("hex").slice(0, 4);
  return `${repoName}-${hash}`;
}

async function resolveWslHomeDirectory(distro: string): Promise<string> {
  const result = await readWslCommandOutputAsync(distro, "sh", ["-lc", 'printf %s "$HOME"']);
  const homePath = result.stdout.trim();
  if (!result.ok || !homePath) {
    throw new Error(msg("git.wsl.homeNotFound", { distro }));
  }
  return homePath;
}

export async function computeDefaultWorktreePath(
  location: ProjectLocation,
  branch: string,
): Promise<string> {
  const repoDir = getWorktreeRepoDirName(location);
  const branchDir = sanitizeWorktreeBranchName(branch);
  if (location.kind === "wsl") {
    const homePath = await resolveWslHomeDirectory(location.distro);
    return posix.join(homePath, ".lightcode", "worktrees", repoDir, branchDir);
  }
  return join(
    resolveLightcodePaths(join(homedir(), ".lightcode")).worktreesDir,
    repoDir,
    branchDir,
  );
}

export async function ensureWorktreeParentExists(
  location: ProjectLocation,
  worktreePath: string,
): Promise<void> {
  if (location.kind === "wsl") {
    const parentPath = posix.dirname(worktreePath);
    const result = await readWslCommandOutputAsync(location.distro, "mkdir", ["-p", parentPath]);
    if (!result.ok) {
      throw new Error(result.stderr || msg("git.wsl.mkdirFailed", { path: parentPath }));
    }
    return;
  }

  await mkdir(dirname(worktreePath), { recursive: true });
}

function detectPlatform(hostname: string): RemoteHostPlatform {
  const normalized = hostname.toLowerCase();
  if (normalized === "github.com" || normalized.includes("github")) return "github";
  if (normalized === "gitlab.com" || normalized.includes("gitlab")) return "gitlab";
  if (normalized === "bitbucket.org" || normalized.includes("bitbucket")) return "bitbucket";
  return "unknown";
}

export function parseRemoteUrl(url: string): GitRemoteInfo | null {
  const httpsMatch = url.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    const [, hostname, owner, repo] = httpsMatch;
    return { url, platform: detectPlatform(hostname!), owner: owner!, repo: repo! };
  }

  const sshMatch = url.match(/^[^@]+@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    const [, hostname, owner, repo] = sshMatch;
    return { url, platform: detectPlatform(hostname!), owner: owner!, repo: repo! };
  }

  return null;
}
