import { copyFileSync, existsSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import type { ProjectLocation } from "@/shared/contracts";
import { terminateChildProcessTree } from "@/shared/processTree";
import { getWslCommand } from "./agents/base";

const DEBOUNCE_MS = 300;

interface WatcherEntry {
  gitWatcher: FSWatcher | null;
  workTreeWatcher: FSWatcher | null;
  wslProcess: ChildProcess | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  projectId: string;
  location: ProjectLocation;
}

interface WorktreeWatcherEntry {
  watcher: FSWatcher | null;
  wslProcess: ChildProcess | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  projectId: string;
}

const IGNORED_PREFIXES = [
  "node_modules/",
  ".next/",
  "dist/",
  "build/",
  ".turbo/",
  "__pycache__/",
  ".venv/",
];

function isIgnoredWorkTreeFile(name: string): boolean {
  if (name === ".git" || name.startsWith(".git/")) return true;
  return IGNORED_PREFIXES.some((p) => name.startsWith(p));
}

const INOTIFYWAIT_EXCLUDE =
  "(node_modules|\\.next|dist|build|__pycache__|\\.venv|\\.git/objects|\\.git/logs|\\.git/FETCH_HEAD)";

/**
 * Deploy the @parcel/watcher native binary + helper script into a WSL distro.
 * Files are written to `~/.lightcode/watcher/` via UNC path.
 * Returns the Linux-side directory path on success, or null.
 */
function deployWslWatcher(distro: string): string | null {
  const srcDir = process.env.LIGHTCODE_WSL_WATCHER_DIR;
  if (!srcDir) return null;

  const srcBinary = join(srcDir, "watcher.node");
  const srcScript = join(srcDir, "wsl-watcher.cjs");
  if (!existsSync(srcBinary) || !existsSync(srcScript)) return null;

  try {
    const home = execSync(`"${getWslCommand()}" -d ${distro} -- sh -c "echo $HOME"`, {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
    }).trim();

    const uncHome = `\\\\wsl.localhost\\${distro}${home.replaceAll("/", "\\")}`;
    const destDir = join(uncHome, ".lightcode", "watcher");
    mkdirSync(destDir, { recursive: true });
    copyFileSync(srcBinary, join(destDir, "watcher.node"));
    copyFileSync(srcScript, join(destDir, "wsl-watcher.cjs"));

    return `${home}/.lightcode/watcher`;
  } catch {
    return null;
  }
}

/**
 * Watches git repositories for changes and emits debounced notifications.
 *
 * Two watchers per project:
 * 1. `.git` directory — catches stage, commit, branch switch, fetch, merge
 * 2. Working tree — catches file edits, new files, deletions
 *
 * Worktree directories get their own working-tree watchers. Git state changes
 * for worktrees are stored in the main repo's `.git/worktrees/` directory,
 * so the main `.git` watcher already catches those.
 *
 * Both are debounced into a single callback per project.
 *
 * WSL projects use a three-tier fallback strategy:
 * 1. @parcel/watcher native binary (deployed to ~/.lightcode/watcher/)
 * 2. inotifywait (if inotify-tools is installed)
 * 3. 30-second polling
 *
 * Node's `fs.watch` does not work on WSL UNC paths, so all WSL watching
 * is done from inside the distro via `wsl.exe`.
 */
export class GitWatcher {
  private readonly watchers = new Map<string, WatcherEntry>();
  private readonly worktreeWatchers = new Map<string, WorktreeWatcherEntry>();
  private readonly deployedDistros = new Map<string, string | null>();

  constructor(private readonly onChanged: (projectId: string) => void) {}

  /**
   * Start watching a project. Idempotent — calling with the same projectId
   * replaces the previous watcher.
   */
  watch(projectId: string, location: ProjectLocation): void {
    // Stop existing watcher for this project
    this.unwatch(projectId);

    const entry: WatcherEntry = {
      gitWatcher: null,
      workTreeWatcher: null,
      wslProcess: null,
      debounceTimer: null,
      projectId,
      location,
    };

    const scheduleNotify = () => {
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
      entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = null;
        this.onChanged(projectId);
      }, DEBOUNCE_MS);
    };

    if (location.kind === "wsl") {
      this.ensureWslWatcherDeployed(location.distro);
      entry.wslProcess = this.spawnWslWatcher(location.distro, location.linuxPath, scheduleNotify);
      this.watchers.set(projectId, entry);
      return;
    }

    const repoPath = location.path;
    const gitDir = join(repoPath, ".git");

    // Watch .git directory recursively for internal git state changes
    try {
      entry.gitWatcher = watch(gitDir, { recursive: true }, (_eventType, filename) => {
        // Filter out noisy files that don't affect status
        if (filename) {
          const name = filename.replace(/\\/g, "/");
          // Skip FETCH_HEAD updates (written on every fetch, rarely useful)
          // Skip gc/pack files that don't affect working state
          if (name === "FETCH_HEAD" || name.startsWith("objects/") || name.startsWith("logs/")) {
            return;
          }
        }
        scheduleNotify();
      });
      entry.gitWatcher.on("error", () => {
        // Watcher died — clean up silently
        entry.gitWatcher?.close();
        entry.gitWatcher = null;
      });
    } catch {
      // .git directory may not exist yet or may not be watchable
    }

    // Watch working tree for file changes
    try {
      entry.workTreeWatcher = watch(repoPath, { recursive: true }, (_eventType, filename) => {
        if (filename) {
          const name = filename.replace(/\\/g, "/");
          if (isIgnoredWorkTreeFile(name)) return;
        }
        scheduleNotify();
      });
      entry.workTreeWatcher.on("error", () => {
        entry.workTreeWatcher?.close();
        entry.workTreeWatcher = null;
      });
    } catch {
      // Working tree may not be watchable
    }

    this.watchers.set(projectId, entry);
  }

  /**
   * Update the set of watched worktree directories for a project.
   * Diffs against existing watchers — only adds/removes what changed.
   * All worktree watchers emit the parent projectId.
   */
  watchWorktrees(projectId: string, worktreePaths: string[]): void {
    const desired = new Set(worktreePaths);

    // Remove stale worktree watchers for this project
    for (const [path, entry] of this.worktreeWatchers) {
      if (entry.projectId === projectId && !desired.has(path)) {
        this.closeWorktreeWatcher(path);
      }
    }

    // Look up the stored location to determine WSL distro
    const mainEntry = this.watchers.get(projectId);
    const location = mainEntry?.location;

    // Add watchers for new paths
    for (const wtPath of worktreePaths) {
      if (this.worktreeWatchers.has(wtPath)) continue;

      const entry: WorktreeWatcherEntry = {
        watcher: null,
        wslProcess: null,
        debounceTimer: null,
        projectId,
      };

      const scheduleNotify = () => {
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        entry.debounceTimer = setTimeout(() => {
          entry.debounceTimer = null;
          this.onChanged(projectId);
        }, DEBOUNCE_MS);
      };

      if (location?.kind === "wsl") {
        entry.wslProcess = this.spawnWslWatcher(location.distro, wtPath, scheduleNotify);
      } else {
        try {
          entry.watcher = watch(wtPath, { recursive: true }, (_eventType, filename) => {
            if (filename) {
              const name = filename.replace(/\\/g, "/");
              if (isIgnoredWorkTreeFile(name)) return;
            }
            scheduleNotify();
          });
          entry.watcher.on("error", () => {
            entry.watcher?.close();
            entry.watcher = null;
          });
        } catch {
          // Worktree path may not exist or may not be watchable
        }
      }

      this.worktreeWatchers.set(wtPath, entry);
    }
  }

  /** Stop watching a project and its worktrees. */
  unwatch(projectId: string): void {
    const entry = this.watchers.get(projectId);
    if (entry) {
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
      entry.gitWatcher?.close();
      entry.workTreeWatcher?.close();
      if (entry.wslProcess) {
        terminateChildProcessTree(entry.wslProcess);
      }
      this.watchers.delete(projectId);
    }

    // Also clean up worktree watchers for this project
    for (const [path, wtEntry] of this.worktreeWatchers) {
      if (wtEntry.projectId === projectId) {
        this.closeWorktreeWatcher(path);
      }
    }
  }

  /** Stop watching all project worktrees. */
  unwatchAllWorktrees(projectId: string): void {
    for (const [path, wtEntry] of this.worktreeWatchers) {
      if (wtEntry.projectId === projectId) {
        this.closeWorktreeWatcher(path);
      }
    }
  }

  /** Stop watching a specific worktree directory. */
  unwatchWorktree(path: string): void {
    const normalized = path.replace(/\\/g, "/").toLowerCase();
    for (const [wtPath] of this.worktreeWatchers) {
      if (wtPath.replace(/\\/g, "/").toLowerCase() === normalized) {
        this.closeWorktreeWatcher(wtPath);
      }
    }
  }

  /** Stop all watchers. */
  dispose(): void {
    for (const [projectId] of this.watchers) {
      this.unwatch(projectId);
    }
  }

  private ensureWslWatcherDeployed(distro: string): void {
    if (this.deployedDistros.has(distro)) return;
    const watcherPath = deployWslWatcher(distro);
    this.deployedDistros.set(distro, watcherPath);
  }

  private closeWorktreeWatcher(path: string): void {
    const entry = this.worktreeWatchers.get(path);
    if (!entry) return;
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.watcher?.close();
    if (entry.wslProcess) {
      terminateChildProcessTree(entry.wslProcess);
    }
    this.worktreeWatchers.delete(path);
  }

  /**
   * Spawn a `wsl.exe` process that watches for filesystem changes inside the
   * given WSL distro. Uses a three-tier fallback:
   *   1. @parcel/watcher (native inotify, shipped with the app)
   *   2. inotifywait (requires inotify-tools)
   *   3. 30s polling (last resort)
   */
  private spawnWslWatcher(distro: string, linuxPath: string, onEvent: () => void): ChildProcess {
    const watcherDir = this.deployedDistros.get(distro);

    const parcelBlock = watcherDir
      ? [
          "if ! command -v node >/dev/null 2>&1; then",
          "  :",
          `elif [ ! -f '${watcherDir}/watcher.node' ]; then`,
          "  :",
          `elif ! node -e "require('${watcherDir}/watcher.node')" >/dev/null 2>&1; then`,
          "  :",
          "else",
          `  exec node "${watcherDir}/wsl-watcher.cjs" .git .`,
          "fi",
        ]
      : [];

    const script = [
      ...parcelBlock,
      "if command -v inotifywait >/dev/null 2>&1; then",
      "  exec inotifywait -m -r -q -e modify,create,delete,move .git . \\",
      `    --exclude '${INOTIFYWAIT_EXCLUDE}'`,
      "else",
      "  while true; do echo poll; sleep 30; done",
      "fi",
    ].join("\n");

    const child = spawn(
      getWslCommand(),
      // Use a login shell so Node installed via nvm is visible on PATH.
      ["-d", distro, "--cd", linuxPath, "--", "bash", "-lc", script],
      {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    );

    let buf = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line === "changed" || line.startsWith("changed:")) {
          const parts = line.split(":");
          const scope = line === "changed" ? "unknown" : (parts[1] ?? "unknown");
          const pathsJson = parts.length >= 3 ? parts[2] : undefined;
          let parsedPaths: string[] = [];
          if (pathsJson) {
            try {
              const parsed = JSON.parse(pathsJson);
              if (Array.isArray(parsed) && parsed.length > 0) {
                parsedPaths = parsed.filter((value): value is string => typeof value === "string");
              }
            } catch {
              // best-effort parse for watcher metadata
            }
          }
          const isKnownGitNoise =
            parsedPaths.length > 0 &&
            parsedPaths.every(
              (value) =>
                value === "FETCH_HEAD" ||
                value === "index.lock" ||
                /^worktrees\/[^/]+\/index\.lock$/.test(value) ||
                /^\.watchman-cookie-/.test(value) ||
                value.startsWith("logs/") ||
                value.startsWith("objects/"),
            );
          if (scope === "git" && (parsedPaths.length === 0 || isKnownGitNoise)) {
            continue;
          }
          onEvent();
          continue;
        }
        if (line === "poll") {
          onEvent();
          continue;
        }
        onEvent();
      }
    });

    child.on("error", () => {
      // wsl.exe could not be started — degrade to no watching
    });

    return child;
  }
}
