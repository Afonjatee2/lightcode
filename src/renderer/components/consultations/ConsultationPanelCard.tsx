import { Trans, useLingui } from "@lingui/react/macro";
import { CheckCircle2, ExternalLink, Loader2, Users, XCircle, Ban, RotateCcw } from "lucide-react";
import type { ConsultationRecord, ConsultationResultAttachment, EvidenceFreshnessSummary } from "@/shared/consultations";
import { isTerminalStatus } from "@/shared/consultations";
import { Button } from "@/renderer/components/common/Button";
import { ContextWarnings, EvidenceFreshnessIndicator } from "./ContextWarnings";

interface PanelMemberState {
  record: ConsultationRecord;
  result: ConsultationResultAttachment | null;
  memberRole: string;
  requiredOrOptional: "required" | "optional";
}

interface ConsultationPanelCardProps {
  panelRecord: ConsultationRecord;
  panelResult: ConsultationResultAttachment | null;
  members: PanelMemberState[];
  evidenceFreshness?: EvidenceFreshnessSummary | null;
  missingDataWarnings?: string[];
  hasBudget?: boolean;
  hasPlan?: boolean;
  controlCentreAvailable?: boolean;
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
  onNavigateToChild?: (childThreadOrRunId: string) => void;
}

export function ConsultationPanelCard({
  panelRecord,
  panelResult,
  members,
  evidenceFreshness,
  missingDataWarnings,
  hasBudget = true,
  hasPlan = true,
  controlCentreAvailable = true,
  onCancel,
  onRetry,
  onNavigateToChild,
}: ConsultationPanelCardProps) {
  const { t } = useLingui();

  const completedCount = members.filter(
    (m) => isTerminalStatus(m.record.status) && m.record.status === "completed",
  ).length;
  const failedCount = members.filter((m) => m.record.status === "failed").length;
  const runningCount = members.filter(
    (m) => m.record.status === "running" || m.record.status === "queued" || m.record.status === "building_context" || m.record.status === "ready",
  ).length;
  const totalCount = members.length;

  return (
    <div className="rounded-xl border border-border bg-surface/60 p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-muted-foreground" />
          <span className="text-sm font-semibold">
            <Trans>Panel Consultation</Trans>
          </span>
          <span className="text-xs text-muted-foreground">
            {completedCount}/{totalCount} <Trans>complete</Trans>
            {failedCount > 0 ? ` · ${failedCount} ${t`failed`}` : null}
            {runningCount > 0 ? ` · ${runningCount} ${t`running`}` : null}
          </span>
        </div>
        <PanelStatusBadge
          completedCount={completedCount}
          failedCount={failedCount}
          runningCount={runningCount}
          totalCount={totalCount}
        />
      </div>

      <div className="text-sm text-foreground/80 leading-relaxed">
        {panelRecord.originalInstruction}
      </div>
      {panelRecord.retryOfConsultationId ? (
        <div className="text-xs text-muted-foreground">
          <Trans>Retry of panel</Trans> {panelRecord.retryOfConsultationId}
        </div>
      ) : null}

      <div className="space-y-2">
        {members.map((member) => (
          <PanelMemberRow
            key={member.record.id}
            member={member}
            {...(onNavigateToChild ? { onNavigateToChild } : {})}
          />
        ))}
      </div>

      {evidenceFreshness ? (
        <EvidenceFreshnessIndicator freshness={evidenceFreshness} />
      ) : null}

      <ContextWarnings
        evidenceFreshness={evidenceFreshness ?? null}
        missingDataWarnings={missingDataWarnings ?? []}
        hasBudget={hasBudget}
        hasPlan={hasPlan}
        controlCentreAvailable={controlCentreAvailable}
        permissionRestricted={false}
      />

      {panelRecord.status === "cancelled" ? (
        <div className="rounded-lg border border-muted/50 bg-muted/20 p-3 text-sm text-muted-foreground">
          <Trans>Panel consultation was cancelled</Trans>
        </div>
      ) : null}

      {!isTerminalStatus(panelRecord.status) && onCancel ? (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onPress={() => onCancel(panelRecord.id)}>
            <Ban size={14} />
            <Trans>Cancel panel</Trans>
          </Button>
        </div>
      ) : null}

      {(panelRecord.status === "failed" || panelRecord.status === "cancelled") && onRetry ? (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onPress={() => onRetry(panelRecord.id)}>
            <RotateCcw size={14} />
            <Trans>Retry panel</Trans>
          </Button>
        </div>
      ) : null}

      {panelRecord.status === "failed" && panelRecord.safeFailureMessage ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-danger">
            <XCircle size={16} />
            <Trans>Panel failed</Trans>
          </div>
          <p className="text-xs text-danger/80">{panelRecord.safeFailureMessage}</p>
        </div>
      ) : null}

      {panelRecord.status === "completed" && panelResult ? (
        <div className="rounded-lg border border-success/30 bg-success/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 size={16} />
            <Trans>Panel synthesis complete</Trans>
          </div>
          <p className="text-sm text-foreground/80">{panelResult.summary}</p>
          {panelResult.keyFindings.length > 0 ? (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                <Trans>Aggregated findings:</Trans>
              </span>
              <ul className="list-disc pl-4 text-xs text-foreground/70 space-y-0.5">
                {panelResult.keyFindings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PanelStatusBadge({
  completedCount,
  failedCount,
  runningCount,
  totalCount,
}: {
  completedCount: number;
  failedCount: number;
  runningCount: number;
  totalCount: number;
}) {
  if (runningCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary border border-primary/20">
        <Loader2 size={10} className="animate-spin" />
        <Trans>In progress</Trans>
      </span>
    );
  }
  if (failedCount === totalCount) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger border border-danger/20">
        <XCircle size={10} />
        <Trans>All failed</Trans>
      </span>
    );
  }
  if (completedCount === totalCount) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success border border-success/20">
        <CheckCircle2 size={10} />
        <Trans>Complete</Trans>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground border border-muted-foreground/10">
      {completedCount}/{totalCount} <Trans>done</Trans>
    </span>
  );
}

function PanelMemberRow({
  member,
  onNavigateToChild,
}: {
  member: PanelMemberState;
  onNavigateToChild?: (childThreadOrRunId: string) => void;
}) {
  const roleLabel = member.memberRole.replace(/_/g, " ");
  const isTerminal = isTerminalStatus(member.record.status);
  const provider = member.record.actualProvider ?? member.record.requestedProvider;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-surface/40 px-3 py-2">
      {member.record.status === "completed" ? (
        <CheckCircle2 size={14} className="text-success shrink-0" />
      ) : member.record.status === "failed" ? (
        <XCircle size={14} className="text-danger shrink-0" />
      ) : member.record.status === "cancelled" ? (
        <XCircle size={14} className="text-muted-foreground shrink-0" />
      ) : (
        <Loader2 size={14} className="animate-spin text-muted-foreground shrink-0" />
      )}
      <span className="text-xs font-medium capitalize">{roleLabel}</span>
      {provider ? (
        <span className="text-xs text-muted-foreground">{provider}</span>
      ) : null}
      <span className="text-xs text-muted-foreground">
        {member.requiredOrOptional === "required" ? "(required)" : "(optional)"}
      </span>
      {isTerminal && member.result ? (
        <span className="text-xs text-foreground/70 truncate ml-auto max-w-48">
          {member.result.summary.slice(0, 80)}
          {member.result.summary.length > 80 ? "..." : ""}
        </span>
      ) : null}
      {member.record.status === "failed" && member.record.safeFailureMessage ? (
        <span className="text-xs text-danger/70 truncate ml-auto max-w-48">
          {member.record.safeFailureMessage}
        </span>
      ) : null}
      {member.record.childThreadOrRunId && onNavigateToChild ? (
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto shrink-0"
          onPress={() => onNavigateToChild(member.record.childThreadOrRunId!)}
        >
          <ExternalLink size={12} />
        </Button>
      ) : null}
    </div>
  );
}
