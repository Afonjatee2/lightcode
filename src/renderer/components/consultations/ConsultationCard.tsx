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
  const modeLabel = record.consultationMode === "panel"
    ? t`Panel`
    : record.consultationMode === "finalise"
      ? t`Finalise`
      : t`Standard`;
  const isTerminal = isTerminalStatus(record.status);
  const createdAt = new Date(record.createdAt);
  const startedAt = record.startedAt ? new Date(record.startedAt) : null;
  const completedAt = record.completedAt ? new Date(record.completedAt) : null;

  return (
    <div className="rounded-xl border border-border bg-surface/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold capitalize truncate">{roleLabel}</span>
          {providerLabel ? (
            <span className="text-xs text-muted-foreground shrink-0">
              {providerLabel}
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground shrink-0">· {modeLabel}</span>
        </div>
        <StatusBadge status={record.status} />
      </div>

      <div className="text-sm text-foreground/80 leading-relaxed">
        {record.originalInstruction}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
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

      {evidenceFreshness ? (
        <EvidenceFreshnessIndicator freshness={evidenceFreshness} />
      ) : null}

      <ContextWarnings
        evidenceFreshness={evidenceFreshness}
        missingDataWarnings={missingDataWarnings}
        hasBudget={hasBudget}
        hasPlan={hasPlan}
        controlCentreAvailable={controlCentreAvailable}
        permissionRestricted={false}
      />

      {!isTerminal ? (
        <div className="flex items-center gap-2">
          {record.status === "running" || record.status === "queued" || record.status === "building_context" || record.status === "ready" || record.status === "awaiting_input" ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              <Trans>In progress</Trans>
            </span>
          ) : null}
          {canCancel ? (
            <Button
              size="sm"
              variant="secondary"
              onPress={() => onCancel(record.id)}
            >
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
        <CompletionResult result={resultAttachment} />
      ) : null}

      {record.status === "failed" ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-danger">
            <XCircle size={16} />
            <Trans>Consultation failed</Trans>
          </div>
          {record.safeFailureMessage ? (
            <p className="text-xs text-danger/80">{record.safeFailureMessage}</p>
          ) : null}
          {canRetry ? (
            <Button
              size="sm"
              variant="secondary"
              onPress={() => onRetry(record.id)}
            >
              <RefreshCw size={14} />
              <Trans>Retry</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}

      {record.status === "cancelled" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Ban size={14} />
          <Trans>Consultation was cancelled</Trans>
        </div>
      ) : null}
    </div>
  );
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

function StatusBadge({ status }: { status: ConsultationRecord["status"] }) {
  const label = statusUiLabel(status);
  const color = statusColor(status);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${color}`}
    >
      {(status === "running" || status === "queued" || status === "building_context") ? (
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

function statusUiLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "Queued",
    building_context: "Building",
    ready: "Ready",
    running: "Running",
    awaiting_input: "Awaiting input",
    completed: "Complete",
    failed: "Failed",
    cancel_requested: "Cancelling",
    cancelled: "Cancelled",
  };
  return labels[status] ?? status;
}

function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-success/10 text-success border border-success/20";
    case "failed":
      return "bg-danger/10 text-danger border border-danger/20";
    case "cancelled":
    case "cancel_requested":
      return "bg-muted text-muted-foreground border border-muted-foreground/20";
    case "running":
      return "bg-primary/10 text-primary border border-primary/20";
    case "awaiting_input":
      return "bg-warning/10 text-warning border border-warning/20";
    default:
      return "bg-muted/50 text-muted-foreground border border-muted-foreground/10";
  }
}
