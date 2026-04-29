import type { ProjectLocation } from "@/shared/contracts";
import { getProjectName } from "@/shared/wsl";
import {
  readAgentCommandOutput,
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
  const executablePath =
    location.kind === "wsl"
      ? (resolveAgentBinaryPath(location, "gemini") ?? "gemini")
      : await resolveExecutablePathAsync("gemini");
  if (!executablePath) return undefined;
  const result = await readAgentCommandOutput(location, executablePath, ["--list-sessions"]);
  if (!result.ok) {
    if (location.kind === "wsl") {
      console.log("[gemini] --list-sessions (wsl) failed: %s", result.stderr);
    }
    return undefined;
  }
  if (!result.stdout) return undefined;
  const ids = parseAllSessionIds(result.stdout);
  return ids[ids.length - 1];
}

export function resolveGeminiWatchPath(location: ProjectLocation): string | undefined {
  return resolveAgentHomeSubpath(location, `.gemini/tmp/${getProjectName(location)}`);
}
