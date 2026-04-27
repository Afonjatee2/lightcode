import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copyPluginAssetFile,
  copyPluginAssetsIfStale,
  createPluginSourceResolver,
  isPluginAssetsFresh,
  isWslPluginContext,
  PLUGIN_ASSET_FILES,
  quoteHookCommandArg,
  readBundledPluginVersion,
  readPluginManifest,
  warnIfPluginManifestMissing,
} from "./installerBase";

const tempDirs: string[] = [];

function makeTempDir(prefix = "lightcode-installer-base-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("isWslPluginContext", () => {
  it("narrows to WSL context only when both envKind and wslDistro are set", () => {
    expect(isWslPluginContext({ envKind: "wsl", wslDistro: "Ubuntu" })).toBe(true);
    expect(isWslPluginContext({ envKind: "wsl" })).toBe(false);
    expect(isWslPluginContext({ envKind: "posix", wslDistro: "Ubuntu" })).toBe(false);
    expect(isWslPluginContext({ envKind: "windows" })).toBe(false);
    expect(isWslPluginContext(undefined)).toBe(false);
  });
});

describe("createPluginSourceResolver", () => {
  const ENV_KEY = "LIGHTCODE_TEST_PLUGIN_SOURCE";

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("resolves and memoizes the override env path", () => {
    const sourceDir = makeTempDir();
    writeFileSync(join(sourceDir, "plugin.json"), '{"version":"1.2.3"}', "utf8");
    process.env[ENV_KEY] = sourceDir;
    const resolve = createPluginSourceResolver({
      kind: "test",
      sourceEnvVar: ENV_KEY,
      callerDir: makeTempDir(),
    });

    expect(resolve()).toBe(sourceDir);

    // Mutating env after first call must NOT affect subsequent resolutions.
    const otherDir = makeTempDir();
    writeFileSync(join(otherDir, "plugin.json"), '{"version":"9.9.9"}', "utf8");
    process.env[ENV_KEY] = otherDir;
    expect(resolve()).toBe(sourceDir);
  });

  it("throws when no candidate contains plugin.json", () => {
    const resolve = createPluginSourceResolver({
      kind: "test",
      sourceEnvVar: ENV_KEY,
      callerDir: makeTempDir(),
    });
    expect(() => resolve()).toThrow(/test plugin source dir not found/);
  });
});

describe("readPluginManifest + readBundledPluginVersion", () => {
  it("reads version from plugin.json", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "plugin.json"), '{"version":"4.5.6"}', "utf8");
    expect(readPluginManifest(dir).version).toBe("4.5.6");
  });

  it("returns 0.0.0 sentinel when manifest is missing or malformed", () => {
    const empty = makeTempDir();
    expect(readBundledPluginVersion(() => empty)).toBe("0.0.0");

    const bad = makeTempDir();
    writeFileSync(join(bad, "plugin.json"), "not-json", "utf8");
    expect(readBundledPluginVersion(() => bad)).toBe("0.0.0");

    const noVersion = makeTempDir();
    writeFileSync(join(noVersion, "plugin.json"), "{}", "utf8");
    expect(readBundledPluginVersion(() => noVersion)).toBe("0.0.0");
  });

  it("propagates resolver errors as 0.0.0", () => {
    expect(
      readBundledPluginVersion(() => {
        throw new Error("boom");
      }),
    ).toBe("0.0.0");
  });
});

describe("isPluginAssetsFresh + copyPluginAssetsIfStale", () => {
  function seedSource(): string {
    const sourceDir = makeTempDir("lightcode-installer-base-src-");
    for (const file of PLUGIN_ASSET_FILES) {
      writeFileSync(join(sourceDir, file), `${file} v1`, "utf8");
    }
    return sourceDir;
  }

  it("reports stale when target is missing files", () => {
    const sourceDir = seedSource();
    const targetDir = makeTempDir();
    expect(isPluginAssetsFresh(sourceDir, targetDir)).toBe(false);
  });

  it("copies into the target dir when stale", () => {
    const sourceDir = seedSource();
    const targetDir = makeTempDir();
    copyPluginAssetsIfStale(sourceDir, targetDir);
    for (const file of PLUGIN_ASSET_FILES) {
      expect(readFileSync(join(targetDir, file), "utf8")).toBe(`${file} v1`);
    }
    expect(isPluginAssetsFresh(sourceDir, targetDir)).toBe(true);
  });

  it("skips copy when target is fresh by size+mtime", () => {
    const sourceDir = seedSource();
    const targetDir = makeTempDir();
    copyPluginAssetsIfStale(sourceDir, targetDir);

    // Mark targets as up-to-date (mtime >= source). copyFileSync on Windows
    // may not preserve mtime exactly, so explicitly bump targets forward.
    const future = new Date(Date.now() + 60_000);
    for (const file of PLUGIN_ASSET_FILES) {
      utimesSync(join(targetDir, file), future, future);
    }

    // Mutate target content but keep size — heuristic should still treat fresh.
    for (const file of PLUGIN_ASSET_FILES) {
      const original = readFileSync(join(sourceDir, file));
      const targetPath = join(targetDir, file);
      const tampered = Buffer.alloc(original.length, "X");
      writeFileSync(targetPath, tampered);
      utimesSync(targetPath, future, future);
    }

    expect(isPluginAssetsFresh(sourceDir, targetDir)).toBe(true);
    copyPluginAssetsIfStale(sourceDir, targetDir);

    // Tampered content remains because the heuristic considered it fresh.
    expect(readFileSync(join(targetDir, "plugin.json"), "utf8")).not.toBe("plugin.json v1");
  });

  it("re-copies when source mtime is newer than target", () => {
    const sourceDir = seedSource();
    const targetDir = makeTempDir();
    copyPluginAssetsIfStale(sourceDir, targetDir);

    // Backdate the targets so the source looks newer.
    const past = new Date(Date.now() - 60_000);
    for (const file of PLUGIN_ASSET_FILES) {
      utimesSync(join(targetDir, file), past, past);
    }
    // Bump source content to a different size + mtime.
    for (const file of PLUGIN_ASSET_FILES) {
      writeFileSync(join(sourceDir, file), `${file} v2-larger`, "utf8");
    }

    expect(isPluginAssetsFresh(sourceDir, targetDir)).toBe(false);
    copyPluginAssetsIfStale(sourceDir, targetDir);
    expect(readFileSync(join(targetDir, "plugin.json"), "utf8")).toBe("plugin.json v2-larger");
  });

  it("copyPluginAssetFile creates intermediate directories", () => {
    const sourceDir = makeTempDir();
    writeFileSync(join(sourceDir, "plugin.json"), "x", "utf8");
    const targetDir = makeTempDir();
    const nested = join(targetDir, "a", "b", "c", "plugin.json");
    copyPluginAssetFile(join(sourceDir, "plugin.json"), nested);
    expect(existsSync(nested)).toBe(true);
    expect(readFileSync(nested, "utf8")).toBe("x");
    // statSync verifies the file is real, not a broken symlink.
    expect(statSync(nested).isFile()).toBe(true);
  });
});

describe("quoteHookCommandArg", () => {
  it("uses POSIX single-quote escaping for wsl target on any platform", () => {
    expect(quoteHookCommandArg("/home/u/forward.mjs", "wsl")).toBe("'/home/u/forward.mjs'");
    expect(quoteHookCommandArg("a'b", "wsl")).toBe("'a'\\''b'");
  });

  it("matches platform when target is native", () => {
    const expected =
      process.platform === "win32" ? '"C:\\Users\\u\\fw.mjs"' : "'C:\\Users\\u\\fw.mjs'";
    expect(quoteHookCommandArg("C:\\Users\\u\\fw.mjs", "native")).toBe(expected);
  });

  it("escapes embedded special chars per platform on native", () => {
    const expected = process.platform === "win32" ? '"a\\"b"' : "'a\"b'";
    expect(quoteHookCommandArg('a"b', "native")).toBe(expected);
  });
});

describe("warnIfPluginManifestMissing", () => {
  let originalWarn: typeof console.warn;
  let calls: unknown[][];

  beforeEach(() => {
    calls = [];
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      calls.push(args);
    };
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  it("emits a warning for the 0.0.0 sentinel and stays silent otherwise", () => {
    warnIfPluginManifestMissing("test", "1.2.3");
    expect(calls).toHaveLength(0);

    warnIfPluginManifestMissing("test", "0.0.0");
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toContain("[test]");
  });

  it("appends the dev hint when provided", () => {
    warnIfPluginManifestMissing("test", "0.0.0", "Expected at src/...");
    expect(String(calls[0]?.[0])).toContain("Expected at src/...");
  });
});
