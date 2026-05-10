import { PixelLoader } from "@/renderer/components/common";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import type { AgentStatus } from "@/shared/contracts";

const KNOWN_AGENTS: ReadonlyArray<{ kind: string; label: string }> = [
  { kind: "claude", label: "Claude Code" },
  { kind: "codex", label: "Codex" },
  { kind: "copilot", label: "GitHub Copilot" },
  { kind: "gemini", label: "Gemini" },
  { kind: "cursor", label: "Cursor CLI" },
  { kind: "opencode", label: "OpenCode" },
];

function authBadge(status: AgentStatus): { label: string; toneClass: string } {
  if (!status.installed) {
    return { label: "Not installed", toneClass: "text-muted" };
  }
  switch (status.authState) {
    case "authenticated":
      return { label: "Ready", toneClass: "text-success" };
    case "missing":
      return { label: "Sign in needed", toneClass: "text-warning" };
    default:
      return { label: "Detected", toneClass: "text-foreground" };
  }
}

export function AgentDiscoveryScreen() {
  const discovered = useAgentStatusesStore((s) => s.discoveredAgents);
  const byKind = new Map(discovered.map((status) => [status.kind, status]));

  return (
    <div className="agent-discovery-screen flex h-full flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <PixelLoader size="lg" className="text-foreground" />
        <h1 className="text-xl font-semibold tracking-tight">Discovering coding agents…</h1>
        <p className="max-w-sm text-sm text-muted">
          Scanning your system for installed CLIs. This usually takes a couple of seconds.
        </p>
      </div>

      <div className="grid w-full max-w-[34rem] grid-cols-2 gap-3 sm:grid-cols-3">
        {KNOWN_AGENTS.map(({ kind, label }) => {
          const status = byKind.get(kind);
          const isFound = status !== undefined;
          const badge = status ? authBadge(status) : null;
          return (
            <div
              key={kind}
              data-found={isFound ? "true" : "false"}
              className="agent-discovery-tile flex flex-col items-center justify-center gap-2 rounded-md border border-border/60 bg-surface/50 px-3 py-4"
            >
              <div className="agent-discovery-tile__icon flex size-9 items-center justify-center">
                <ProviderIcon
                  kind={kind}
                  tone={isFound ? "active" : "inactive"}
                  className="size-9"
                />
              </div>
              <div className="text-sm font-medium leading-tight">{label}</div>
              <div
                className={`min-h-[1rem] text-xs leading-tight ${badge ? badge.toneClass : "text-muted/60"}`}
              >
                {badge ? badge.label : <span className="opacity-60">Searching…</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-muted/70" aria-live="polite">
        {discovered.length === 0
          ? "Warming up shell environment…"
          : `Found ${discovered.length} of ${KNOWN_AGENTS.length}`}
      </div>
    </div>
  );
}
