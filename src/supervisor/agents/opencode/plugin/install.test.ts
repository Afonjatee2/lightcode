import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getOpenCodePluginPaths,
  installOpenCodePlugin,
  isOpenCodePluginInstalled,
  uninstallOpenCodePlugin,
} from "./install";

const tempDirs: string[] = [];
let originalConfigDir: string | undefined;

function makeBaseDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lightcode-opencode-plugin-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  if (originalConfigDir === undefined) {
    delete process.env.OPENCODE_CONFIG_DIR;
  } else {
    process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
  }
});

describe("getOpenCodePluginPaths", () => {
  it("places lightcode-managed staging under the supplied base dir", () => {
    const baseDir = makeBaseDir();
    process.env.OPENCODE_CONFIG_DIR = makeBaseDir();
    const paths = getOpenCodePluginPaths({ envKind: "posix", baseDir });
    expect(paths.pluginDir).toBe(join(baseDir, "agent-plugins", "opencode"));
    expect(paths.opencodePluginFile).toBe(
      join(process.env.OPENCODE_CONFIG_DIR, "plugins", "lightcode-status.mjs"),
    );
  });

  it("uses ~/.config/opencode/plugins when OPENCODE_CONFIG_DIR is unset", () => {
    const baseDir = makeBaseDir();
    delete process.env.OPENCODE_CONFIG_DIR;
    const paths = getOpenCodePluginPaths({ envKind: "posix", baseDir });
    expect(paths.opencodePluginFile.endsWith(join("plugins", "lightcode-status.mjs"))).toBe(true);
  });
});

describe("installOpenCodePlugin", () => {
  it("stages plugin assets and drops mjs+manifest into OpenCode's plugins dir", () => {
    const baseDir = makeBaseDir();
    const opencodeDir = makeBaseDir();
    process.env.OPENCODE_CONFIG_DIR = opencodeDir;

    const result = installOpenCodePlugin({ envKind: "posix", baseDir });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Lightcode-side staging
    expect(existsSync(join(result.paths.pluginDir, "plugin.json"))).toBe(true);
    expect(existsSync(join(result.paths.pluginDir, "plugin.mjs"))).toBe(true);

    // OpenCode-side drops
    const droppedFile = join(opencodeDir, "plugins", "lightcode-status.mjs");
    const droppedManifest = join(opencodeDir, "plugins", "lightcode-status.plugin.json");
    expect(existsSync(droppedFile)).toBe(true);
    expect(existsSync(droppedManifest)).toBe(true);

    // Drop files match the staged sources byte-for-byte so the plugin reads
    // the right version when OpenCode imports it.
    expect(
      readFileSync(join(result.paths.pluginDir, "plugin.mjs")).equals(readFileSync(droppedFile)),
    ).toBe(true);
    expect(
      readFileSync(join(result.paths.pluginDir, "plugin.json")).equals(
        readFileSync(droppedManifest),
      ),
    ).toBe(true);

    expect(isOpenCodePluginInstalled({ envKind: "posix", baseDir })).toMatchObject({
      installed: true,
      version: "1.0.0",
    });
  });

  it("is idempotent — restaging produces the same end state", () => {
    const baseDir = makeBaseDir();
    process.env.OPENCODE_CONFIG_DIR = makeBaseDir();

    const first = installOpenCodePlugin({ envKind: "posix", baseDir });
    expect(first.ok).toBe(true);

    const second = installOpenCodePlugin({ envKind: "posix", baseDir });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(isOpenCodePluginInstalled({ envKind: "posix", baseDir })).toMatchObject({
      installed: true,
    });
  });

  it("treats a hand-edited plugin file as not-installed", () => {
    const baseDir = makeBaseDir();
    const opencodeDir = makeBaseDir();
    process.env.OPENCODE_CONFIG_DIR = opencodeDir;

    const result = installOpenCodePlugin({ envKind: "posix", baseDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    writeFileSync(result.paths.opencodePluginFile, "// hand edit\n");

    expect(isOpenCodePluginInstalled({ envKind: "posix", baseDir })).toEqual({ installed: false });
  });

  it("treats a missing dropped file as not-installed", () => {
    const baseDir = makeBaseDir();
    const opencodeDir = makeBaseDir();
    process.env.OPENCODE_CONFIG_DIR = opencodeDir;

    const result = installOpenCodePlugin({ envKind: "posix", baseDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Simulate the user clearing OpenCode's plugins dir manually.
    unlinkSync(result.paths.opencodePluginFile);

    expect(isOpenCodePluginInstalled({ envKind: "posix", baseDir })).toEqual({ installed: false });
  });

  it("treats a missing dropped manifest as not-installed", () => {
    const baseDir = makeBaseDir();
    const opencodeDir = makeBaseDir();
    process.env.OPENCODE_CONFIG_DIR = opencodeDir;

    const result = installOpenCodePlugin({ envKind: "posix", baseDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    unlinkSync(join(opencodeDir, "plugins", "lightcode-status.plugin.json"));

    expect(isOpenCodePluginInstalled({ envKind: "posix", baseDir })).toEqual({ installed: false });
  });
});

describe("uninstallOpenCodePlugin", () => {
  it("removes both dropped files but leaves staging intact", () => {
    const baseDir = makeBaseDir();
    const opencodeDir = makeBaseDir();
    process.env.OPENCODE_CONFIG_DIR = opencodeDir;

    const result = installOpenCodePlugin({ envKind: "posix", baseDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    uninstallOpenCodePlugin({ envKind: "posix", baseDir });

    expect(existsSync(result.paths.opencodePluginFile)).toBe(false);
    expect(existsSync(join(opencodeDir, "plugins", "lightcode-status.plugin.json"))).toBe(false);
    expect(existsSync(join(result.paths.pluginDir, "plugin.json"))).toBe(true);
    expect(existsSync(join(result.paths.pluginDir, "plugin.mjs"))).toBe(true);
  });
});
