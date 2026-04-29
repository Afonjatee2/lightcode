import { stripAnsi } from "@/shared/ansi";
import type {
  AgentCapability,
  AuthState,
  LabeledOption,
  ProjectLocation,
} from "@/shared/contracts";
import {
  buildAgentCommand,
  readCommandOutputAsync,
  readWslLoginShellCommandOutputAsync,
  type AgentEnvContext,
  type AuthProbe,
  type CommandSpec,
  type DetectionSpec,
} from "../base";

export const cursorDefaultCapabilities: AgentCapability = {
  models: [],
  efforts: [],
  modelEfforts: {},
  modes: ["agent", "plan"],
  approvalPolicies: [
    { id: "default", label: "Default Approvals" },
    { id: "never", label: "YOLO" },
  ],
  sandboxModes: [],
  supportsResume: true,
  supportsDirectInput: true,
  liveInputMode: "terminal",
  presentationMode: "terminal",
  bypassApprovalPolicy: "never",
  settingDefs: [],
};

const MODEL_LINE_RE = /^([^\s-]+(?:-[^\s-]+)*)\s+-\s+(.+)$/;

export function buildCursorProbeSpec(
  executablePath: string,
  args: string[],
  cwd = process.cwd(),
): CommandSpec {
  const location: ProjectLocation =
    process.platform === "win32" ? { kind: "windows", path: cwd } : { kind: "posix", path: cwd };
  return buildAgentCommand(location, executablePath, args);
}

async function readCursorProbeOutputAsync(
  executablePath: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const spec = buildCursorProbeSpec(executablePath, args);
  return readCommandOutputAsync(spec.command, spec.args, {
    ...(spec.cwd ? { cwd: spec.cwd } : {}),
    ...(spec.env ? { env: spec.env } : {}),
  });
}

export function parseCursorModels(output: string): LabeledOption[] {
  const models: LabeledOption[] = [];
  const seen = new Set<string>();

  for (const rawLine of stripAnsi(output).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(Available|Tip:|Loading)/i.test(line)) continue;

    const match = MODEL_LINE_RE.exec(line);
    if (!match) continue;

    const id = match[1]!;
    const label = match[2]!.replace(/\s*\([^)]*\)\s*/g, "").trim();
    if (!id || !label) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    models.push({ id, label });
  }

  if (!seen.has("auto")) {
    models.unshift({ id: "auto", label: "Auto" });
  } else {
    const idx = models.findIndex((m) => m.id === "auto");
    if (idx > 0) {
      const [auto] = models.splice(idx, 1);
      models.unshift(auto!);
    }
  }

  return models.length > 0 ? sortCursorModels(models) : [{ id: "auto", label: "Auto" }];
}

/**
 * Sort models: Auto first, then Composer, then all others grouped by family.
 * Groups sorted by version descending. Within each group:
 * Thinking > non-Thinking, 1M > non-1M, effort descending
 * (Extra High > High > Medium > Low > None > base), Fast before non-Fast
 * within the same tier.
 */
export function sortCursorModels(models: LabeledOption[]): LabeledOption[] {
  const auto = models.filter((m) => m.id === "auto");
  const rest = models.filter((m) => m.id !== "auto");

  const versionOf = (label: string): number => {
    const m = /(\d+(?:\.\d+)?)/.exec(label);
    return m ? Number(m[1]) : 0;
  };

  const groupOf = (label: string): string =>
    label
      .replace(/\b(1M|Max|Fast|Thinking|None|Low|Medium|High|Extra\s+High)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

  const isComposer = (label: string): boolean => /^Composer\b/i.test(label);
  const isFast = (label: string): boolean => /\bFast\b/i.test(label);
  const is1M = (label: string): boolean => /\b1M\b/i.test(label);
  const isMax = (label: string): boolean => /\bMax\b/i.test(label);
  const isThinking = (label: string): boolean => /\bThinking\b/i.test(label);

  const effortRank = (label: string): number => {
    if (/\bExtra\s+High\b/i.test(label)) return 5;
    if (/\bHigh\b/i.test(label)) return 4;
    if (/\bMedium\b/i.test(label)) return 3;
    if (/\bLow\b/i.test(label)) return 2;
    if (/\bNone\b/i.test(label)) return 1;
    return 3; // no qualifier = medium
  };

  const compareWithinGroup = (a: LabeledOption, b: LabeledOption): number => {
    const x = (isMax(b.label) ? 1 : 0) - (isMax(a.label) ? 1 : 0);
    if (x !== 0) return x;
    const t = (isThinking(b.label) ? 1 : 0) - (isThinking(a.label) ? 1 : 0);
    if (t !== 0) return t;
    const c = (is1M(b.label) ? 1 : 0) - (is1M(a.label) ? 1 : 0);
    if (c !== 0) return c;
    const e = effortRank(b.label) - effortRank(a.label);
    if (e !== 0) return e;
    return (isFast(b.label) ? 1 : 0) - (isFast(a.label) ? 1 : 0);
  };

  // Separate Composer from others
  const composers = rest.filter((m) => isComposer(m.label));
  const others = rest.filter((m) => !isComposer(m.label));

  composers.sort((a, b) => {
    const v = versionOf(b.label) - versionOf(a.label);
    return v !== 0 ? v : compareWithinGroup(a, b);
  });

  // Provider name: leading alpha chars ("GPT-5.4 Mini" → "GPT", "Opus 4.6" → "Opus")
  const providerOf = (key: string): string => key.match(/^[A-Za-z]+/)?.[0] ?? key;

  // Group by model family preserving insertion order
  const groups = new Map<string, LabeledOption[]>();
  for (const m of others) {
    const key = groupOf(m.label);
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(m);
  }

  // Collect sub-groups by provider, preserving insertion order
  const providerGroups = new Map<string, Array<[string, LabeledOption[]]>>();
  const providerMaxVer = new Map<string, number>();
  for (const entry of groups) {
    const p = providerOf(entry[0]);
    const v = versionOf(entry[0]);
    if (v > (providerMaxVer.get(p) ?? 0)) providerMaxVer.set(p, v);
    let arr = providerGroups.get(p);
    if (!arr) {
      arr = [];
      providerGroups.set(p, arr);
    }
    arr.push(entry);
  }

  // Sort providers by max version desc, then sub-groups by version desc within each
  const sortedProviders = [...providerGroups.entries()].sort(
    (a, b) => (providerMaxVer.get(b[0]) ?? 0) - (providerMaxVer.get(a[0]) ?? 0),
  );

  // If a group contains models with explicit effort qualifiers, label bare models as "Medium"
  const hasExplicitEffort = (label: string): boolean =>
    /\b(Extra\s+High|High|Medium|Low|None)\b/i.test(label);
  const needsMediumLabel = (label: string): boolean =>
    !hasExplicitEffort(label) && !isThinking(label);
  const addMediumLabel = (label: string): string =>
    isFast(label) ? label.replace(/\bFast\b/i, "Medium Fast") : `${label} Medium`;

  const sorted: LabeledOption[] = [];
  for (const [, subGroups] of sortedProviders) {
    subGroups.sort((a, b) => versionOf(b[0]) - versionOf(a[0]));
    for (const [, items] of subGroups) {
      if (items.some((m) => hasExplicitEffort(m.label))) {
        for (const m of items) {
          if (needsMediumLabel(m.label)) m.label = addMediumLabel(m.label);
        }
      }
      items.sort(compareWithinGroup);
      sorted.push(...items);
    }
  }

  return [...auto, ...composers, ...sorted];
}

function resolveCursorAuthState(
  result: { ok: boolean; stdout: string; stderr: string } | undefined,
): AuthState {
  if (!result) {
    return "missing";
  }

  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (/not\s+logged\s+in|login required|sign in/i.test(text)) {
    return "unknown";
  }

  return result.ok ? "authenticated" : "unknown";
}

// Cursor's `status` subcommand exits 0 even when signed out and prints
// "Not logged in" / "sign in" — so parse the output rather than trust exit code.
const cursorAuthProbe: AuthProbe = async (ctx) => {
  if (!ctx.executablePath) return undefined;
  const result =
    ctx.location.kind === "wsl"
      ? await readWslLoginShellCommandOutputAsync(ctx.location.distro, "/tmp", ctx.executablePath, [
          "status",
        ])
      : await readCursorProbeOutputAsync(ctx.executablePath, ["status"]);
  return resolveCursorAuthState(result);
};

export const cursorDetectionSpec: DetectionSpec = {
  kind: "cursor",
  label: "Cursor CLI",
  binary: "cursor-agent",
  capabilities: cursorDefaultCapabilities,
  authProbes: [cursorAuthProbe],
  async capabilitiesProbe(ctx) {
    if (!ctx.executablePath) return undefined;
    const result =
      ctx.location.kind === "wsl"
        ? await readWslLoginShellCommandOutputAsync(
            ctx.location.distro,
            "/tmp",
            ctx.executablePath,
            ["--list-models"],
          )
        : await readCursorProbeOutputAsync(ctx.executablePath, ["--list-models"]);
    if (!result.ok) return undefined;
    const models = parseCursorModels(result.stdout);
    return models.length > 0 ? { models } : undefined;
  },
};

/**
 * Hooks were introduced in Cursor 1.7. The minimum here is the floor at which
 * `sessionStart` and the agent-loop hooks fire reliably in headless CLI mode.
 * Bump if testing reveals 1.7.x has gaps.
 */
const MIN_CURSOR_SEMVER = [1, 7, 0] as const;

const CURSOR_SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/;

export function parseCursorVersionLine(line: string): [number, number, number] | null {
  const m = CURSOR_SEMVER_RE.exec(stripAnsi(line).trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function semverGte(a: [number, number, number], b: readonly [number, number, number]): boolean {
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] >= b[2];
}

export function isCursorSemverSupportedForHooks(v: [number, number, number] | null): boolean {
  if (!v) return false;
  return semverGte(v, MIN_CURSOR_SEMVER);
}

async function probeCursorCliSemverNative(): Promise<[number, number, number] | null> {
  const result = await readCursorProbeOutputAsync("cursor-agent", ["--version"]);
  const text = result.stdout || result.stderr;
  return text ? parseCursorVersionLine(text) : null;
}

async function probeCursorCliSemverWsl(distro: string): Promise<[number, number, number] | null> {
  const result = await readWslLoginShellCommandOutputAsync(distro, "/tmp", "cursor-agent", [
    "--version",
  ]);
  const text = result.stdout || result.stderr;
  return text ? parseCursorVersionLine(text) : null;
}

export async function probeCursorCliSemver(
  ctx: AgentEnvContext | undefined,
): Promise<[number, number, number] | null> {
  if (ctx?.envKind === "wsl" && ctx.wslDistro) {
    return probeCursorCliSemverWsl(ctx.wslDistro);
  }
  return probeCursorCliSemverNative();
}

export async function isCursorVersionSupportedForHooks(
  ctx: AgentEnvContext | undefined,
): Promise<boolean> {
  return isCursorSemverSupportedForHooks(await probeCursorCliSemver(ctx));
}
