import type { ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Card, Chip, Spinner } from "@heroui/react";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  WifiOff,
  XCircle,
} from "lucide-react";
import type { CampaignContextViewModel } from "@/renderer/adapters/campaignViewModels";
import type { CampaignContextState } from "@/renderer/hooks/useCampaignContext";

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

function formatDate(value: string | undefined | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function CenteredMessage(props: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-default-400">
      {props.icon}
      <p className="max-w-xs text-small">{props.children}</p>
    </div>
  );
}

function SectionCard(props: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={`border border-divider ${props.className ?? ""}`}>
      <Card.Header className="px-3 py-2">
        <h4 className="text-tiny font-medium text-foreground">{props.title}</h4>
      </Card.Header>
      <div className="px-3 pb-2 text-tiny text-default-600">{props.children}</div>
    </Card>
  );
}

const priorityChipColors: Record<string, "danger" | "warning" | "default" | "success"> = {
  P1: "danger",
  P2: "warning",
  P3: "default",
  P4: "default",
};

function IdentityHeader(props: { context: CampaignContextViewModel; onRefresh: () => void }) {
  const { t } = useLingui();
  const { identity } = props.context;
  const clientDisplay = identity.clientName ?? "—";
  return (
    <header className="flex shrink-0 items-start justify-between gap-2 border-b border-divider p-3">
      <div className="min-w-0">
        <h2 className="truncate text-small font-semibold text-foreground">{clientDisplay}</h2>
        <p className="truncate text-tiny text-default-500">{identity.campaignName}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Chip size="sm" variant="soft">
            {identity.lifecycleStatus}
          </Chip>
          {identity.jobNumber && (
            <Chip size="sm" variant="soft">
              {identity.jobNumber}
            </Chip>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        isIconOnly
        aria-label={t`Refresh context`}
        onPress={props.onRefresh}
      >
        <RefreshCw className="size-4" />
      </Button>
    </header>
  );
}

function ContextSections(props: {
  context: CampaignContextViewModel;
  onOpenApprovals?: (proposalId?: string) => void;
}) {
  const { context } = props;
  const { t } = useLingui();
  const budget = context.budget;

  // The adapter emits macro-free English source strings (it is imported by a
  // node-environment test (mcpExtraction.test.ts), where the Lingui macro and
  // the `.po`-loading i18n singleton cannot run. They are localized here at the
  // render boundary in CampaignContextPane.tsx.
  const localizedWarnings = context.missingDataWarnings.map((warning) => {
    const stale = warning.match(/^(\d+) data sources have stale data$/);
    if (stale) {
      const staleCount = Number(stale[1]);
      return t`${staleCount} data sources have stale data`;
    }
    const failed = warning.match(/^(\d+) data sources have failed to sync$/);
    if (failed) {
      const failedCount = Number(failed[1]);
      return t`${failedCount} data sources have failed to sync`;
    }
    if (warning === "No budget configured") return t`No budget configured`;
    if (warning === "No data sources connected") return t`No data sources connected`;
    if (warning === "No KPI targets set") return t`No KPI targets set`;
    return warning;
  });

  return (
    <div className="space-y-3">
      <SectionCard title={<Trans>Dates</Trans>}>
        <p>
          {formatDate(context.dates.startDate)} — {formatDate(context.dates.endDate)}
        </p>
      </SectionCard>

      <SectionCard title={<Trans>Spend vs Budget</Trans>}>
        <p>
          {formatMoney(budget.spentToDate, budget.currency)} /{" "}
          {formatMoney(budget.totalBudget, budget.currency)}
          {budget.pctUsed !== null && ` (${Math.round(budget.pctUsed)}%)`}
        </p>
        {budget.remaining !== null && (
          <p className="text-default-400">
            <Trans>{formatMoney(budget.remaining, budget.currency)} remaining</Trans>
          </p>
        )}
        {typeof context.pacing.variancePct === "number" && (
          <p className="text-default-400">
            <Trans>
              {`${context.pacing.variancePct > 0 ? "+" : ""}${context.pacing.variancePct}%`} vs
              expected
            </Trans>
          </p>
        )}
        {context.pacing.status !== "unknown" && (
          <Chip size="sm" variant="soft" className="mt-1">
            {context.pacing.status}
          </Chip>
        )}
      </SectionCard>

      <SectionCard title={<Trans>KPI Health</Trans>}>
        {context.kpis.length === 0 ? (
          <p className="text-default-400">
            <Trans>No KPI targets set.</Trans>
          </p>
        ) : (
          <ul className="space-y-1">
            {context.kpis.map((kpi) => (
              <li
                key={kpi.id}
                className="flex flex-col gap-0.5 border-b border-divider py-1.5 last:border-0 last:pb-0 first:pt-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold truncate">{kpi.label}</span>
                  {kpi.status && (
                    <span className="shrink-0 text-xs capitalize text-default-500">
                      {kpi.status.replace("_", " ")}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-default-400">
                  <span className="truncate uppercase">{kpi.targetType}</span>
                  <span className="shrink-0 tabular-nums">
                    {kpi.actualValue ?? "—"} / {kpi.targetValue}
                    {kpi.pctAchieved !== null && ` (${Math.round(kpi.pctAchieved)}%)`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={<Trans>Channels</Trans>}>
        {context.channels.length === 0 ? (
          <p className="text-default-400">
            <Trans>No channel executions.</Trans>
          </p>
        ) : (
          <ul className="space-y-1">
            {context.channels.map((ch) => (
              <li
                key={ch.id}
                className="flex flex-col gap-0.5 border-b border-divider py-1.5 last:border-0 last:pb-0 first:pt-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold truncate">{ch.channelLabel}</span>
                  {ch.status && (
                    <span className="shrink-0 text-xs capitalize text-default-500">
                      {ch.status.replace("_", " ")}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-default-400">
                  <span className="truncate capitalize">{ch.platform}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatMoney(ch.actualSpend, "GBP")} / {formatMoney(ch.plannedBudget, "GBP")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={<Trans>Source Health</Trans>}>
        {context.sourceHealth.length === 0 ? (
          <p className="text-default-400">
            <Trans>No connected sources reported.</Trans>
          </p>
        ) : (
          <ul className="space-y-1.5">
            {context.sourceHealth.map((src) => (
              <li
                key={src.sourceId}
                className="flex flex-col gap-0.5 py-1.5 border-b border-divider last:border-0 last:pb-0 first:pt-0"
              >
                <div className="flex items-center gap-1.5">
                  {src.status === "healthy" ? (
                    <CheckCircle2 className="size-3 shrink-0 text-success" />
                  ) : src.status === "failed" ? (
                    <XCircle className="size-3 shrink-0 text-danger" />
                  ) : (
                    <AlertTriangle className="size-3 shrink-0 text-warning" />
                  )}
                  <span className="truncate flex-1 font-medium">{src.label}</span>
                  <span className="shrink-0 text-default-400 text-xs">
                    {src.lastSyncedAt ? formatDate(src.lastSyncedAt) : "—"}
                  </span>
                </div>
                {src.reason && src.status !== "healthy" && (
                  <span className="text-xs text-danger/80 pl-5 break-words">{src.reason}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={<Trans>Open Alerts</Trans>}>
        {context.openAlerts.length === 0 ? (
          <p className="text-default-400">
            <Trans>No open alerts.</Trans>
          </p>
        ) : (
          <ul className="space-y-1">
            {context.openAlerts.map((alert) => (
              <li key={alert.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{alert.title}</span>
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
      </SectionCard>

      <SectionCard title={<Trans>Decisions & Proposals</Trans>}>
        <p>
          <Trans>{context.activeDecisions.length} active decisions</Trans>
        </p>
        <ul className="mt-1 space-y-0.5">
          {context.activeDecisions.map((dec) => (
            <li key={dec.id} className="truncate text-default-400">
              {dec.title} — {dec.status}
            </li>
          ))}
        </ul>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p>
            <Trans>{context.pendingProposals.length} pending proposals</Trans>
          </p>
          {context.pendingProposals.length > 0 && props.onOpenApprovals ? (
            <Button size="sm" variant="ghost" onPress={() => props.onOpenApprovals?.()}>
              <Trans>Review</Trans>
            </Button>
          ) : null}
        </div>
        <ul className="mt-1 space-y-0.5">
          {context.pendingProposals.map((prop) => (
            <li key={prop.id}>
              {props.onOpenApprovals ? (
                <button
                  type="button"
                  className="w-full truncate text-left text-default-400 hover:text-foreground"
                  onClick={() => props.onOpenApprovals?.(prop.id)}
                >
                  {prop.title} — {prop.status}
                  {prop.riskLevel && ` (${prop.riskLevel})`}
                </button>
              ) : (
                <span className="truncate text-default-400">
                  {prop.title} — {prop.status}
                  {prop.riskLevel && ` (${prop.riskLevel})`}
                </span>
              )}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title={<Trans>Recent Events</Trans>}>
        {context.recentEvents.length === 0 ? (
          <p className="text-default-400">
            <Trans>No recent events.</Trans>
          </p>
        ) : (
          <ul className="space-y-1.5">
            {context.recentEvents.map((event) => (
              <li key={event.id}>
                <span className="text-default-400">{formatDate(event.occurredAt)}</span>{" "}
                <span className="text-default-600">{event.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {context.suggestedQuestions.length > 0 && (
        <SectionCard title={<Trans>Suggested Questions</Trans>}>
          <ul className="space-y-0.5">
            {context.suggestedQuestions.map((q, i) => (
              <li key={i} className="text-default-500">
                "{q}"
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {context.missingDataWarnings.length > 0 && (
        <Card className="border border-warning/40 bg-warning/5">
          <Card.Header className="px-3 py-2">
            <h4 className="flex items-center gap-1 text-tiny font-medium text-warning">
              <AlertTriangle className="size-3.5" />
              <Trans>Missing Data</Trans>
            </h4>
          </Card.Header>
          <div className="px-3 pb-2 text-tiny text-default-600">
            <ul className="list-inside list-disc space-y-0.5">
              {localizedWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      <p className="px-1 text-tiny text-default-400">
        <Trans>Evidence freshness</Trans>: {context.evidenceFreshness}
      </p>
    </div>
  );
}

export function CampaignContextPane(props: {
  campaignContext: CampaignContextState & { refetch: () => void };
  onOpenApprovals?: (proposalId?: string) => void;
}) {
  const { campaignContext } = props;

  return (
    <div className="flex h-full flex-col">
      {campaignContext.status === "ready" ? (
        <IdentityHeader context={campaignContext.data} onRefresh={campaignContext.refetch} />
      ) : (
        <header className="flex shrink-0 items-center justify-between border-b border-divider p-3">
          <h2 className="text-small font-semibold text-foreground">
            <Trans>Campaign Context</Trans>
          </h2>
        </header>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
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
