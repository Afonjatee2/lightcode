import { type ReactNode, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Chip, Disclosure, Spinner } from "@heroui/react";
import {
  AlertTriangle,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import type {
  CampaignContextKpiViewModel,
  CampaignContextViewModel,
} from "@/renderer/adapters/campaignViewModels";
import type { CampaignContextState } from "@/renderer/hooks/useCampaignContext";
import type { PerformanceSnapshot } from "@/shared/contracts/campaign/performanceSnapshot";
import type { CampaignDecisionsState } from "@/renderer/hooks/useCampaignDecisions";
import type { RecordCampaignDecision } from "@/renderer/hooks/useRecordCampaignDecision";
import { CampaignContextStatusStrip } from "./CampaignContextStatusStrip";
import { CampaignDecisionsList } from "./CampaignDecisionsList";
import { CampaignPerformanceSnapshotSection } from "./CampaignPerformanceSnapshotSection";
import { RecordDecisionModal } from "./RecordDecisionModal";
import type { DecisionFormSeed } from "./decisionForm";
import { groupAlerts } from "./alertGrouping";

/**
 * Everything the decisions surface needs, resolved once in the shell and
 * threaded through. Optional so the pane still renders standalone in tests
 * that don't exercise decision recording.
 */
export interface CampaignDecisionsBundle {
  campaignGroupId: string;
  state: CampaignDecisionsState;
  record: RecordCampaignDecision;
  onRecorded: () => void;
}

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

function formatKpiNumber(value: number, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return value.toLocaleString();
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

function alertSeverityClass(severity: string, priority: string): string {
  const norm = severity.toLowerCase();
  if (norm === "critical" || priority === "P1") return "cockpit-alert-row--crit";
  if (norm === "warning" || priority === "P2") return "cockpit-alert-row--warn";
  return "cockpit-alert-row--info";
}

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

interface KpiGroup {
  metricKey: string;
  items: CampaignContextKpiViewModel[];
}

function deriveKpiGroups(kpis: CampaignContextKpiViewModel[]): { groups: KpiGroup[] } {
  const map = new Map<string, CampaignContextKpiViewModel[]>();
  for (const kpi of kpis) {
    const key = kpi.metricKey || kpi.label;
    const existing = map.get(key);
    if (existing) {
      existing.push(kpi);
    } else {
      map.set(key, [kpi]);
    }
  }

  const groups: KpiGroup[] = Array.from(map.entries()).map(([metricKey, items]) => ({
    metricKey,
    items,
  }));

  return { groups };
}

function ContextSections(props: {
  context: CampaignContextViewModel;
  performanceSnapshot?: PerformanceSnapshot | null;
  onOpenApprovals?: (proposalId?: string) => void;
  decisions?: CampaignDecisionsBundle;
}) {
  const { context, decisions, performanceSnapshot } = props;
  const { i18n, t } = useLingui();
  const [recordModal, setRecordModal] = useState<{
    open: boolean;
    seed?: DecisionFormSeed;
    alertTitle?: string;
  }>({ open: false });
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [expandedAlertKeys, setExpandedAlertKeys] = useState<Set<string>>(new Set());

  const openRecordModal = (options?: { seed?: DecisionFormSeed; alertTitle?: string }) => {
    setRecordModal({
      open: true,
      ...(options?.seed ? { seed: options.seed } : {}),
      ...(options?.alertTitle ? { alertTitle: options.alertTitle } : {}),
    });
  };

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

  const groupedAlerts = groupAlerts(context.openAlerts);
  const displayedAlertGroups = showAllAlerts ? groupedAlerts : groupedAlerts.slice(0, 3);
  const kpiGroupData = deriveKpiGroups(context.kpis);

  return (
    <div className="space-y-0">
      {performanceSnapshot ? (
        <CampaignPerformanceSnapshotSection snapshot={performanceSnapshot} />
      ) : null}

      <CampaignContextStatusStrip context={context} />

      <CollapsibleSection title={<Trans>KPI health</Trans>} count={context.kpis.length}>
        {context.kpis.length === 0 ? (
          <p className="text-muted">
            <Trans>No KPI targets set.</Trans>
          </p>
        ) : (
          <ul className="space-y-3">
            {kpiGroupData.groups.map((group) => {
              const isGrouped = group.items.length > 1;
              return (
                <li
                  key={group.metricKey}
                  className="border-t border-[var(--hairline)] pt-2.5 first:border-0 first:pt-0"
                >
                  {isGrouped ? (
                    <div className="cockpit-klabel mb-1.5 font-bold tracking-wider text-foreground uppercase">
                      {group.metricKey}
                    </div>
                  ) : null}
                  <div className="space-y-2.5">
                    {group.items.map((kpi) => {
                      const formattedTarget = formatKpiNumber(kpi.targetValue, i18n.locale);
                      const pct = kpi.pctAchieved ?? 0;
                      const onTrack = kpi.status === "on_track" || kpi.status === "healthy";
                      const over = kpi.pctAchieved !== null && pct > 100;

                      let displayLabel: ReactNode;
                      if (isGrouped) {
                        if (kpi.channel) {
                          displayLabel = (
                            <>
                              <span>{kpi.channel}</span>{" "}
                              <span className="font-normal text-muted">
                                {t`Target: ${formattedTarget}`}
                              </span>
                            </>
                          );
                        } else {
                          displayLabel = t`Target: ${formattedTarget}`;
                        }
                      } else {
                        if (kpi.channel) {
                          displayLabel = `${kpi.channel} · ${kpi.label}`;
                        } else {
                          displayLabel = kpi.label;
                        }
                      }

                      return (
                        <div key={kpi.id}>
                          <div className="mb-1 flex justify-between text-xs">
                            <span className="font-semibold text-foreground">{displayLabel}</span>
                            <span
                              className={`inline-flex items-center gap-0.5 tabular-nums font-semibold ${onTrack ? "text-success" : "text-warning"}`}
                            >
                              {over ? <ArrowUp className="size-3" aria-hidden /> : null}
                              {kpi.pctAchieved !== null ? `${Math.round(kpi.pctAchieved)}%` : "—"}
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--hairline-strong)]">
                            <div
                              className={`h-full rounded-full ${onTrack ? "bg-success" : "bg-warning"} ${over ? "cockpit-kpi-bar--over" : ""}`}
                              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CollapsibleSection>

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
          <div>
            <ul className="space-y-2">
              {displayedAlertGroups.map((alertGroup) => {
                const isExpanded = expandedAlertKeys.has(alertGroup.key);
                const toggleExpand = () => {
                  setExpandedAlertKeys((prev) => {
                    const next = new Set(prev);
                    if (next.has(alertGroup.key)) {
                      next.delete(alertGroup.key);
                    } else {
                      next.add(alertGroup.key);
                    }
                    return next;
                  });
                };

                return (
                  <li
                    key={alertGroup.key}
                    className={`cockpit-alert-row p-2.5 ${alertSeverityClass(alertGroup.severity, alertGroup.priority)}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {alertGroup.instances.length > 1 ? (
                          <button
                            type="button"
                            className="flex min-w-0 items-center gap-2 text-left"
                            onClick={toggleExpand}
                          >
                            <span className="truncate text-xs font-semibold text-foreground">
                              {alertGroup.title}
                            </span>
                            <span className="rounded-full bg-surface-tertiary px-1.5 py-0.5 text-[10px] font-bold text-foreground">
                              ×{alertGroup.count}
                            </span>
                          </button>
                        ) : (
                          <span className="truncate text-xs font-semibold text-foreground">
                            {alertGroup.title}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {decisions ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            isIconOnly
                            className="h-6 w-6 min-w-6 text-[var(--cockpit-accent)]"
                            aria-label={t`Record a decision for ${alertGroup.title}`}
                            onPress={() =>
                              openRecordModal({
                                seed: { mode: "suppress" },
                                alertTitle: alertGroup.title,
                              })
                            }
                          >
                            <ShieldCheck className="size-3.5" aria-hidden />
                          </Button>
                        ) : null}
                        <Chip
                          size="sm"
                          variant="soft"
                          color={priorityChipColors[alertGroup.priority] ?? "default"}
                        >
                          {alertGroup.priority}
                        </Chip>
                        {alertGroup.instances.length > 1 ? (
                          <button
                            type="button"
                            className="ml-0.5 text-muted hover:text-foreground"
                            aria-label={isExpanded ? t`Collapse instances` : t`Expand instances`}
                            onClick={toggleExpand}
                          >
                            {isExpanded ? (
                              <ChevronUp className="size-3.5" />
                            ) : (
                              <ChevronDown className="size-3.5" />
                            )}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {isExpanded && alertGroup.instances.length > 1 ? (
                      <ul className="mt-2 space-y-1 border-t border-[var(--hairline)] pt-2 text-tiny text-muted">
                        {alertGroup.instances.map((inst, idx) => (
                          <li
                            key={inst.id || idx}
                            className="flex items-center justify-between gap-2 text-[10.5px]"
                          >
                            <span className="truncate font-mono">
                              {inst.openedAt ? new Date(inst.openedAt).toLocaleString() : inst.id}
                            </span>
                            <span className="shrink-0 font-semibold">{inst.priority}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {groupedAlerts.length > 3 ? (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2.5 w-full text-xs font-semibold text-[var(--cockpit-accent)]"
                onPress={() => setShowAllAlerts((v) => !v)}
              >
                {showAllAlerts ? <Trans>Show less</Trans> : <Trans>Show all</Trans>}
              </Button>
            ) : null}
          </div>
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
        defaultOpen={context.pendingProposals.length > 0 || decisions !== undefined}
      >
        {decisions ? (
          <CampaignDecisionsList
            decisions={decisions.state}
            ready={decisions.record.ready}
            onRecord={() => openRecordModal()}
          />
        ) : (
          <p className="text-sm text-foreground">
            <Trans>{context.activeDecisions.length} active decisions</Trans>
          </p>
        )}
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

      {decisions ? (
        <RecordDecisionModal
          isOpen={recordModal.open}
          onClose={() => setRecordModal({ open: false })}
          campaignGroupId={decisions.campaignGroupId}
          channels={context.channels}
          ready={decisions.record.ready}
          submit={decisions.record.submit}
          onRecorded={decisions.onRecorded}
          {...(recordModal.seed ? { seed: recordModal.seed } : {})}
          {...(recordModal.alertTitle ? { alertTitle: recordModal.alertTitle } : {})}
        />
      ) : null}
    </div>
  );
}

export function CampaignContextPane(props: {
  campaignContext: CampaignContextState & { refetch: () => void };
  performanceSnapshot?: PerformanceSnapshot | null;
  isUnlinkedProject?: boolean;
  onOpenApprovals?: (proposalId?: string) => void;
  decisions?: CampaignDecisionsBundle;
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
            {props.isUnlinkedProject ? (
              <Trans>
                Not linked to Control Centre — link in Advanced settings when creating a workspace.
              </Trans>
            ) : (
              <Trans>This project isn't linked to a Control Centre campaign yet.</Trans>
            )}
          </CenteredMessage>
        )}
        {campaignContext.status === "unauthorized" && (
          <CenteredMessage icon={<ShieldAlert className="size-6" />}>
            <Trans>Control Centre needs authorization. Reconnect it in settings.</Trans>
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
            {...(props.performanceSnapshot !== undefined
              ? { performanceSnapshot: props.performanceSnapshot }
              : {})}
            {...(props.onOpenApprovals ? { onOpenApprovals: props.onOpenApprovals } : {})}
            {...(props.decisions ? { decisions: props.decisions } : {})}
          />
        )}
      </div>
    </div>
  );
}
