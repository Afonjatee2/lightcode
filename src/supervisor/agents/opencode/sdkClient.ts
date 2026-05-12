import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { ProjectLocation } from "@/shared/contracts";
import { resolveAgentBinaryPath } from "../binaryResolver";
import { buildOpenCodeServerCommand } from "./argv";
import { spawnOpenCodeServer, type OpenCodeServerHandle } from "./sdkServer";

/** Agent-side cwd that the SDK passes through to the server's session config. */
export function resolveOpenCodeSessionDirectory(location: ProjectLocation): string {
  switch (location.kind) {
    case "windows":
      return location.path;
    case "wsl":
      return location.linuxPath;
    case "posix":
      return location.path;
  }
}

function poolKey(location: ProjectLocation): string {
  switch (location.kind) {
    case "windows":
      return `windows:${location.path}`;
    case "wsl":
      return `wsl:${location.distro}:${location.linuxPath}`;
    case "posix":
      return `posix:${location.path}`;
  }
}

export interface AcquiredOpenCodeServer {
  client: OpencodeClient;
  baseUrl: string;
  handle: OpenCodeServerHandle;
  dispose(): Promise<void>;
}

interface ServerSnapshot {
  client: OpencodeClient;
  baseUrl: string;
  handle: OpenCodeServerHandle;
}

interface PoolEntry {
  key: string;
  ready: Promise<ServerSnapshot>;
  refCount: number;
}

// Per-project pool. The OpenCode HTTP server can host any number of sessions
// in the same SQLite store, so multiple GUI threads in the same project share
// one `opencode serve` process. Refcounted: the last release tears the server
// down; if a release races with a fresh acquire, the in-flight `ready` promise
// is reused.
const pool = new Map<string, PoolEntry>();

async function spawnAndWire(projectLocation: ProjectLocation): Promise<ServerSnapshot> {
  const resolvedExecPath = resolveAgentBinaryPath(projectLocation, "opencode");
  const command = buildOpenCodeServerCommand(projectLocation, resolvedExecPath);
  const handle = spawnOpenCodeServer(command);

  let baseUrl: string;
  try {
    baseUrl = await handle.baseUrl;
  } catch (err) {
    await handle.dispose();
    throw err;
  }

  const { createOpencodeClient } = await import("@opencode-ai/sdk/v2/client");
  const client = createOpencodeClient({
    baseUrl,
    directory: resolveOpenCodeSessionDirectory(projectLocation),
    throwOnError: true,
  });

  return { client, baseUrl, handle };
}

/**
 * Spawn (or reuse) an `opencode serve` for the given project, wait for the
 * ready URL, and return a wired-up SDK client. The local loopback server is
 * unauthenticated by design (no `OPENCODE_SERVER_PASSWORD` is set), matching
 * OpenCode's local app-server usage.
 *
 * Disposal is per-acquisition: each acquire returns its own `dispose()` that
 * decrements the refcount. The underlying server stays alive until the last
 * acquirer releases it. TUI flow calls `dispose()` immediately after
 * `session.create`; GUI flow keeps its acquisition for the thread's lifetime.
 */
export async function acquireOpenCodeServer(input: {
  projectLocation: ProjectLocation;
}): Promise<AcquiredOpenCodeServer> {
  const key = poolKey(input.projectLocation);
  let entry = pool.get(key);

  if (!entry) {
    const ready = spawnAndWire(input.projectLocation);
    entry = { key, ready, refCount: 0 };
    pool.set(key, entry);

    // If spawn fails, evict so the next acquire respawns instead of resolving
    // a poisoned promise forever.
    ready.catch(() => {
      if (pool.get(key) === entry) pool.delete(key);
    });

    // If the server crashes after wiring, evict so subsequent acquires get a
    // fresh process. Live acquirers will see I/O errors on next request and
    // surface them through the SDK.
    void ready.then((snapshot) => {
      snapshot.handle.child.once("exit", () => {
        if (pool.get(key) === entry) pool.delete(key);
      });
    });
  }

  const acquiringEntry = entry;
  acquiringEntry.refCount += 1;

  let snapshot: ServerSnapshot;
  try {
    snapshot = await acquiringEntry.ready;
  } catch (err) {
    acquiringEntry.refCount -= 1;
    throw err;
  }

  let released = false;
  return {
    client: snapshot.client,
    baseUrl: snapshot.baseUrl,
    handle: snapshot.handle,
    dispose: async () => {
      if (released) return;
      released = true;
      acquiringEntry.refCount -= 1;
      if (acquiringEntry.refCount > 0) return;
      if (pool.get(key) === acquiringEntry) pool.delete(key);
      await snapshot.handle.dispose();
    },
  };
}
