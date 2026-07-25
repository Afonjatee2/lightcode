import { Trans, useLingui } from "@lingui/react/macro";
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  XCircle,
} from "lucide-react";
import type {
  ConsultationRecord,
  ConsultationResultAttachment,
  EvidenceFreshnessSummary,
} from "@/shared/consultations";
import { isTerminalStatus } from "@/shared/consultations";
import { msg } from "@/shared/messages";
import { Button } from "@/renderer/components/common/Button";
import { ContextWarnings, EvidenceFreshnessIndicator } from "./ContextWarnings";

interface ConsultationCardProps {
  record: ConsultationRecord;
  resultAttachment: ConsultationResultAttachment | null;
  evidenceFreshness: EvidenceFreshnessSummary | null;
  missingDataWarnings: string[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onNavigateToChild: (childThreadOrRunId: string) => void;
  canCancel: boolean;
  canRetry: boolean;
  hasBudget: boolean;
  hasPlan: boolean;
  controlCentreAvailable: boolean;
}

export function ConsultationCard({
  record,
  resultAttachment,
  evidenceFreshness,
  missingDataWarnings,
  onCancel,
  onRetry,
  onNavigateToChild,
  canCancel,
  canRetry,
  hasBudget,
  hasPlan,
  controlCentreAvailable,
}: ConsultationCardProps) {
  const { t } = useLingui();

  const roleLabel = record.resolvedRole.replace(/_/g, " ");
  const providerLabel = record.actualProvider ?? record.requestedProvider;
  const modeLabel =
    record.consultationMode === "panel"
      ? t`Panel`
      : record.consultationMode === "finalise"
        ? t`Finalise`
        : t`Standard`;
  const isTerminal = isTerminalStatus(record.status);
  const createdAt = new Date(record.createdAt);
  const startedAt = record.startedAt ? new Date(record.startedAt) : null;
  const completedAt = record.completedAt ? new Date(record.completedAt) : null;

  return (
    <div className="cockpit-consult-card">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--hairline)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`size-2 shrink-0 rounded-sm ${roleDotColor(record.resolvedRole)}`}
            aria-hidden
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-bold capitalize text-foreground">
                {roleLabel}
              </span>
              {providerLabel ? (
                <span className="text-xs text-[var(--cockpit-accent)] shrink-0">
                  @{providerLabel}
                </span>
              ) : null}
            </div>
            <span className="text-[11px] text-muted">· {modeLabel}</span>
          </div>
        </div>
        <StatusBadge status={record.status} />
      </div>

      <div className="px-4 py-3 text-sm leading-relaxed text-foreground/80">
        {record.originalInstruction}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <Clock size={12} />
          <Trans>Created {createdAt.toLocaleTimeString()}</Trans>
        </span>
        {startedAt ? (
          <span>
            <Trans>Started {startedAt.toLocaleTimeString()}</Trans>
          </span>
        ) : null}
        {completedAt ? (
          <span>
            <Trans>Completed {completedAt.toLocaleTimeString()}</Trans>
          </span>
        ) : null}
      </div>

      {evidenceFreshness ? <EvidenceFreshnessIndicator freshness={evidenceFreshness} /> : null}

      <ContextWarnings
        evidenceFreshness={evidenceFreshness}
        missingDataWarnings={missingDataWarnings}
        hasBudget={hasBudget}
        hasPlan={hasPlan}
        controlCentreAvailable={controlCentreAvailable}
        permissionRestricted={false}
      />

      {!isTerminal ? (
        <div className="flex items-center gap-2 border-t border-[var(--hairline)] px-4 py-2.5">
          {record.status === "running" ||
          record.status === "queued" ||
          record.status === "building_context" ||
          record.status === "ready" ||
          record.status === "awaiting_input" ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              <Trans>In progress</Trans>
            </span>
          ) : null}
          {canCancel ? (
            <Button size="sm" variant="secondary" onPress={() => onCancel(record.id)}>
              <Ban size={14} />
              <Trans>Cancel</Trans>
            </Button>
          ) : null}
          {record.childThreadOrRunId ? (
            <Button
              size="sm"
              variant="secondary"
              onPress={() => onNavigateToChild(record.childThreadOrRunId!)}
            >
              <ExternalLink size={14} />
              <Trans>View child thread</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}

      {record.status === "completed" && resultAttachment ? (
        <div className="border-t border-[var(--hairline)] px-4 py-3">
          <CompletionResult result={resultAttachment} />
        </div>
      ) : null}

      {record.status === "failed" ? (
        <div className="mx-4 my-3 rounded-[10px] border border-danger/30 bg-danger/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-danger">
            <XCircle size={14} />
            <Trans>Consultation failed</Trans>
          </div>
          {failureDisplayMessage(record) ? (
            <p className="text-xs text-muted-foreground">{failureDisplayMessage(record)}</p>
          ) : null}
          {canRetry ? (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 border border-[var(--cockpit-accent-line)] text-[var(--cockpit-accent)] hover:bg-[var(--cockpit-accent-soft)]"
              onPress={() => onRetry(record.id)}
            >
              <RefreshCw size={12} />
              <Trans>Retry</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}

      {record.status === "cancelled" ? (
        <div className="flex items-center gap-2 border-t border-[var(--hairline)] px-4 py-3 text-sm text-muted">
          <Ban size={14} />
          <Trans>Consultation was cancelled</Trans>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Provider-resolution failures are recomposed here from the failure CODE so the
 * text localizes — the supervisor stores `safeFailureMessage` in English only
 * (the shared-message resolver exists solely in the renderer process). Other
 * failure codes fall back to the stored message.
 */
function failureDisplayMessage(record: ConsultationRecord): string | null {
  const provider = record.requestedProvider;
  if (provider) {
    if (record.failureCode === "provider_warming_up") {
      return msg("consultation.providerWarmingUp", { provider });
    }
    if (record.failureCode === "provider_unavailable") {
      return msg("consultation.providerUnavailable", { provider });
    }
  }
  return record.safeFailureMessage;
}

function CompletionResult({ result }: { result: ConsultationResultAttachment }) {
  return (
    <div className="rounded-lg border border-success/30 bg-success/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-success">
        <CheckCircle2 size={16} />
        <Trans>Consultation complete</Trans>
      </div>
      <p className="text-sm text-foreground/80">{result.summary}</p>
      {result.keyFindings.length > 0 ? (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            <Trans>Key findings:</Trans>
          </span>
          <ul className="list-disc pl-4 text-xs text-foreground/70 space-y-0.5">
            {result.keyFindings.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.recommendedActions.length > 0 ? (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            <Trans>Recommendations:</Trans>
          </span>
          <ul className="list-disc pl-4 text-xs text-foreground/70 space-y-0.5">
            {result.recommendedActions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function roleDotColor(role: string): string {
  switch (role) {
    case "strategic_reviewer":
      return "bg-[#5eead4]";
    case "figures_auditor":
      return "bg-[var(--cockpit-accent)]";
    case "verifier":
    case "challenger":
      return "bg-warning";
    default:
      return "bg-success";
  }
}

function StatusBadge({ status }: { status: ConsultationRecord["status"] }) {
  const { t } = useLingui();
  const labels: Record<string, string> = {
    queued: t`Queued`,
    building_context: t`Building`,
    ready: t`Ready`,
    running: t`Running`,
    awaiting_input: t`Awaiting input`,
    completed: t`Complete`,
    failed: t`Failed`,
    cancel_requested: t`Cancelling`,
    cancelled: t`Cancelled`,
  };
  const label = labels[status] ?? status;
  const color = statusColor(status);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shrink-0 font-mono ${color}`}
    >
      {status === "running" || status === "queued" || status === "building_context" ? (
        <Loader2 size={10} className="animate-spin" />
      ) : status === "completed" ? (
        <CheckCircle2 size={10} />
      ) : status === "failed" ? (
        <XCircle size={10} />
      ) : status === "cancelled" ? (
        <Ban size={10} />
      ) : status === "awaiting_input" ? (
        <ArrowRight size={10} />
      ) : status === "ready" ? (
        <Play size={10} />
      ) : null}
      {label}
    </span>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-success/10 text-success border border-success/30";
    case "failed":
      return "bg-danger/10 text-danger border border-danger/30";
    case "cancelled":
    case "cancel_requested":
      return "bg-[var(--row-hover)] text-muted border border-[var(--hairline)]";
    case "running":
      return "bg-[var(--cockpit-accent-soft)] text-[var(--cockpit-accent)] border border-[var(--cockpit-accent-line)]";
    case "awaiting_input":
      return "bg-warning/10 text-warning border border-warning/30";
    default:
      return "bg-[var(--row-hover)] text-muted border border-[var(--hairline)]";
  }
}
