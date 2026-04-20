import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { terminateChildProcessTree } from "@/shared/processTree";
import { type AgentEventEnvelope, agentEventEnvelopeSchema } from "@/shared/contracts/agentEvent";
import { getWslCommand } from "../../agents/base";
import { isLightcodeHookDebug } from "../../runtime/hookDebug";
import { deployFilesToWslHome, readBundledHelperVersion, resolveWslHelpersDir } from "../wslDeploy";
import { attachLineSplitter, spawnWslLineChild, type WslLineChildOpts } from "../wslChild";

const execFileAsync = promisify(execFile);

export type HookEventReceiver = (event: AgentEventEnvelope) => void;

export interface WslHookBridgeManagerOptions {
  /** Same callback shape as `HookIngress` so dispatcher logic stays unified. */
  onEvent: HookEventReceiver;
  /** Optional logger; defaults to no-op. */
  onError?: (message: string, error?: unknown) => void;
  /** Bearer secret shared with the Windows-side `HookIngress`. */
  secret: string;
  /** Supervisor's max protocol version, exposed to the in-WSL bridge. */
  protocolVersion: number;
  /**
   * Test seam: replace the underlying `wsl.exe` spawner. Defaults to
   * `spawnWslLineChild`. The test stub can synthesise boot + event lines
   * without touching real `wsl.exe`.
   */
  spawn?: (opts: WslLineChildOpts) => ChildProcess;
  /**
   * Test seam: replace the in-WSL `node` probe. Defaults to running
   * `wsl.exe -d <distro> -- which node`.
   */
  probeNode?: (distro: string) => Promise<boolean>;
  /**
   * Test seam: replace the deploy step. Defaults to `deployFilesToWslHome`.
   */
  deploy?: (
    distro: string,
    files: { src: string; relDest: string }[],
  ) => { home: string; linuxBaseDir: string } | null;
  /** Optional override for the resources dir (defaults to `resolveWslHelpersDir`). */
  helpersDir?: string;
  /**
   * Maximum time to wait for the bridge to write its `boot` line. Defaults
   * to 10 seconds — enough for a cold-start `wsl.exe` invocation but bounded
   * so a stuck distro can't pin a thread spawn forever.
   */
  bootTimeoutMs?: number;
}

export interface BridgeHandle {
  /** URL plugins inside the distro POST to. */
  url: string;
}

interface BridgeState {
  child: ChildProcess;
  handle: BridgeHandle;
}

const DEFAULT_BOOT_TIMEOUT_MS = 10_000;

/**
 * Owns one in-WSL bridge per distro. The bridge is `node bridge.mjs`
 * staged under `~/.lightcode/bridge/bridge.mjs` and spawned via `wsl.exe`.
 * Its stdout JSONL stream is parsed here:
 *
 *   {"type":"boot","port":<n>,...}        → resolves the per-distro `ready`
 *                                            promise with the loopback URL
 *   {"type":"event","payload":<envelope>} → forwarded to `options.onEvent`
 *   {"type":"error","message":"…"}        → logged via `options.onError`
 *
 * Lazy: nothing happens until `ensureBridge(distro)` is called the first
 * time. Concurrent calls share the same in-flight promise. On child exit
 * the cache entry is cleared so the next call re-stages and re-spawns.
 */
export class WslHookBridgeManager {
  private readonly bridges = new Map<string, BridgeState>();
  private readonly inFlight = new Map<string, Promise<BridgeHandle | undefined>>();
  private readonly disposed = new WeakSet<BridgeState>();
  private readonly bootTimeoutMs: number;
  private isDisposed = false;

  constructor(private readonly options: WslHookBridgeManagerOptions) {
    this.bootTimeoutMs = options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
  }

  /**
   * Ensure a bridge is running for `distro` and return its loopback URL.
   * Returns `undefined` when the bridge could not be brought up — the
   * caller should silently fall back to L2 (TUI parsing).
   */
  async ensureBridge(distro: string): Promise<BridgeHandle | undefined> {
    if (this.isDisposed) return undefined;
    const existing = this.bridges.get(distro);
    if (existing) {
      if (isLightcodeHookDebug()) {
        console.log("[supervisor] hook-debug: WSL bridge (cached)", {
          distro,
          url: existing.handle.url,
        });
      }
      return existing.handle;
    }
    const inFlight = this.inFlight.get(distro);
    if (inFlight) return inFlight;
    const task = this.startBridge(distro).catch((error) => {
      this.options.onError?.(`wsl hook bridge failed for ${distro}`, error);
      return undefined;
    });
    this.inFlight.set(distro, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(distro);
    }
  }

  async dispose(): Promise<void> {
    this.isDisposed = true;
    const distros = [...this.bridges.keys()];
    for (const distro of distros) {
      const state = this.bridges.get(distro);
      if (!state) continue;
      this.bridges.delete(distro);
      this.disposed.add(state);
      try {
        terminateChildProcessTree(state.child);
      } catch {
        // best effort
      }
    }
  }

  /**
   * Spawn + wait-for-boot, with a one-shot retry when the booted bridge
   * reports a version different from the one we just staged. The retry
   * handles the (rare but real) case where a previous supervisor left a
   * running bridge inside WSL and our new deploy overwrote the file on
   * disk — the in-memory child is stale, so we kill it and respawn from
   * the fresh file. Capped at one retry to prevent infinite loops if the
   * version regex ever disagrees with reality.
   */
  private async startBridge(distro: string, attempt = 0): Promise<BridgeHandle | undefined> {
    const helpersDir = this.options.helpersDir ?? resolveWslHelpersDir();
    if (!helpersDir) {
      if (isLightcodeHookDebug()) {
        console.log("[supervisor] hook-debug: WSL bridge not started", {
          distro,
          reason: "no helpers dir (bundle LIGHTCODE_WSL_HELPERS_DIR / resources)",
        });
      }
      return undefined;
    }
    const bridgeSrc = join(helpersDir, "bridge.mjs");
    if (!existsSync(bridgeSrc)) {
      if (isLightcodeHookDebug()) {
        console.log("[supervisor] hook-debug: WSL bridge not started", {
          distro,
          reason: `missing ${bridgeSrc}`,
        });
      }
      return undefined;
    }

    const probe = this.options.probeNode ?? defaultProbeNode;
    const hasNode = await probe(distro).catch(() => false);
    if (!hasNode) {
      if (isLightcodeHookDebug()) {
        console.log("[supervisor] hook-debug: WSL bridge not started", {
          distro,
          reason: "no `node` in distro (install Node or PATH it)",
        });
      }
      return undefined;
    }

    const deploy = this.options.deploy ?? deployFilesToWslHome;
    const result = deploy(distro, [{ src: bridgeSrc, relDest: "bridge/bridge.mjs" }]);
    if (!result) {
      if (isLightcodeHookDebug()) {
        console.log("[supervisor] hook-debug: WSL bridge not started", {
          distro,
          reason: "deployFilesToWslHome failed (UNC path / home / permissions)",
        });
      }
      return undefined;
    }

    const linuxScriptPath = `${result.linuxBaseDir}/bridge/bridge.mjs`;

    let resolveBoot: (handle: BridgeHandle) => void = () => undefined;
    let rejectBoot: (error: Error) => void = () => undefined;
    const ready = new Promise<BridgeHandle>((resolve, reject) => {
      resolveBoot = resolve;
      rejectBoot = reject;
    });

    let booted = false;
    let reportedVersion: string | undefined;
    const onLine = (line: string): void => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== "object") return;
      const message = parsed as Record<string, unknown>;
      const type = message.type;
      if (type === "boot" && typeof message.port === "number") {
        booted = true;
        if (typeof message.version === "string" && message.version.length > 0) {
          reportedVersion = message.version;
        }
        if (isLightcodeHookDebug()) {
          console.log("[supervisor] hook-debug: WSL bridge booted in distro", {
            distro,
            port: message.port,
            version: reportedVersion ?? "(unversioned)",
            url: `http://127.0.0.1:${message.port}/v1/agent-event`,
          });
        }
        resolveBoot({ url: `http://127.0.0.1:${message.port}/v1/agent-event` });
        return;
      }
      if (type === "event" && message.payload && typeof message.payload === "object") {
        const candidate = message.payload as Record<string, unknown>;
        const envelope = agentEventEnvelopeSchema.safeParse(candidate);
        if (envelope.success) {
          try {
            this.options.onEvent(envelope.data);
          } catch (error) {
            this.options.onError?.("wsl hook bridge: receiver threw", error);
          }
        } else {
          this.options.onError?.(
            "wsl hook bridge: dropped malformed envelope",
            envelope.error.issues[0]?.message,
          );
        }
        return;
      }
      if (type === "error") {
        this.options.onError?.(`wsl hook bridge[${distro}]: ${String(message.message ?? "")}`);
      }
    };

    // Run through `bash -lc` (login shell) so nvm / fnm / user PATH is
    // sourced — otherwise `node` is absent in most non-system installs. This
    // mirrors `gitWatcher.spawnWslWatcher`, which is the canonical pattern
    // for launching Node inside a distro in this codebase.
    const shellScript = `exec node ${quoteForShell(linuxScriptPath)}`;
    const childOpts: WslLineChildOpts = {
      distro,
      argv: ["bash", "-lc", shellScript],
      env: {
        LIGHTCODE_HOOK_SECRET: this.options.secret,
        LIGHTCODE_HOOK_PROTOCOL_VERSION: String(this.options.protocolVersion),
      },
      stderr: "ignore",
      onLine,
      onError: (error) => {
        if (!booted) {
          rejectBoot(error);
        }
        this.options.onError?.(`wsl hook bridge[${distro}] child error`, error);
      },
    };

    const spawnFn = this.options.spawn ?? spawnWslLineChild;
    const child = spawnFn(childOpts);

    // For test stubs that don't wire stdout via spawnWslLineChild, attach
    // the splitter ourselves. Real `spawnWslLineChild` already attaches it
    // before returning, so the second attach is a no-op for production.
    if (this.options.spawn) {
      const splitterOpts: Pick<WslLineChildOpts, "onLine" | "onError"> = childOpts.onError
        ? { onLine, onError: childOpts.onError }
        : { onLine };
      attachLineSplitter(child, splitterOpts);
    }

    const onExit = (): void => {
      const state = this.bridges.get(distro);
      if (state && state.child === child) {
        this.bridges.delete(distro);
      }
      if (booted && isLightcodeHookDebug()) {
        console.log(
          "[supervisor] hook-debug: WSL bridge child exited (will respawn on next ensure)",
          {
            distro,
          },
        );
      }
      if (!booted) {
        rejectBoot(new Error(`wsl hook bridge[${distro}] exited before boot`));
      }
    };
    child.once("exit", onExit);

    const timeout = setTimeout(() => {
      if (!booted) {
        rejectBoot(new Error(`wsl hook bridge[${distro}] boot timed out`));
        try {
          terminateChildProcessTree(child);
        } catch {
          // best effort
        }
      }
    }, this.bootTimeoutMs);
    if (typeof timeout.unref === "function") timeout.unref();

    let handle: BridgeHandle | undefined;
    try {
      handle = await ready;
    } finally {
      clearTimeout(timeout);
    }

    if (!handle) return undefined;
    if (this.isDisposed) {
      try {
        terminateChildProcessTree(child);
      } catch {
        // best effort
      }
      return undefined;
    }

    const expectedVersion = readBundledHelperVersion("bridge.mjs", "BRIDGE_VERSION", helpersDir);
    if (
      expectedVersion &&
      reportedVersion &&
      reportedVersion !== expectedVersion &&
      attempt === 0
    ) {
      if (isLightcodeHookDebug()) {
        console.log("[supervisor] hook-debug: WSL bridge version mismatch, restarting", {
          distro,
          expected: expectedVersion,
          actual: reportedVersion,
        });
      }
      child.off("exit", onExit);
      try {
        terminateChildProcessTree(child);
      } catch {
        // best effort
      }
      return this.startBridge(distro, attempt + 1);
    }
    if (
      expectedVersion &&
      reportedVersion &&
      reportedVersion !== expectedVersion &&
      attempt > 0 &&
      isLightcodeHookDebug()
    ) {
      // We already restaged + respawned once; accept what the distro
      // reports and surface the divergence so it's visible in logs.
      console.log("[supervisor] hook-debug: WSL bridge version still mismatched after restart", {
        distro,
        expected: expectedVersion,
        actual: reportedVersion,
      });
    }
    this.bridges.set(distro, { child, handle });
    return handle;
  }
}

/**
 * Probe for `node` inside a distro the same way we actually launch the
 * bridge: via `bash -lc` so that nvm / fnm / user PATH is loaded. Using
 * `sh -lc` (which resolves to dash on Ubuntu) misses the `.bashrc` where
 * nvm publishes `node`, giving a false negative.
 */
async function defaultProbeNode(distro: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      getWslCommand(),
      ["-d", distro, "--", "bash", "-lc", "command -v node"],
      { windowsHide: true, timeout: 5_000 },
    );
    return Boolean(stdout && stdout.trim().length > 0);
  } catch {
    return false;
  }
}

/**
 * Single-quote a path for inclusion in a bash `-c` script. Linux paths
 * may contain spaces (e.g. `/home/me/My Projects/...`), and single quotes
 * escape every byte except `'` itself.
 */
function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
