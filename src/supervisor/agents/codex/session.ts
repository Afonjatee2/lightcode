import { join } from "node:path";
import type { ProjectLocation } from "@/shared/contracts";
import { readWslCommandOutput, resolveAgentHomeSubpath } from "../base";
import {
  parseCodexRolloutIdFromPath,
  parseCodexRolloutMeta,
  parseCodexSessionIndex,
  readCodexSessionIndex,
  type CodexRolloutMeta,
} from "./sessionFiles";

export function describeCodexLocation(location: ProjectLocation): string {
  switch (location.kind) {
    case "windows":
      return `windows:${location.path}`;
    case "wsl":
      return `wsl:${location.distro}:${location.linuxPath}`;
    case "posix":
      return `posix:${location.path}`;
  }
}

export function readCodexSessionIndexForLocation(location: ProjectLocation) {
  if (location.kind === "wsl") {
    const result = readWslCommandOutput(location.distro, "sh", [
      "-lc",
      "cat ~/.codex/session_index.jsonl 2>/dev/null || true",
    ]);
    if (!result.ok || result.stdout.length === 0) {
      return [];
    }
    return parseCodexSessionIndex(result.stdout);
  }

  return readCodexSessionIndex();
}

export function isInteractiveCodexRollout(
  rollout: CodexRolloutMeta,
  location: ProjectLocation,
): boolean {
  if (rollout.originator !== "codex-tui" || rollout.source !== "cli") {
    return false;
  }

  if (!rollout.cwd) {
    return true;
  }

  switch (location.kind) {
    case "windows":
      return rollout.cwd === location.path;
    case "posix":
      return rollout.cwd === location.path;
    case "wsl":
      return rollout.cwd === location.linuxPath || rollout.cwd === location.uncPath;
  }
}

export function readCodexRolloutsForLocation(location: ProjectLocation): CodexRolloutMeta[] {
  if (location.kind === "wsl") {
    const result = readWslCommandOutput(location.distro, "bash", [
      "-lc",
      "find ~/.codex/sessions -type f -name 'rollout-*.jsonl' -printf '%T@\\t%p\\n' 2>/dev/null",
    ]);
    if (!result.ok || result.stdout.length === 0) {
      console.log(
        "[codex] WSL rollout scan returned no output for %s: %s",
        describeCodexLocation(location),
        result.stderr || "(no stderr)",
      );
      return [];
    }
    return result.stdout
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const [mtimeRaw, path] = line.split("\t");
        if (!path) return [];
        const updatedAt = Number.isFinite(Number(mtimeRaw))
          ? Math.round(Number(mtimeRaw) * 1000)
          : undefined;
        const id = parseCodexRolloutIdFromPath(path);
        if (!id) return [];
        const parsed: CodexRolloutMeta = {
          id,
          path,
          ...(updatedAt !== undefined ? { updatedAt } : {}),
        };
        return parsed ? [parsed] : [];
      });
  }

  const { readdirSync, readFileSync, statSync } = require("node:fs") as typeof import("node:fs");
  const root = join(require("node:os").homedir(), ".codex", "sessions");
  const rollouts: CodexRolloutMeta[] = [];
  const walk = (dir: string) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      let stat: import("node:fs").Stats;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      const id = parseCodexRolloutIdFromPath(fullPath);
      if (!id) {
        continue;
      }
      let firstLine = "";
      try {
        firstLine = readFileSync(fullPath, "utf8").split(/\r?\n/g)[0] ?? "";
      } catch {
        // Ignore unreadable rollout files.
      }
      const parsed = parseCodexRolloutMeta(fullPath, firstLine, stat.mtimeMs);
      if (parsed && isInteractiveCodexRollout(parsed, location)) {
        rollouts.push(parsed);
      }
    }
  };
  walk(root);
  return rollouts;
}

export function readCodexRolloutMetaForLocation(
  location: ProjectLocation,
  rollout: CodexRolloutMeta,
): CodexRolloutMeta | undefined {
  if (location.kind === "wsl") {
    const result = readWslCommandOutput(location.distro, "head", ["-n", "1", "--", rollout.path]);
    if (!result.ok || result.stdout.length === 0) {
      console.log(
        "[codex] WSL rollout meta read failed for %s: path=%s stderr=%s",
        describeCodexLocation(location),
        rollout.path,
        result.stderr || "(no stderr)",
      );
      return rollout;
    }
    return parseCodexRolloutMeta(rollout.path, result.stdout, rollout.updatedAt) ?? rollout;
  }

  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  try {
    const firstLine = readFileSync(rollout.path, "utf8").split(/\r?\n/g)[0] ?? "";
    return parseCodexRolloutMeta(rollout.path, firstLine, rollout.updatedAt) ?? rollout;
  } catch {
    return rollout;
  }
}

export function resolveCodexSessionsWatchPath(location: ProjectLocation): string | undefined {
  return resolveAgentHomeSubpath(location, ".codex/sessions");
}
