import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { z } from "zod";
import {
  agentCapabilitySchema,
  agentSettingDefSchema,
  agentStatusSchema,
  type AgentStatus,
  type AgentStatusesResponse,
  type GetAgentStatusesPayload,
} from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import { normalizeSharedSettings } from "@/shared/settings";
import { normalizeWslListOutput } from "@/shared/wsl";
import {
  type AgentAdapter,
  type AgentEnvContext,
  getWslCommand,
  primeWslLoginEnv,
} from "../agents/base";

const execFileAsync = promisify(execFile);

function migrateSettingDef(definition: Record<string, unknown>): Record<string, unknown> {
  if (definition.type === "toggle" || definition.type === "select") {
    return definition;
  }
  if (typeof definition.default === "boolean") {
    const env =
      typeof definition.envVar === "string"
        ? { [definition.envVar]: "1" }
        : typeof definition.env === "object" && definition.env !== null
          ? definition.env
          : {};
    return { ...definition, type: "toggle", env };
  }
  return definition;
}

const cachedAgentStatusSchema = agentStatusSchema.extend({
  capabilities: agentCapabilitySchema.extend({
    settingDefs: z.array(agentSettingDefSchema).catch([]),
  }),
});

function parseCachedStatuses(entries: unknown[] | undefined): AgentStatus[] {
  if (!entries) {
    return [];
  }

  const results: AgentStatus[] = [];
  for (const entry of entries) {
    if (entry != null && typeof entry === "object") {
      const capabilities = (entry as Record<string, unknown>).capabilities;
      if (capabilities != null && typeof capabilities === "object") {
        const capRecord = capabilities as Record<string, unknown>;
        if (Array.isArray(capRecord.settingDefs)) {
          capRecord.settingDefs = capRecord.settingDefs.map((definition: unknown) =>
            definition != null && typeof definition === "object"
              ? migrateSettingDef(definition as Record<string, unknown>)
              : definition,
          );
        }
      }
    }

    const parsed = cachedAgentStatusSchema.safeParse(entry);
    if (parsed.success) {
      results.push(parsed.data);
    }
  }
  return results;
}

function filterWslStatusesForDistros(
  statuses: readonly AgentStatus[],
  distros: readonly string[],
): AgentStatus[] {
  if (distros.length === 0) {
    return [];
  }
  const distroSet = new Set(distros);
  return statuses.filter((status) => {
    if (status.envDistro === undefined) {
      return true;
    }
    return distroSet.has(status.envDistro);
  });
}

export async function detectWslAgentStatuses(
  adapters: Iterable<AgentAdapter>,
  distros: readonly string[],
  disabled?: ReadonlySet<string>,
): Promise<AgentStatus[]> {
  const adapterList = [...adapters];
  const statuses = await Promise.all(
    distros.map(async (distro) => {
      // Kick off one login-shell spawn per distro to capture PATH/HOME/SHELL.
      // Fire-and-forget so per-adapter detection order is preserved; the
      // first probes that race ahead pay full rc-sourcing cost, but later
      // probes (and every future PTY launch) hit the fast no-shell path.
      // The in-flight dedup inside primeWslLoginEnv ensures only one wsl.exe
      // is spawned per distro even with N concurrent callers.
      void primeWslLoginEnv(distro);
      const ctx: AgentEnvContext = { envKind: "wsl", wslDistro: distro };
      return Promise.all(
        adapterList.map(async (adapter) => {
          if (disabled?.has(adapter.kind)) {
            return {
              kind: adapter.kind,
              label: adapter.label,
              installed: true,
              authState: "unknown" as const,
              capabilities: adapter.capabilities,
              envKind: "wsl" as const,
              envDistro: distro,
            };
          }
          try {
            const status = await adapter.detectInstall(ctx);
            return { ...status, envKind: "wsl" as const, envDistro: distro };
          } catch (error) {
            console.error(
              `[supervisor] detectInstall(${adapter.kind}, wsl:${distro}) failed`,
              error,
            );
            return {
              kind: adapter.kind,
              label: adapter.label,
              installed: false,
              authState: "unknown" as const,
              capabilities: adapter.capabilities,
              envKind: "wsl" as const,
              envDistro: distro,
            };
          }
        }),
      );
    }),
  );

  return statuses.flat();
}

export interface AgentStatusServiceOptions {
  adapters: Map<string, AgentAdapter>;
  settingsPath: string;
  statusCachePath: string;
  emit(event: SupervisorEvent): void;
}

export class AgentStatusService {
  private pendingDetection: Promise<void> | undefined;

  constructor(private readonly options: AgentStatusServiceOptions) {}

  async listWslDistros(): Promise<string[]> {
    const startedAt = Date.now();
    try {
      const { stdout } = await execFileAsync(getWslCommand(), ["-l", "-q"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5_000,
      });
      console.log(`[supervisor] listWslDistros: ${Date.now() - startedAt}ms`);
      return normalizeWslListOutput(stdout ?? "");
    } catch {
      console.log(`[supervisor] listWslDistros: failed (${Date.now() - startedAt}ms)`);
      return [];
    }
  }

  async getAgentStatuses(payload: GetAgentStatusesPayload): Promise<AgentStatusesResponse> {
    const wslDistros = [...new Set(payload.wslDistros)];
    const cached = this.readCachedStatuses(wslDistros);
    this.detectAllAgentStatusesBackground(wslDistros);
    return cached;
  }

  /**
   * Reads the on-disk status cache and returns parsed statuses.  Returns
   * `fromCache: false` when no cache file exists (first launch) or when the
   * cache is unreadable — callers should show a detecting/loading state until
   * fresh detection events arrive.
   *
   * Returning the cache directly from the RPC (instead of emitting it as an
   * event) avoids a startup race where the ThreadDraft renders "No supported
   * agents detected" before the cache event is received.
   */
  private readCachedStatuses(wslDistros: readonly string[]): AgentStatusesResponse {
    try {
      if (!existsSync(this.options.statusCachePath)) {
        return { windows: [], wsl: [], fromCache: false };
      }
      const raw = readFileSync(this.options.statusCachePath, "utf8");
      const cache = JSON.parse(raw) as {
        windows?: unknown[];
        wsl?: unknown[];
      };

      const windows = parseCachedStatuses(cache.windows).filter(
        (status) => status.envKind !== "wsl",
      );
      const wsl = filterWslStatusesForDistros(parseCachedStatuses(cache.wsl), wslDistros);

      return { windows, wsl, fromCache: true };
    } catch {
      return { windows: [], wsl: [], fromCache: false };
    }
  }

  private writeDiskCache(windows: AgentStatus[], wsl: AgentStatus[]): void {
    try {
      writeFileSync(
        this.options.statusCachePath,
        JSON.stringify({ windows, wsl, savedAt: new Date().toISOString() }),
        "utf8",
      );
    } catch {
      // best-effort cache
    }
  }

  private readDisabledAgents(): Set<string> {
    try {
      const raw = readFileSync(this.options.settingsPath, "utf8");
      const settings = normalizeSharedSettings(JSON.parse(raw));
      return new Set(settings.disabledAgents);
    } catch {
      return new Set();
    }
  }

  private detectAllAgentStatusesBackground(wslDistros: readonly string[]): void {
    if (this.pendingDetection) {
      return;
    }

    this.pendingDetection = (async () => {
      try {
        const adapters = [...this.options.adapters.values()];
        const disabled = this.readDisabledAgents();

        const nativePromise = Promise.all(
          adapters.map(async (adapter) => {
            if (disabled.has(adapter.kind)) {
              return {
                kind: adapter.kind,
                label: adapter.label,
                installed: true,
                authState: "unknown" as const,
                capabilities: adapter.capabilities,
                envKind: process.platform === "win32" ? ("windows" as const) : ("posix" as const),
              };
            }
            try {
              const status = await adapter.detectInstall();
              return {
                ...status,
                envKind: process.platform === "win32" ? ("windows" as const) : ("posix" as const),
              };
            } catch (error) {
              console.error(`[supervisor] detectInstall(${adapter.kind}) failed`, error);
              return {
                kind: adapter.kind,
                label: adapter.label,
                installed: false,
                authState: "unknown" as const,
                capabilities: adapter.capabilities,
                envKind: process.platform === "win32" ? ("windows" as const) : ("posix" as const),
              };
            }
          }),
        ).then((statuses) => {
          this.options.emit({ type: "windows-agent-statuses", statuses });
          return statuses;
        });

        const wslPromise = detectWslAgentStatuses(adapters, wslDistros, disabled)
          .then((statuses) => {
            this.options.emit({ type: "wsl-agent-statuses", statuses });
            return statuses;
          })
          .catch((error) => {
            // Ensure the renderer always gets a terminal event for WSL —
            // otherwise its loading state would hang forever on detection
            // failure.  Emit an empty list and surface the error in logs.
            console.error("[supervisor] detectWslAgentStatuses failed", error);
            this.options.emit({ type: "wsl-agent-statuses", statuses: [] });
            return [] as AgentStatus[];
          });

        const [nativeResult, wslResult] = await Promise.allSettled([nativePromise, wslPromise]);
        const nativeStatuses = nativeResult.status === "fulfilled" ? nativeResult.value : [];
        const wslStatuses = wslResult.status === "fulfilled" ? wslResult.value : [];

        // Native detection may have thrown before emitting — ensure the
        // renderer always gets a terminal windows-agent-statuses event.
        if (nativeResult.status === "rejected") {
          console.error("[supervisor] native detection failed", nativeResult.reason);
          this.options.emit({ type: "windows-agent-statuses", statuses: [] });
        }

        if (wslDistros.length === 0) {
          this.options.emit({ type: "wsl-agent-statuses", statuses: [] });
        }

        this.writeDiskCache(nativeStatuses, wslStatuses);
      } finally {
        this.pendingDetection = undefined;
      }
    })();
  }
}
