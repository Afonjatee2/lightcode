import { type ReactNode, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Chip, Disclosure, Spinner } from "@heroui/react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ShieldAlert,
  WifiOff,
} from "lucide-react";
import type { CampaignContextViewModel } from "@/renderer/adapters/campaignViewModels";
import type { CampaignContextState } from "@/renderer/hooks/useCampaignContext";
import { CampaignContextStatusStrip } from "./CampaignContextStatusStrip";

function formatMoney(value: number | undefined | null, currency: string): string {
  if (value === undefined || value === null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`.trim();
  }
}

function CenteredMessage(props: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted">
      {props.icon}
      <p className="max-w-xs text-small">{props.children}</p>
    </div>
  );
}

function CollapsibleSection(props: {
  title: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Disclosure
      className="mb-2.5 overflow-hidden rounded-[10px] border border-[var(--hairline)] bg-surface-secondary"
      defaultExpanded={props.defaultOpen ?? true}
    >
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-bold text-foreground">
          <span className="cockpit-klabel !text-[11px] !tracking-[0.07em]">{props.title}</span>
          {props.count !== undefined ? (
            <span className="rounded-full bg-surface-tertiary px-1.5 py-0.5 text-[10px] font-bold text-muted">
              {props.count}
            </span>
          ) : null}
          <Disclosure.Indicator className="ml-auto text-muted" />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="px-3 pb-3 pt-0 text-tiny text-default-600">
          {props.children}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}

const priorityChipColors: Record<string, "danger" | "warning" | "default" | "success"> = {
  P1: "danger",
  P2: "warning",
  P3: "default",
  P4: "default",
};

function channelStatusTone(status: string | null): string {
  if (!status) return "bg-[var(--row-hover)] text-muted";
  const normalized = status.toLowerCase();
  if (normalized.includes("live") || normalized.includes("active") || normalized === "delivering") {
    return "bg-success/15 text-success";
  }
  if (normalized.includes("pause")) return "bg-warning/15 text-warning";
  if (normalized.includes("schedule"))
    return "bg-[var(--cockpit-accent-soft)] text-[var(--cockpit-accent)]";
  return "bg-[var(--row-hover)] text-muted";
}

function ContextSections(props: {
  context: CampaignContextViewModel;
  onOpenApprovals?: (proposalId?: string) => void;
}) {
  const { context } = props;
  const { t } = useLingui();

  const localizedWarnings = context.missingDataWarnings.map((warning) => {
    const stale = warning.match(/^(\d+) data sources have stale data$/);
    if (stale) return t`${Number(stale[1])} data sources have stale data`;
    const failed = warning.match(/^(\d+) data sources have failed to sync$/);
    if (failed) return t`${Number(failed[1])} data sources have failed to sync`;
    if (warning === "No budget configured") return t`No budget configured`;
    if (warning === "No data sources connected") return t`No data sources connected`;
    if (warning === "No KPI targets set") return t`No KPI targets set`;
    return warning;
  });

  return (
    <div className="space-y-0">
      <CampaignContextStatusStrip context={context} />

      <CollapsibleSection
        title={<Trans>Open alerts</Trans>}
        count={context.openAlerts.length}
        defaultOpen={context.openAlerts.length > 0}
      >
        {context.openAlerts.length === 0 ? (
          <p className="text-muted">
            <Trans>No open alerts.</Trans>
          </p>
        ) : (
          <ul className="space-y-2">
            {context.openAlerts.map((alert) => (
              <li
                key={alert.id}
                className="flex items-center justify-between gap-2 border-t border-[var(--hairline)] pt-2 first:border-0 first:pt-0"
              >
                <span className="truncate text-sm text-foreground">{alert.title}</span>
                <Chip
                  size="sm"
                  variant="soft"
                  color={priorityChipColors[alert.priority] ?? "default"}
                >
                  {alert.priority}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection title={<Trans>KPI health</Trans>} count={context.kpis.length}>
        {context.kpis.length === 0 ? (
          <p className="text-muted">
            <Trans>No KPI targets set.</Trans>
          </p>
        ) : (
          <ul className="space-y-3">
            {context.kpis.map((kpi) => {
              const pct = kpi.pctAchieved ?? 0;
              const onTrack = kpi.status === "on_track" || kpi.status === "healthy";
              return (
                <li
                  key={kpi.id}
                  className="border-t border-[var(--hairline)] pt-2 first:border-0 first:pt-0"
                >
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-semibold text-foreground">{kpi.label}</span>
                    <span
                      className={`tabular-nums font-semibold ${onTrack ? "text-success" : "text-warning"}`}
                    >
                      {kpi.pctAchieved !== null ? `${Math.round(kpi.pctAchieved)}%` : "—"}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--hairline-strong)]">
                    <div
                      className={`h-full rounded-full ${onTrack ? "bg-success" : "bg-warning"}`}
                      style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection title={<Trans>Channels</Trans>} count={context.channels.length}>
        {context.channels.length === 0 ? (
          <p className="text-muted">
            <Trans>No channel executions.</Trans>
          </p>
        ) : (
          <ul className="space-y-2">
            {context.channels.map((ch) => (
              <li
                key={ch.id}
                className="border-t border-[var(--hairline)] pt-2 first:border-0 first:pt-0"
              >
                <div className="flex items-center gap-2">
                  <span className="w-[74px] shrink-0 text-xs font-semibold text-foreground">
                    {ch.channelLabel}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${channelStatusTone(ch.status)}`}
                  >
                    {ch.status?.replaceAll("_", " ") ?? t`Unknown`}
                  </span>
                </div>
                <p className="mt-1 text-[10.5px] tabular-nums text-muted">
                  {formatMoney(ch.actualSpend, "GBP")} / {formatMoney(ch.plannedBudget, "GBP")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={<Trans>Decisions & proposals</Trans>}
        count={context.pendingProposals.length}
        defaultOpen={context.pendingProposals.length > 0}
      >
        <p className="text-sm text-foreground">
          <Trans>{context.activeDecisions.length} active decisions</Trans>
        </p>
        {context.pendingProposals.length > 0 ? (
          <div className="mt-2 rounded-md border border-[var(--cockpit-accent-line)] bg-[var(--cockpit-accent-soft)] px-3 py-2 text-[11.5px] text-muted">
            <p>
              <Trans>{context.pendingProposals.length} pending proposals</Trans>
            </p>
            {props.onOpenApprovals ? (
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 h-7 text-[var(--cockpit-accent)]"
                onPress={() => props.onOpenApprovals?.()}
              >
                <Trans>Review</Trans>
              </Button>
            ) : null}
            <ul className="mt-1 space-y-0.5">
              {context.pendingProposals.map((prop) => (
                <li key={prop.id}>
                  {props.onOpenApprovals ? (
                    <button
                      type="button"
                      className="w-full truncate text-left hover:text-foreground"
                      onClick={() => props.onOpenApprovals?.(prop.id)}
                    >
                      {prop.title}
                    </button>
                  ) : (
                    <span className="truncate">{prop.title}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-1 text-muted">
            <Trans>No pending proposals.</Trans>
          </p>
        )}
      </CollapsibleSection>

      {context.missingDataWarnings.length > 0 ? (
        <div className="mt-2 rounded-[10px] border border-warning/40 bg-warning/5 px-3 py-2">
          <p className="flex items-center gap-1 text-tiny font-medium text-warning">
            <AlertTriangle className="size-3.5" />
            <Trans>Missing data</Trans>
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-tiny text-muted">
            {localizedWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="px-1 pt-2 text-[10px] text-muted">
        <Trans>Evidence freshness</Trans>: {context.evidenceFreshness}
      </p>
    </div>
  );
}

export function CampaignContextPane(props: {
  campaignContext: CampaignContextState & { refetch: () => void };
  onOpenApprovals?: (proposalId?: string) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const { t } = useLingui();
  const { campaignContext } = props;
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = props.collapsed ?? internalCollapsed;
  const toggleCollapsed =
    props.onToggleCollapsed ?? (() => setInternalCollapsed((value) => !value));

  if (collapsed) {
    return (
      <div className="relative flex h-full items-start justify-end">
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          className="absolute left-0 top-16 z-10 rounded-l-lg rounded-r-none border border-r-0 border-[var(--hairline)] bg-surface-secondary"
          aria-label={t`Expand context panel`}
          onPress={toggleCollapsed}
        >
          <ChevronLeft className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {campaignContext.status === "ready" ? (
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--hairline)] px-3 py-2.5">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {campaignContext.data.identity.clientName ?? "—"}
            </h2>
            <p className="truncate text-tiny text-muted">
              {campaignContext.data.identity.campaignName}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              aria-label={t`Refresh context`}
              onPress={campaignContext.refetch}
            >
              <RefreshCw className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              aria-label={t`Collapse context panel`}
              onPress={toggleCollapsed}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </header>
      ) : (
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--hairline)] p-3">
          <h2 className="text-small font-semibold text-foreground">
            <Trans>Campaign context</Trans>
          </h2>
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            aria-label={t`Collapse context panel`}
            onPress={toggleCollapsed}
          >
            <ChevronRight className="size-4" />
          </Button>
        </header>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {campaignContext.status === "loading" && (
          <CenteredMessage icon={<Spinner size="sm" />}>
            <Trans>Loading campaign context…</Trans>
          </CenteredMessage>
        )}
        {campaignContext.status === "empty" && (
          <CenteredMessage>
            <Trans>This project isn't linked to a Control Centre campaign yet.</Trans>
          </CenteredMessage>
        )}
        {campaignContext.status === "unauthorized" && (
          <CenteredMessage icon={<ShieldAlert className="size-6" />}>
            <Trans>Control Centre needs authorization. Reconnect it in MCP settings.</Trans>
          </CenteredMessage>
        )}
        {campaignContext.status === "unavailable" && (
          <CenteredMessage icon={<WifiOff className="size-6" />}>
            {campaignContext.message}
          </CenteredMessage>
        )}
        {campaignContext.status === "error" && (
          <CenteredMessage icon={<AlertTriangle className="size-6" />}>
            {campaignContext.message}
          </CenteredMessage>
        )}
        {campaignContext.status === "ready" && (
          <ContextSections
            context={campaignContext.data}
            {...(props.onOpenApprovals ? { onOpenApprovals: props.onOpenApprovals } : {})}
          />
        )}
      </div>
    </div>
  );
}
