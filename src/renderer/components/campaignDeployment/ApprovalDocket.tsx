import { Alert, Button, Skeleton, Spinner } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { FileQuestion } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  isProposalExpired,
  type ActionProposalCallbacks,
  type ActionProposalViewModel,
} from "./actionProposalViewModel";
import { docketStrings } from "./approvalDocketStrings";
import { ChangeComparison } from "./parts/ChangeComparison";
import { DecisionActions } from "./parts/DecisionActions";
import { DocketHeader } from "./parts/DocketHeader";
import { EvidenceSection } from "./parts/EvidenceSection";
import { OutcomeSection } from "./parts/OutcomeSection";
import { RiskSection } from "./parts/RiskSection";
import { DocketLifecycleStepper } from "./parts/DocketLifecycleStepper";
import { StrongConfirmationDialog } from "./parts/StrongConfirmationDialog";

type PendingAction = "approve" | "reject" | null;

export type ApprovalDocketProps = {
  /**
   * Server-normalized proposal to render. `null`/`undefined` renders the
   * empty state. The docket renders this prop verbatim — it never fetches,
   * never writes to a platform, and never derives approval state locally.
   */
  proposal?: ActionProposalViewModel | null | undefined;
  /** Skeleton state while the host is fetching the proposal. */
  loading?: boolean;
  /** Server-reported load failure for the proposal itself. */
  error?: string;
  /** Host-supplied reload handler for the load-error state. */
  onRetry?: () => void;
  /** Injectable clock for expiry checks; defaults to `new Date()`. */
  now?: Date;
  callbacks: ActionProposalCallbacks;
  /** Optional host-supplied class for the docket surface. */
  className?: string;
};

function LoadingDocket() {
  const { t } = useLingui();
  return (
    <div
      className="max-w-4xl space-y-4"
      role="status"
      aria-busy="true"
      data-testid="docket-loading"
    >
      <span className="sr-only">{t`Loading…`}</span>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function EmptyDocket() {
  const { t } = useLingui();
  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center gap-2 rounded-medium border border-dashed border-divider px-6 py-12 text-center"
      data-testid="docket-empty"
    >
      <FileQuestion aria-hidden className="size-6 text-default-400" />
      <p className="text-small text-default-500">{t(docketStrings.emptyState)}</p>
    </div>
  );
}

function LoadErrorDocket(props: { message: string; onRetry?: () => void }) {
  const { t } = useLingui();
  return (
    <div className="flex max-w-4xl flex-wrap items-center gap-3" data-testid="docket-error">
      <Alert status="danger" className="min-w-0 flex-1">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{t(docketStrings.errorStateTitle)}</Alert.Title>
          <Alert.Description>{props.message}</Alert.Description>
        </Alert.Content>
      </Alert>
      {props.onRetry ? (
        <Button size="sm" variant="ghost" data-testid="docket-retry-button" onPress={props.onRetry}>
          <Trans>Retry</Trans>
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Campaign action-proposal approval docket.
 *
 * An editorial "decision docket" surface for operator review of a single
 * server-generated action proposal (budget changes, targeting changes, …).
 * It is purely presentational with respect to data: every value comes from
 * the injected `proposal` view model, every mutation goes through the
 * injected `callbacks`, and every result is rendered from server-returned
 * state only.
 *
 * Guarantees (enforced by construction, covered by ApprovalDocket.test.tsx):
 * - no network code, no platform writes, no evidence recomputation;
 * - no local approval database and no local "applied" marking;
 * - high/critical-risk approvals always pass through the strong
 *   confirmation dialog and the typed phrase is forwarded verbatim;
 * - the host is asked to `onRefresh` after every successful decision so the
 *   UI re-reads the server's truth.
 *
 * MOUNTING INTEGRATION TODO: mount inside the existing CampaignWorkspace
 * (owned by another workstream) once the host adapter is wired — see
 * INTEGRATION_TODOS.md in this directory.
 */
export function ApprovalDocket(props: ApprovalDocketProps) {
  const { t } = useLingui();
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [strongConfirm, setStrongConfirm] = useState<{
    open: boolean;
    approvalNote: string | undefined;
  }>({ open: false, approvalNote: undefined });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { proposal, callbacks } = props;
  const proposalId = proposal?.id;

  useEffect(() => {
    setSubmitError(null);
    setPendingAction(null);
    setStrongConfirm({ open: false, approvalNote: undefined });
  }, [proposalId]);

  function failWith(error: unknown) {
    if (mountedRef.current) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    }
  }

  async function runRefresh() {
    if (!proposal) return;
    setRefreshPending(true);
    try {
      await callbacks.onRefresh({ proposalId: proposal.id });
    } catch (error) {
      failWith(error);
    } finally {
      if (mountedRef.current) setRefreshPending(false);
    }
  }

  async function submitApproval(approvalNote: string | undefined, strongConfirmation?: string) {
    if (!proposal || pendingAction) return;
    setPendingAction("approve");
    setSubmitError(null);
    try {
      await callbacks.onApprove({
        proposalId: proposal.id,
        ...(approvalNote !== undefined ? { approvalNote } : {}),
        ...(strongConfirmation !== undefined ? { strongConfirmation } : {}),
      });
      await callbacks.onRefresh({ proposalId: proposal.id });
    } catch (error) {
      failWith(error);
    } finally {
      if (mountedRef.current) {
        setPendingAction(null);
        setStrongConfirm({ open: false, approvalNote: undefined });
      }
    }
  }

  function handleApprove(approvalNote: string | undefined) {
    if (!proposal) return;
    const { risk } = proposal;
    if (risk.requiresStrongConfirmation || risk.level === "high" || risk.level === "critical") {
      setStrongConfirm({ open: true, approvalNote });
      return;
    }
    void submitApproval(approvalNote);
  }

  async function handleReject(rejectionReason: string | undefined) {
    if (!proposal || pendingAction) return;
    setPendingAction("reject");
    setSubmitError(null);
    try {
      await callbacks.onReject({
        proposalId: proposal.id,
        ...(rejectionReason !== undefined ? { rejectionReason } : {}),
      });
      await callbacks.onRefresh({ proposalId: proposal.id });
    } catch (error) {
      failWith(error);
    } finally {
      if (mountedRef.current) setPendingAction(null);
    }
  }

  if (props.loading) {
    return <LoadingDocket />;
  }

  if (props.error) {
    return (
      <LoadErrorDocket
        message={props.error}
        {...(props.onRetry ? { onRetry: props.onRetry } : {})}
      />
    );
  }

  if (!proposal) {
    return <EmptyDocket />;
  }

  const expired = isProposalExpired(proposal.expiresAt, props.now ?? new Date());

  return (
    <article
      data-testid="approval-docket"
      aria-label={t(docketStrings.docketKicker)}
      className={`relative max-w-4xl space-y-6 pb-8 ${props.className ?? ""}`}
    >
      <DocketHeader
        proposal={proposal}
        isExpired={expired}
        refreshPending={refreshPending}
        onRefreshPress={() => void runRefresh()}
      />

      <DocketLifecycleStepper status={proposal.status} />

      <ChangeComparison proposal={proposal} />
      <EvidenceSection proposal={proposal} />
      <RiskSection proposal={proposal} />
      <OutcomeSection proposal={proposal} />

      {expired ? (
        proposal.status === "applying" ? (
          <p
            className="flex items-center gap-2 text-small text-default-600"
            role="status"
            data-testid="applying-note-expired"
          >
            <Spinner size="sm" aria-hidden />
            {t(docketStrings.applyingNote)}
          </p>
        ) : null
      ) : (
        <DecisionActions
          proposal={proposal}
          pendingAction={pendingAction}
          onApprove={handleApprove}
          onReject={(reason) => void handleReject(reason)}
        />
      )}

      {submitError ? (
        <Alert status="danger" data-testid="docket-submit-error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t(docketStrings.actionFailedTitle)}</Alert.Title>
            <Alert.Description>{submitError}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <StrongConfirmationDialog
        isOpen={strongConfirm.open}
        proposalTitle={proposal.title}
        submitPending={pendingAction === "approve"}
        onConfirm={(phrase) => void submitApproval(strongConfirm.approvalNote, phrase)}
        onClose={() => setStrongConfirm({ open: false, approvalNote: undefined })}
      />
    </article>
  );
}
