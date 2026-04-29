import type { ProjectLocation } from "@/shared/contracts";
import { readAgentCommandOutput, resolveExecutablePathAsync } from "../base";
import { resolveAgentBinaryPath } from "../binaryResolver";

/**
 * OpenCode persists sessions in a SQLite database under
 * `~/.local/share/opencode/opencode.db`, so there's no per-session file we
 * can fs-watch. We rely on `opencode session list --format json` instead.
 *
 * The supervisor calls `discoverSessionRef` at a polling cadence after spawn
 * to grab the freshly-created session id; we don't expose a `watchSessionRef`
 * because watching the .db / WAL files is fragile and the polling interval
 * is short enough.
 */

interface OpenCodeSessionEntry {
  id: string;
  title?: string;
  updated?: number;
  created?: number;
  projectId?: string;
  directory?: string;
}

function parseSessionListJson(stdout: string): OpenCodeSessionEntry[] {
  try {
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      const id = entry.id;
      if (typeof id !== "string" || id.length === 0) return [];
      const out: OpenCodeSessionEntry = { id };
      if (typeof entry.title === "string") out.title = entry.title;
      if (typeof entry.updated === "number") out.updated = entry.updated;
      if (typeof entry.created === "number") out.created = entry.created;
      if (typeof entry.projectId === "string") out.projectId = entry.projectId;
      if (typeof entry.directory === "string") out.directory = entry.directory;
      return [out];
    });
  } catch {
    return [];
  }
}

async function readSessionListJson(
  location: ProjectLocation,
  maxCount: number,
): Promise<string | undefined> {
  const executablePath =
    location.kind === "wsl"
      ? (resolveAgentBinaryPath(location, "opencode") ?? "opencode")
      : await resolveExecutablePathAsync("opencode");
  if (!executablePath) return undefined;
  const result = await readAgentCommandOutput(
    location,
    executablePath,
    ["session", "list", "--format", "json", "-n", String(maxCount)],
    { timeoutMs: 8_000 },
  );
  if (!result.ok) {
    if (location.kind === "wsl") {
      console.log("[opencode] session list (wsl) failed: %s", result.stderr || "(no stderr)");
    }
    return undefined;
  }
  return result.stdout || undefined;
}

/**
 * Return the most-recently-updated OpenCode session id across the user's
 * full session list. We don't filter by project directory because the
 * `directory` field uses platform-specific path strings that don't always
 * round-trip through WSL ↔ Windows; the supervisor's pre-spawn snapshot is
 * what guards against picking up an unrelated session.
 */
export async function queryLatestOpenCodeSessionId(
  location: ProjectLocation,
): Promise<string | undefined> {
  const stdout = await readSessionListJson(location, 1);
  if (!stdout) return undefined;
  const entries = parseSessionListJson(stdout);
  return entries[0]?.id;
}
