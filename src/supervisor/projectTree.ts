import type { Dirent, Stats } from "node:fs";
import { readdir, readFile, rename, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { readWslCommandOutputAsync } from "./agents/base";
import type {
  CreateProjectEntryPayload,
  DeleteProjectEntryPayload,
  ListProjectTreePayload,
  ListProjectTreeResult,
  MoveProjectEntryPayload,
  ProjectLocation,
  ProjectTreeEntry,
  ReadProjectFilePayload,
  ReadProjectFileResult,
  RenameProjectEntryPayload,
  SearchProjectTreePayload,
  SearchProjectTreeResult,
  WriteProjectFilePayload,
  WriteProjectFileResult,
} from "@/shared/contracts";
import { getLocationIdentity } from "./git";

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const CACHE_TTL_MS = 10_000;
const MAX_CACHE_ENTRIES = 4;
const MAX_SEARCH_INDEX_SIZE = 50_000;
const MAX_EDITABLE_FILE_SIZE = 1_000_000;

interface CachedSearchIndex {
  entries: ProjectTreeEntry[];
  createdAt: number;
}

function getProjectRootPath(location: ProjectLocation): string {
  if (location.kind === "wsl") return location.uncPath;
  return location.path;
}

function normalizeRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return "";
  const parts = normalized.split("/");
  const resolvedParts: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      throw new Error("Path traversal is not allowed.");
    }
    resolvedParts.push(part);
  }
  return resolvedParts.join("/");
}

function joinRelativePath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

function getParentRelativePath(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function validateEntryName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name cannot be empty.");
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("Name cannot contain path separators.");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("Invalid name.");
  }
  return trimmed;
}

function isBinaryBuffer(buffer: Buffer): boolean {
  for (const byte of buffer) {
    if (byte === 0) return true;
  }
  return false;
}

function detectLineEnding(content: string): "lf" | "crlf" {
  return content.includes("\r\n") ? "crlf" : "lf";
}

function normalizeContentForWrite(content: string, lineEnding: "lf" | "crlf"): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return lineEnding === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

function sortEntries(entries: ProjectTreeEntry[]): ProjectTreeEntry[] {
  return entries.toSorted((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

export class ProjectTreeService {
  private searchCache = new Map<string, CachedSearchIndex>();

  async listProjectTree(payload: ListProjectTreePayload): Promise<ListProjectTreeResult> {
    const directoryPath = normalizeRelativePath(payload.directoryPath);
    const fullPath = this.resolveEntryPath(payload.projectLocation, directoryPath);
    const entries = await readdir(fullPath, { withFileTypes: true });
    const visible = entries.filter((entry) => entry.name !== ".git");

    // Batch-classify symlinks so we don't spawn one wsl.exe per symlink.
    const symlinkDirs = await this.classifySymlinks(
      payload.projectLocation,
      directoryPath,
      visible,
    );

    const visibleEntries = await Promise.all(
      visible.map(async (entry): Promise<ProjectTreeEntry> => {
        const path = joinRelativePath(directoryPath, entry.name);
        const isDir = entry.isDirectory() || symlinkDirs.has(entry.name);

        if (isDir) {
          return {
            path,
            name: entry.name,
            type: "directory",
            hasChildren: await this.directoryHasVisibleChildren(
              this.resolveEntryPath(payload.projectLocation, path),
            ),
          };
        }
        return { path, name: entry.name, type: "file" };
      }),
    );

    return {
      directoryPath,
      entries: sortEntries(visibleEntries),
    };
  }

  async searchProjectTree(payload: SearchProjectTreePayload): Promise<SearchProjectTreeResult> {
    const query = payload.query.trim().toLowerCase();
    if (!query) return { entries: [] };

    const { entries } = await this.getOrBuildSearchIndex(payload.projectLocation);
    return {
      entries: this.rankEntries(entries, query, payload.limit),
    };
  }

  async readProjectFile(payload: ReadProjectFilePayload): Promise<ReadProjectFileResult> {
    const path = normalizeRelativePath(payload.path);
    const { fullPath, fileStat } = await this.statFollowingWslSymlinks(
      payload.projectLocation,
      path,
    );
    if (!fileStat.isFile()) {
      throw new Error("Only files can be opened in the editor.");
    }

    if (fileStat.size > MAX_EDITABLE_FILE_SIZE) {
      return { path, status: "too_large", modifiedAtMs: fileStat.mtimeMs };
    }

    const buffer = await readFile(fullPath);
    if (isBinaryBuffer(buffer)) {
      return { path, status: "binary", modifiedAtMs: fileStat.mtimeMs };
    }

    const hasBom = buffer.subarray(0, BOM.length).equals(BOM);
    const contentBuffer = hasBom ? buffer.subarray(BOM.length) : buffer;

    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(contentBuffer);
    } catch {
      return { path, status: "unsupported", modifiedAtMs: fileStat.mtimeMs };
    }

    return {
      path,
      status: "ready",
      modifiedAtMs: fileStat.mtimeMs,
      content,
      lineEnding: detectLineEnding(content),
      hasBom,
    };
  }

  async writeProjectFile(payload: WriteProjectFilePayload): Promise<WriteProjectFileResult> {
    const path = normalizeRelativePath(payload.path);
    const { fullPath, fileStat } = await this.statFollowingWslSymlinks(
      payload.projectLocation,
      path,
    );
    if (!fileStat.isFile()) {
      throw new Error("Only files can be saved from the editor.");
    }
    if (Math.abs(fileStat.mtimeMs - payload.baseModifiedAtMs) > 1) {
      throw new Error("The file changed on disk. Reload it before saving.");
    }
    if (fileStat.size > MAX_EDITABLE_FILE_SIZE) {
      throw new Error("This file is too large to save from the editor.");
    }

    const existingBuffer = await readFile(fullPath);
    if (isBinaryBuffer(existingBuffer)) {
      throw new Error("Binary files cannot be saved from the editor.");
    }

    const hasBom = existingBuffer.subarray(0, BOM.length).equals(BOM);
    const contentBuffer = hasBom ? existingBuffer.subarray(BOM.length) : existingBuffer;

    let existingContent = "";
    try {
      existingContent = new TextDecoder("utf-8", { fatal: true }).decode(contentBuffer);
    } catch {
      throw new Error("This file uses an unsupported encoding.");
    }

    const nextContent = normalizeContentForWrite(
      payload.content,
      detectLineEnding(existingContent),
    );
    const nextBuffer = Buffer.from(nextContent, "utf8");
    await writeFile(fullPath, hasBom ? Buffer.concat([BOM, nextBuffer]) : nextBuffer);
    this.invalidateCaches(payload.projectLocation);
    const nextStat = await stat(fullPath);
    return { modifiedAtMs: nextStat.mtimeMs };
  }

  async createProjectEntry(payload: CreateProjectEntryPayload): Promise<void> {
    const path = normalizeRelativePath(payload.path);
    if (!path) {
      throw new Error("A new entry must have a path.");
    }
    const fullPath = this.resolveEntryPath(payload.projectLocation, path);
    await mkdir(dirname(fullPath), { recursive: true });
    if (payload.type === "directory") {
      await mkdir(fullPath);
    } else {
      await writeFile(fullPath, "");
    }
    this.invalidateCaches(payload.projectLocation);
  }

  async renameProjectEntry(payload: RenameProjectEntryPayload): Promise<void> {
    const path = normalizeRelativePath(payload.path);
    const nextName = validateEntryName(payload.nextName);
    const nextPath = joinRelativePath(getParentRelativePath(path), nextName);
    if (nextPath === path) return;
    await rename(
      this.resolveEntryPath(payload.projectLocation, path),
      this.resolveEntryPath(payload.projectLocation, nextPath),
    );
    this.invalidateCaches(payload.projectLocation);
  }

  async moveProjectEntry(payload: MoveProjectEntryPayload): Promise<void> {
    const path = normalizeRelativePath(payload.path);
    const nextParentPath = normalizeRelativePath(payload.nextParentPath);
    if (!path) {
      throw new Error("The project root cannot be moved.");
    }

    const currentName = path.split("/").at(-1);
    if (!currentName) throw new Error("Invalid path.");

    const { fullPath: sourceFullPath, fileStat: entryStat } = await this.statFollowingWslSymlinks(
      payload.projectLocation,
      path,
    );
    const nextPath = joinRelativePath(nextParentPath, currentName);
    if (nextPath === path) return;
    if (
      entryStat.isDirectory() &&
      (nextParentPath === path || nextParentPath.startsWith(`${path}/`))
    ) {
      throw new Error("Folders cannot be moved into themselves.");
    }

    await rename(sourceFullPath, this.resolveEntryPath(payload.projectLocation, nextPath));
    this.invalidateCaches(payload.projectLocation);
  }

  async deleteProjectEntry(payload: DeleteProjectEntryPayload): Promise<void> {
    const path = normalizeRelativePath(payload.path);
    await rm(this.resolveEntryPath(payload.projectLocation, path), {
      recursive: true,
      force: false,
    });
    this.invalidateCaches(payload.projectLocation);
  }

  private async getOrBuildSearchIndex(
    location: ProjectLocation,
  ): Promise<{ entries: ProjectTreeEntry[] }> {
    const key = getLocationIdentity(location);
    const cached = this.searchCache.get(key);
    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
      this.searchCache.delete(key);
      this.searchCache.set(key, cached);
      return { entries: cached.entries };
    }

    const entries = await this.buildSearchIndex(location);
    if (this.searchCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.searchCache.keys().next().value;
      if (oldest !== undefined) this.searchCache.delete(oldest);
    }
    this.searchCache.set(key, { entries, createdAt: Date.now() });
    return { entries };
  }

  private async buildSearchIndex(location: ProjectLocation): Promise<ProjectTreeEntry[]> {
    const rootPath = getProjectRootPath(location);
    const stack = [""];
    const results: ProjectTreeEntry[] = [];

    while (stack.length > 0 && results.length < MAX_SEARCH_INDEX_SIZE) {
      const directoryPath = stack.pop()!;
      const fullPath = directoryPath ? this.resolveEntryPath(location, directoryPath) : rootPath;
      const entries = await readdir(fullPath, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name === ".git") continue;
        const path = joinRelativePath(directoryPath, entry.name);
        if (entry.isDirectory()) {
          results.push({ path, name: entry.name, type: "directory", hasChildren: true });
          if (results.length >= MAX_SEARCH_INDEX_SIZE) break;
          stack.push(path);
          continue;
        }
        results.push({ path, name: entry.name, type: "file" });
        if (results.length >= MAX_SEARCH_INDEX_SIZE) break;
      }
    }

    return results;
  }

  private rankEntries(
    entries: ProjectTreeEntry[],
    query: string,
    limit: number,
  ): ProjectTreeEntry[] {
    const scored: { entry: ProjectTreeEntry; score: number }[] = [];
    for (const entry of entries) {
      const nameLower = entry.name.toLowerCase();
      const pathLower = entry.path.toLowerCase();
      let score = 0;
      if (nameLower.startsWith(query)) score = 3;
      else if (nameLower.includes(query)) score = 2;
      else if (pathLower.includes(query)) score = 1;
      if (score > 0) scored.push({ entry, score });
    }

    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.entry.type !== b.entry.type) return a.entry.type === "file" ? -1 : 1;
      if (a.entry.path.length !== b.entry.path.length) {
        return a.entry.path.length - b.entry.path.length;
      }
      return a.entry.path.localeCompare(b.entry.path, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

    return scored.slice(0, limit).map((item) => item.entry);
  }

  private resolveEntryPath(location: ProjectLocation, path: string): string {
    const rootPath = resolve(getProjectRootPath(location));
    const candidatePath = resolve(
      rootPath,
      ...normalizeRelativePath(path).split("/").filter(Boolean),
    );
    const relativePath = relative(rootPath, candidatePath);
    if (relativePath.startsWith("..") || relativePath === ".." || isAbsolute(relativePath)) {
      throw new Error("Path escapes the project root.");
    }
    return candidatePath;
  }

  /**
   * Determine which symlink entries point to directories.
   * For WSL projects this runs a single batched `wsl.exe` command instead of
   * spawning one process per symlink (~800-1000ms each).
   * Returns a Set of entry names whose symlink targets are directories.
   */
  private async classifySymlinks(
    location: ProjectLocation,
    directoryPath: string,
    entries: Dirent[],
  ): Promise<Set<string>> {
    const symlinks = entries.filter((e) => e.isSymbolicLink());
    if (symlinks.length === 0) return new Set();

    if (location.kind === "wsl") {
      return this.classifyWslSymlinks(location, directoryPath, symlinks);
    }

    // Non-WSL: stat each symlink locally (fast syscall, follows symlinks).
    const dirNames = new Set<string>();
    await Promise.all(
      symlinks.map(async (entry) => {
        try {
          const path = joinRelativePath(directoryPath, entry.name);
          const full = this.resolveEntryPath(location, path);
          if ((await stat(full)).isDirectory()) dirNames.add(entry.name);
        } catch {
          // broken symlink
        }
      }),
    );
    return dirNames;
  }

  /** Batch-classify WSL symlinks via a single `wsl.exe` invocation. */
  private async classifyWslSymlinks(
    location: Extract<ProjectLocation, { kind: "wsl" }>,
    directoryPath: string,
    symlinks: Dirent[],
  ): Promise<Set<string>> {
    const linuxDir = directoryPath ? `${location.linuxPath}/${directoryPath}` : location.linuxPath;

    // Build a POSIX script that outputs 'd' or 'f' per symlink, one per line.
    const tests = symlinks
      .map((e) => {
        const escaped = e.name.replace(/'/g, "'\\''");
        return `test -d '${linuxDir}/${escaped}' && printf 'd\\n' || printf 'f\\n'`;
      })
      .join(";");

    const result = await readWslCommandOutputAsync(location.distro, "sh", ["-c", tests]);

    const dirNames = new Set<string>();
    if (result.ok) {
      const lines = result.stdout.split("\n");
      for (let i = 0; i < symlinks.length; i++) {
        if (lines[i]?.trim() === "d") dirNames.add(symlinks[i]!.name);
      }
    }
    return dirNames;
  }

  /**
   * `stat()` a project entry, following WSL symlinks when necessary.
   * Returns both the resolved path and the Stats object so callers never
   * need a redundant second `stat()`.
   *
   * The Windows 9P bridge cannot follow Linux symlinks over UNC paths, so
   * when `stat` fails with ENOENT on a WSL location we resolve the real
   * path via `realpath` inside the distro and rebuild the UNC path.
   */
  private async statFollowingWslSymlinks(
    location: ProjectLocation,
    relativePath: string,
  ): Promise<{ fullPath: string; fileStat: Stats }> {
    const fullPath = this.resolveEntryPath(location, relativePath);
    try {
      return { fullPath, fileStat: await stat(fullPath) };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT" || location.kind !== "wsl") throw err;
    }

    // UNC stat failed — the path likely contains Linux symlinks.
    // Ask WSL to resolve the real path inside the distro.
    const linuxTarget = relativePath ? `${location.linuxPath}/${relativePath}` : location.linuxPath;
    const result = await readWslCommandOutputAsync(location.distro, "realpath", [
      "-e",
      linuxTarget,
    ]);
    if (!result.ok) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${fullPath}'`), {
        code: "ENOENT",
        syscall: "stat",
        path: fullPath,
      });
    }
    const resolved = `\\\\wsl.localhost\\${location.distro}${result.stdout.replace(/\//g, "\\")}`;
    return { fullPath: resolved, fileStat: await stat(resolved) };
  }

  private async directoryHasVisibleChildren(fullPath: string): Promise<boolean> {
    const entries = await readdir(fullPath, { withFileTypes: true }).catch(() => []);
    return entries.some((entry) => entry.name !== ".git");
  }

  private invalidateCaches(location: ProjectLocation): void {
    this.searchCache.delete(getLocationIdentity(location));
  }
}
