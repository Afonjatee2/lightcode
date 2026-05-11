import { PixelLoader } from "@/renderer/components/common";
import { getRegisteredProviders, ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import type { AgentStatus } from "@/shared/contracts";

function readyBadge(status: AgentStatus): { label: string; toneClass: string } | null {
  if (!status.installed) return null;
  if (status.authState === "missing") {
    return { label: "Sign in needed", toneClass: "text-warning" };
  }
  return { label: "Ready", toneClass: "text-success" };
}

export function AgentDiscoveryScreen() {
  const discovered = useAgentStatusesStore((s) => s.discoveredAgents);
  const byKind = new Map(discovered.map((status) => [status.kind, status]));
  const installedCount = discovered.reduce((n, s) => n + (s.installed ? 1 : 0), 0);
  // Provider plugins self-register at module-load time; reading the registry
  // each render keeps this screen in sync as new agent kinds are added.
  const providers = getRegisteredProviders();

  return (
    <div className="agent-discovery-screen flex h-full flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <PixelLoader size="lg" className="text-foreground" />
        <h1 className="text-xl font-semibold tracking-tight">Discovering coding agents…</h1>
        <p className="max-w-sm text-sm text-muted">
          Scanning your system for installed CLIs. This usually takes a couple of seconds.
        </p>
      </div>

      <div className="flex w-full max-w-[36rem] flex-wrap items-start justify-center gap-x-10 gap-y-6">
        {providers.map(({ kind, label }) => {
          const status = byKind.get(kind);
          const probed = status !== undefined;
          const isInstalled = status?.installed === true;
          const badge = status ? readyBadge(status) : null;
          return (
            <div
              key={kind}
              data-found={isInstalled ? "true" : "false"}
              data-probed={probed ? "true" : "false"}
              className="agent-discovery-item flex w-24 flex-col items-center gap-2"
            >
              <ProviderIcon kind={kind} className="agent-discovery-item__icon size-12" />
              <div className="text-sm font-medium leading-tight">{label}</div>
              <div
                className={`min-h-[1rem] text-xs leading-tight ${badge ? badge.toneClass : "text-muted/60"}`}
              >
                {badge ? (
                  badge.label
                ) : !probed ? (
                  <span className="opacity-60">Searching…</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-muted/70" aria-live="polite">
        {discovered.length === 0
          ? "Warming up shell environment…"
          : installedCount === 0
            ? "No agents installed yet"
            : installedCount === 1
              ? "1 agent ready"
              : `${installedCount} agents ready`}
      </div>
    </div>
  );
}
