"use strict";

const path = require("path");

const binding = require(path.join(__dirname, "watcher.node"));

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  process.stderr.write("Usage: node wsl-watcher.cjs <dir> [<dir>...]\n");
  process.exit(1);
}

const IGNORE_DIRS = [
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  "__pycache__",
  ".venv",
  ".git/objects",
  ".git/logs",
  ".git/FETCH_HEAD",
];

function normalizeRelativePath(root, eventPath) {
  if (!eventPath || typeof eventPath !== "string") return "";
  const relative = path.relative(root, eventPath).replace(/\\/g, "/");
  return relative || ".";
}

async function main() {
  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    const ignore = IGNORE_DIRS.map((name) => path.join(resolved, name));
    const scope = path.basename(resolved) === ".git" ? "git" : "worktree";

    // Match VS Code's split watcher model more closely:
    // - the repository root watcher should ignore the entire .git subtree
    // - a dedicated .git watcher handles git metadata changes separately
    if (path.basename(resolved) !== ".git") {
      ignore.push(path.join(resolved, ".git"));
    }

    await binding.subscribe(
      resolved,
      (err, events) => {
        if (err) return;
        const relevantEvents = Array.isArray(events) ? events : [];
        const relativePaths = relevantEvents
          .map((event) => normalizeRelativePath(resolved, event && event.path))
          .filter(Boolean);

        const filteredPaths =
          scope === "worktree"
            ? relativePaths.filter(
                (relativePath) => relativePath !== ".git" && !relativePath.startsWith(".git/"),
              )
            : relativePaths;

        if (scope === "worktree" && filteredPaths.length === 0 && relativePaths.length > 0) {
          return;
        }

        const samples = (filteredPaths.length > 0 ? filteredPaths : relativePaths).slice(0, 5);
        const suffix =
          samples.length > 0
            ? `:${JSON.stringify(samples)}${filteredPaths.length > 5 ? `:${filteredPaths.length}` : ""}`
            : "";
        process.stdout.write(`changed:${scope}${suffix}\n`);
      },
      { backend: "inotify", ignore },
    );
  }
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err.message || err}\n`);
  process.exit(1);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
