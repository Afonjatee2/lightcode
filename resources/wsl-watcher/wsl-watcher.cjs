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
];

async function main() {
  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    const ignore = IGNORE_DIRS.map((name) => path.join(resolved, name));

    await binding.subscribe(
      resolved,
      (err, _events) => {
        if (err) return;
        process.stdout.write("changed\n");
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
