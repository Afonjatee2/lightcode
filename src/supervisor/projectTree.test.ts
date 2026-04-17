import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import type { ProjectLocation } from "@/shared/contracts";
import { ProjectTreeService } from "./projectTree";

describe("ProjectTreeService", () => {
  let tempDir: string;
  let location: ProjectLocation;
  let service: ProjectTreeService;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lightcode-project-tree-"));
    location =
      process.platform === "win32"
        ? { kind: "windows", path: tempDir }
        : { kind: "posix", path: tempDir };
    service = new ProjectTreeService();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("lists visible entries and excludes .git", async () => {
    mkdirSync(join(tempDir, ".git"), { recursive: true });
    mkdirSync(join(tempDir, "src"), { recursive: true });
    mkdirSync(join(tempDir, "empty-dir"), { recursive: true });
    writeFileSync(join(tempDir, "README.md"), "# readme\n", "utf8");
    writeFileSync(join(tempDir, "src", "index.ts"), "export {};\n", "utf8");

    const result = await service.listProjectTree({
      projectLocation: location,
      directoryPath: "",
    });

    expect(result.entries).toEqual([
      { path: "empty-dir", name: "empty-dir", type: "directory", hasChildren: false },
      { path: "src", name: "src", type: "directory", hasChildren: true },
      { path: "README.md", name: "README.md", type: "file" },
    ]);
  });

  it("reads utf-8 text files and preserves CRLF on write", async () => {
    writeFileSync(join(tempDir, "note.txt"), "a\r\nb\r\n", "utf8");

    const readResult = await service.readProjectFile({
      projectLocation: location,
      path: "note.txt",
    });
    expect(readResult).toMatchObject({
      path: "note.txt",
      status: "ready",
      content: "a\r\nb\r\n",
      lineEnding: "crlf",
    });

    const saveResult = await service.writeProjectFile({
      projectLocation: location,
      path: "note.txt",
      content: "x\ny\n",
      baseModifiedAtMs: readResult.modifiedAtMs,
    });
    expect(saveResult.modifiedAtMs).toBeGreaterThanOrEqual(readResult.modifiedAtMs);
    expect(readFileSync(join(tempDir, "note.txt"), "utf8")).toBe("x\r\ny\r\n");
  });

  it("marks binary files as non-editable", async () => {
    writeFileSync(join(tempDir, "image.bin"), Buffer.from([0x61, 0x00, 0x62]));

    const result = await service.readProjectFile({
      projectLocation: location,
      path: "image.bin",
    });

    expect(result.status).toBe("binary");
  });

  it("creates, renames, moves, and deletes entries", async () => {
    mkdirSync(join(tempDir, "src"), { recursive: true });

    await service.createProjectEntry({
      projectLocation: location,
      path: "src/example.ts",
      type: "file",
    });
    expect(existsSync(join(tempDir, "src", "example.ts"))).toBe(true);

    await service.renameProjectEntry({
      projectLocation: location,
      path: "src/example.ts",
      nextName: "renamed.ts",
    });
    expect(existsSync(join(tempDir, "src", "renamed.ts"))).toBe(true);

    await service.createProjectEntry({
      projectLocation: location,
      path: "dest",
      type: "directory",
    });
    await service.moveProjectEntry({
      projectLocation: location,
      path: "src/renamed.ts",
      nextParentPath: "dest",
    });
    expect(existsSync(join(tempDir, "dest", "renamed.ts"))).toBe(true);

    await service.deleteProjectEntry({
      projectLocation: location,
      path: "dest/renamed.ts",
    });
    expect(existsSync(join(tempDir, "dest", "renamed.ts"))).toBe(false);
  });
});
