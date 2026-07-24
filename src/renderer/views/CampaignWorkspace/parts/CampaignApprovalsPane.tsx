import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Spinner } from "@heroui/react";
import { ArrowLeft } from "lucide-react";
import { ApprovalDocket } from "@/renderer/components/campaignDeployment";
import type { CampaignContextIdentityViewModel } from "@/renderer/adapters/campaignViewModels";
import { mapProposalToViewModel } from "@/renderer/adapters/mapProposalToViewModel";
import { useActionProposal } from "@/renderer/hooks/useActionProposal";
import { useDeploymentClient } from "@/renderer/services/campaignDeployment";
import type { ControlCentreProposal } from "@/shared/campaignDeployment";

export function CampaignApprovalsPane(props: {
  projectId: string;
  campaignGroupId: string;
  identity: CampaignContextIdentityViewModel;
  pendingProposals: readonly {
    id: string;
    title: string;
    status: string;
    riskLevel: string | null;
  }[];
  selectedProposalId: string | null;
  onSelectProposal: (proposalId: string) => void;
  onBack: () => void;
}) {
  const { t } = useLingui();
  const client = useDeploymentClient(props.projectId, props.campaignGroupId);
  const proposalState = useActionProposal({
    projectId: props.projectId,
    campaignGroupId: props.campaignGroupId,
    proposalId: props.selectedProposalId,
  });
  const [proposalOverride, setProposalOverride] = useState<ControlCentreProposal | null>(null);

  useEffect(() => {
    setProposalOverride(null);
  }, [props.selectedProposalId]);

  const activeProposal =
    proposalOverride ?? (proposalState.state.status === "ready" ? proposalState.state.data : null);

  const viewModel =
    activeProposal !== null ? mapProposalToViewModel(activeProposal, props.identity) : null;

  async function refreshProposal(proposalId: string) {
    if (!client) throw new Error(t`No deployment client available.`);
    const refreshed = await client.refreshProposal(proposalId);
    setProposalOverride(refreshed);
  }

  const callbacks = {
    onApprove: async (input: {
      proposalId: string;
      approvalNote?: string;
      strongConfirmation?: string;
    }) => {
      if (!client) throw new Error(t`No deployment client available.`);
      const payload: {
        id: string;
        approvalNote?: string;
        strongConfirmation?: string;
      } = { id: input.proposalId };
      if (input.approvalNote !== undefined) payload.approvalNote = input.approvalNote;
      if (input.strongConfirmation !== undefined) {
        payload.strongConfirmation = input.strongConfirmation;
      }
      const updated = await client.approveProposal(payload);
      setProposalOverride(updated);
    },
    onReject: async (input: { proposalId: string; rejectionReason?: string }) => {
      if (!client) throw new Error(t`No deployment client available.`);
      const payload: { id: string; rejectionReason?: string } = { id: input.proposalId };
      if (input.rejectionReason !== undefined) payload.rejectionReason = input.rejectionReason;
      const updated = await client.rejectProposal(payload);
      setProposalOverride(updated);
    },
    onRefresh: async (input: { proposalId: string }) => {
      await refreshProposal(input.proposalId);
    },
  };

  const loading = proposalState.state.status === "loading";
  const error =
    proposalState.state.status === "error"
      ? proposalState.state.message
      : proposalState.state.status === "unavailable"
        ? proposalState.state.message
        : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 border-b border-divider px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          aria-label={t`Back to monitoring`}
          onPress={props.onBack}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0">
          <h3 className="truncate text-small font-medium text-foreground">
            <Trans>Proposals & Approvals</Trans>
          </h3>
          <p className="truncate text-tiny text-default-500">
            {props.identity.clientName ?? "—"} — {props.identity.campaignName}
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-divider p-2">
          {props.pendingProposals.length === 0 ? (
            <p className="px-2 py-3 text-tiny text-default-400">
              <Trans>No pending proposals.</Trans>
            </p>
          ) : (
            <ul className="space-y-1">
              {props.pendingProposals.map((proposal) => {
                const isActive = proposal.id === props.selectedProposalId;
                return (
                  <li key={proposal.id}>
                    <button
                      type="button"
                      onClick={() => props.onSelectProposal(proposal.id)}
                      className={`w-full rounded-medium px-2 py-2 text-left text-tiny transition-colors ${
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-foreground hover:bg-content2"
                      }`}
                    >
                      <p className="truncate font-medium">{proposal.title}</p>
                      <p className="truncate text-default-400">
                        {proposal.status}
                        {proposal.riskLevel ? ` · ${proposal.riskLevel}` : ""}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!client ? (
            <div className="flex items-center gap-2 text-small text-default-400">
              <Trans>Control Centre needs authorization. Reconnect it in MCP settings.</Trans>
            </div>
          ) : loading && !viewModel ? (
            <div className="flex items-center gap-2 text-small text-default-400">
              <Spinner size="sm" />
              <Trans>Loading proposal…</Trans>
            </div>
          ) : (
            <ApprovalDocket
              proposal={viewModel}
              loading={loading && !viewModel}
              {...(error ? { error } : {})}
              onRetry={() => void proposalState.refetch()}
              callbacks={callbacks}
            />
          )}
        </div>
      </div>
    </div>
  );
}
