import type { ProjectLocation } from "@/shared/contracts";
import { getProjectName } from "@/shared/wsl";
import {
  buildAgentCommand,
  readCommandOutputAsync,
  readWslLoginShellCommandOutputAsync,
  resolveAgentHomeSubpath,
  resolveExecutablePathAsync,
} from "../base";
import { resolveAgentBinaryPath } from "../binaryResolver";

const SESSION_UUID_RE = /\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/;
const INVALID_SESSION_RE = /Error resuming session:\s+Invalid session identifier/i;

function parseAllSessionIds(output: string): string[] {
  const ids: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = SESSION_UUID_RE.exec(line);
    if (match?.[1]) ids.push(match[1]);
  }
  return ids;
}

export function detectGeminiInvalidSessionRef(output: string): boolean {
  return INVALID_SESSION_RE.test(output);
}

export async function queryLatestSessionId(location: ProjectLocation): Promise<string | undefined> {
  let output: string | undefined;
  if (location.kind === "wsl") {
    const executablePath = resolveAgentBinaryPath(location, "gemini") ?? "gemini";
    const result = await readWslLoginShellCommandOutputAsync(
      location.distro,
      location.linuxPath,
      executablePath,
      ["--list-sessions"],
    );
    if (!result.ok) console.log("[gemini] --list-sessions (wsl) failed: %s", result.stderr);
    output = result.ok ? result.stdout : undefined;
  } else if (location.kind === "windows" || location.kind === "posix") {
    const executablePath = await resolveExecutablePathAsync("gemini");
    if (!executablePath) return undefined;
    const spec = buildAgentCommand(location, executablePath, ["--list-sessions"]);
    const result = await readCommandOutputAsync(
      spec.command,
      spec.args,
      spec.cwd ? { cwd: spec.cwd } : undefined,
    );
    if (!result.ok) return undefined;
    output = result.stdout || undefined;
  }
  if (!output) return undefined;
  const ids = parseAllSessionIds(output);
  return ids[ids.length - 1];
}

export function resolveGeminiWatchPath(location: ProjectLocation): string | undefined {
  return resolveAgentHomeSubpath(location, `.gemini/tmp/${getProjectName(location)}`);
}
