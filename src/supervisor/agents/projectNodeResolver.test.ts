import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearProjectNodeBinCache, resolveProjectNodeBin } from "./projectNodeResolver";

describe.skipIf(process.platform === "win32")("resolveProjectNodeBin", () => {
  let tmp: string;
  let project: string;
  let nvmDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "lightcode-nvm-"));
    project = join(tmp, "project");
    nvmDir = join(tmp, ".nvm");
    mkdirSync(project, { recursive: true });
    mkdirSync(join(nvmDir, "versions", "node", "v24.13.1", "bin"), { recursive: true });
    mkdirSync(join(nvmDir, "versions", "node", "v22.14.0", "bin"), { recursive: true });
    mkdirSync(join(nvmDir, "versions", "node", "v20.3.1", "bin"), { recursive: true });
    clearProjectNodeBinCache();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    clearProjectNodeBinCache();
  });

  it("returns undefined when no version file is present", () => {
    expect(resolveProjectNodeBin(project, nvmDir)).toBeUndefined();
  });

  it("matches a major-only .nvmrc against the highest installed patch", () => {
    writeFileSync(join(project, ".nvmrc"), "24\n");
    expect(resolveProjectNodeBin(project, nvmDir)).toBe(
      join(nvmDir, "versions", "node", "v24.13.1", "bin"),
    );
  });

  it("matches an exact pinned version", () => {
    writeFileSync(join(project, ".nvmrc"), "v22.14.0\n");
    expect(resolveProjectNodeBin(project, nvmDir)).toBe(
      join(nvmDir, "versions", "node", "v22.14.0", "bin"),
    );
  });

  it("falls back to .node-version when .nvmrc is absent", () => {
    writeFileSync(join(project, ".node-version"), "20\n");
    expect(resolveProjectNodeBin(project, nvmDir)).toBe(
      join(nvmDir, "versions", "node", "v20.3.1", "bin"),
    );
  });

  it("walks up to find a version file in a parent directory", () => {
    writeFileSync(join(project, ".nvmrc"), "24\n");
    const nested = join(project, "packages", "app", "src");
    mkdirSync(nested, { recursive: true });
    expect(resolveProjectNodeBin(nested, nvmDir)).toBe(
      join(nvmDir, "versions", "node", "v24.13.1", "bin"),
    );
  });

  it("returns undefined when the requested version is not installed", () => {
    writeFileSync(join(project, ".nvmrc"), "18.0.0\n");
    expect(resolveProjectNodeBin(project, nvmDir)).toBeUndefined();
  });

  it("falls back to the highest installed version for non-numeric aliases", () => {
    writeFileSync(join(project, ".nvmrc"), "lts/iron\n");
    expect(resolveProjectNodeBin(project, nvmDir)).toBe(
      join(nvmDir, "versions", "node", "v24.13.1", "bin"),
    );
  });

  it("ignores comment lines in version files", () => {
    writeFileSync(join(project, ".nvmrc"), "# pinned by infra\n22\n");
    expect(resolveProjectNodeBin(project, nvmDir)).toBe(
      join(nvmDir, "versions", "node", "v22.14.0", "bin"),
    );
  });

  it("returns undefined when NVM_DIR has no installed versions", () => {
    writeFileSync(join(project, ".nvmrc"), "24\n");
    const emptyNvm = join(tmp, "empty-nvm");
    mkdirSync(emptyNvm, { recursive: true });
    expect(resolveProjectNodeBin(project, emptyNvm)).toBeUndefined();
  });
});
