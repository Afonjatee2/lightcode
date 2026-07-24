import { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { Alert, Spinner } from "@heroui/react";
import type { PlanDiffViewModel } from "@/shared/contracts/campaign/planIntelligence";
import { resolveControlCentreServer } from "@/renderer/hooks/useControlCentreTool";
import { useProject } from "@/renderer/state/useThread";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import {
  PlanIntelligenceFlowError,
  proposePlanUpdates,
  runPlanCompareFlow,
} from "@/renderer/services/planIntelligence/runPlanCompareFlow";
import { PlanDiffView, PlanDiffViewHeader } from "./PlanDiffView";

export type PlanIntelligenceSession = {
  filePath: string;
  filename: string;
  campaignGroupId: string;
  jobNumber?: string | null;
};

export function PlanIntelligencePane(props: {
  projectId: string;
  session: PlanIntelligenceSession;
  onBack: () => void;
  onOpenApprovals: (proposalId: string) => void;
}) {
  const project = useProject(props.projectId);
  const userMcpServers = useSharedSettings((state) => state.mcpServers);
  const server = resolveControlCentreServer(project, userMcpServers);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewModel, setViewModel] = useState<PlanDiffViewModel | null>(null);
  const [candidatePlanId, setCandidatePlanId] = useState<string | null>(null);
  const [basePlanId, setBasePlanId] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [createdProposalId, setCreatedProposalId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCompare() {
      if (!server) {
        if (!cancelled) {
          setError("No Control Centre MCP server is configured for this project.");
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await runPlanCompareFlow({
          server,
          ...(project?.location ? { projectLocation: project.location } : {}),
          campaignGroupId: props.session.campaignGroupId,
          ...(props.session.jobNumber ? { jobNumber: props.session.jobNumber } : {}),
          filePath: props.session.filePath,
          filename: props.session.filename,
          createProposal: false,
        });
        if (cancelled) return;
        setViewModel(result.diffViewModel);
        setCandidatePlanId(result.candidatePlanId);
        setBasePlanId(result.basePlanId);
      } catch (caught: unknown) {
        if (cancelled) return;
        const message =
          caught instanceof PlanIntelligenceFlowError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : String(caught);
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadCompare();
    return () => {
      cancelled = true;
    };
  }, [
    server,
    project?.location,
    props.session.campaignGroupId,
    props.session.jobNumber,
    props.session.filePath,
    props.session.filename,
  ]);

  async function handleCreateProposal() {
    if (!server || !candidatePlanId || !basePlanId) return;
    setProposing(true);
    setError(null);
    try {
      const proposal = await proposePlanUpdates({
        context: {
          server,
          ...(project?.location ? { projectLocation: project.location } : {}),
          campaignGroupId: props.session.campaignGroupId,
          ...(props.session.jobNumber ? { jobNumber: props.session.jobNumber } : {}),
        },
        candidatePlanId,
        basePlanId,
        allowLowConfidence: true,
      });
      const proposalId = proposal.proposal.id;
      setCreatedProposalId(proposalId);
      props.onOpenApprovals(proposalId);
    } catch (caught: unknown) {
      const message =
        caught instanceof PlanIntelligenceFlowError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : String(caught);
      setError(message);
    } finally {
      setProposing(false);
    }
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="plan-intelligence-pane"
    >
      <PlanDiffViewHeader filename={props.session.filename} onBack={props.onBack} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-default-500">
            <Spinner size="sm" />
            <Trans>Comparing plan versions…</Trans>
          </div>
        ) : error ? (
          <div className="p-4">
            <Alert status="danger" data-testid="plan-intelligence-error">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>
                  <Trans>Plan comparison failed</Trans>
                </Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          </div>
        ) : viewModel ? (
          <PlanDiffView
            viewModel={viewModel}
            filename={props.session.filename}
            proposing={proposing}
            createdProposalId={createdProposalId}
            onCreateProposal={() => void handleCreateProposal()}
            onOpenApprovals={props.onOpenApprovals}
          />
        ) : null}
      </div>
    </div>
  );
}
