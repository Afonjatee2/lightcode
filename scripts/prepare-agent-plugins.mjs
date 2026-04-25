/**
 * Stages agent CLI hook plugin assets that must exist as real files on disk
 * (i.e. outside the electron asar, reachable by the agent's own child
 * processes). Mirrors the `prepare-wsl-helpers` pattern used for `bridge.mjs`
 * + `watcher.node`.
 *
 * In dev the supervisor resolves plugin assets directly from `src/…/plugin/`
 * via a path relative to `dist/main/supervisor.cjs`. In packaged builds the
 * `src/` tree is not included, so electron-builder must bundle these assets
 * as `extraResources` (kept out of `app.asar`) under
 * `<resources>/agent-plugins/<kind>/`. `resolveSourceDir()` in
 * `install.ts` checks `process.resourcesPath/agent-plugins/<kind>` first.
 *
 * Currently registered:
 *   - claude: plugin.json, forward.mjs
 *   - codex: plugin.json, forward.mjs
 *
 * The script is idempotent: each asset is only copied when missing or stale
 * (size/mtime mismatch).
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const destBase = join(repoRoot, "resources", "agent-plugins");

/** @type {ReadonlyArray<{ kind: string; assets: readonly string[]; srcDir: string }>} */
const PLUGINS = [
  {
    kind: "claude",
    assets: ["plugin.json", "forward.mjs"],
    srcDir: join(repoRoot, "src", "supervisor", "agents", "claude", "plugin"),
  },
  {
    kind: "codex",
    assets: ["plugin.json", "forward.mjs"],
    srcDir: join(repoRoot, "src", "supervisor", "agents", "codex", "plugin"),
  },
];

for (const plugin of PLUGINS) {
  stagePlugin(plugin);
}

function stagePlugin({ kind, assets, srcDir }) {
  const destDir = join(destBase, kind);
  mkdirSync(destDir, { recursive: true });

  for (const asset of assets) {
    const src = join(srcDir, asset);
    if (!existsSync(src)) {
      throw new Error(`[prepare-agent-plugins] missing ${kind} asset: ${src}`);
    }
    const dest = join(destDir, asset);

    // Always copy — size+mtime heuristics can falsely skip after partial
    // restages or same-size edits (matches the bug we fixed for bridge.mjs).
    // Plugin assets are small; the copy is <1ms.
    copyFileSync(src, dest);
    console.log(`[prepare-agent-plugins] ${kind}/${asset} -> ${dest}`);
  }
}
