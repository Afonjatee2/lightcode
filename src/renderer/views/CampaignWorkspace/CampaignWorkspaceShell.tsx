import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useLingui } from "@lingui/react/macro";
import { CampaignNavPane } from "./parts/CampaignNavPane";
import { CampaignThreadPane } from "./parts/CampaignThreadPane";
import { CampaignContextPane } from "./parts/CampaignContextPane";
import { CampaignApprovalsPane } from "./parts/CampaignApprovalsPane";
import { PlanIntelligencePane, type PlanIntelligenceSession } from "./parts/PlanIntelligencePane";
import { useProject } from "@/renderer/state/useThread";
import { useCampaignContext } from "@/renderer/hooks/useCampaignContext";
import {
  isLinkedCampaignGroupId,
  unlinkedCampaignIdentity,
} from "@/renderer/campaign/campaignWorkspaceIdentity";
import { useCampaignDecisions } from "@/renderer/hooks/useCampaignDecisions";
import { useRecordCampaignDecision } from "@/renderer/hooks/useRecordCampaignDecision";
import { useOperationsToday } from "@/renderer/hooks/useOperationsToday";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useAppStore } from "@/renderer/state/appStore";
import { CAMPAIGNS_HUB_GROUP_ID } from "@/renderer/campaign/ensureCampaignsHubProject";

const SIDEBAR_MIN_WIDTH = 240;
const PANEL_MIN_WIDTH = 320;
const KEYBOARD_RESIZE_STEP_PX = 16;

function ResizeBar(props: { onDrag: (delta: number) => void; label: string }) {
  function handleMouseDown(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const onMouseMove = (moveEv: globalThis.MouseEvent) => {
      props.onDrag(moveEv.clientX - startX);
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    props.onDrag(e.key === "ArrowRight" ? KEYBOARD_RESIZE_STEP_PX : -KEYBOARD_RESIZE_STEP_PX);
  }

  return (
    <div
      className="w-1.5 shrink-0 cursor-col-resize select-none border-x border-divider bg-content2 transition-all hover:w-2"
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={props.label}
    />
  );
}

/**
 * 3-pane campaign workspace shell: Clients/Campaigns │ Thread │ Context.
 * Rendered in place of the standard code layout when a campaign project is active (see `CampaignModeGate`). All data is live from Control Centre via
 * `useOperationsToday` (nav pane) and `useCampaignContext` (context pane) —
 * no placeholder/fake campaigns.
 */
export function CampaignWorkspaceShell(props: { projectId: string }) {
  const { t } = useLingui();
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(360);
  const [workspaceView, setWorkspaceView] = useState<"thread" | "approvals" | "planDiff">("thread");
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [planIntelligenceSession, setPlanIntelligenceSession] =
    useState<PlanIntelligenceSession | null>(null);
  const project = useProject(props.projectId);
  const boundCampaignGroupId = project?.campaignExtension?.campaignGroupId ?? null;
  const isHubProject = boundCampaignGroupId === CAMPAIGNS_HUB_GROUP_ID;
  const isUnlinkedProject =
    project?.purpose === "campaign" &&
    Boolean(project.campaignExtension) &&
    !isLinkedCampaignGroupId(boundCampaignGroupId);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    isHubProject ? null : boundCampaignGroupId,
  );
  const pendingWorkspaceSelection = useAppStore((state) => state.pendingCampaignWorkspaceSelection);
  const setPendingCampaignWorkspaceSelection = useAppStore(
    (state) => state.setPendingCampaignWorkspaceSelection,
  );
  const pendingApprovalsFocus = useAppStore((state) => state.pendingCampaignApprovalsFocus);
  const setPendingCampaignApprovalsFocus = useAppStore(
    (state) => state.setPendingCampaignApprovalsFocus,
  );

  const operationsToday = useOperationsToday(props.projectId);
  const activeCampaignId = selectedCampaignId ?? (isHubProject ? null : boundCampaignGroupId);
  const campaignContext = useCampaignContext(props.projectId, activeCampaignId);
  const threadIdentity =
    campaignContext.status === "ready"
      ? campaignContext.data.identity
      : isUnlinkedProject && project
        ? unlinkedCampaignIdentity(project)
        : null;
  const campaignDecisions = useCampaignDecisions(props.projectId, activeCampaignId);
  const recordDecision = useRecordCampaignDecision(props.projectId);

  useEffect(() => {
    if (!pendingWorkspaceSelection || pendingWorkspaceSelection.projectId !== props.projectId) {
      return;
    }
    setSelectedCampaignId(pendingWorkspaceSelection.campaignGroupId);
    setPendingCampaignWorkspaceSelection(null);
  }, [pendingWorkspaceSelection, props.projectId, setPendingCampaignWorkspaceSelection]);

  useEffect(() => {
    if (
      !pendingApprovalsFocus ||
      pendingApprovalsFocus.projectId !== props.projectId ||
      !activeCampaignId ||
      pendingApprovalsFocus.campaignGroupId !== activeCampaignId
    ) {
      return;
    }
    setWorkspaceView("approvals");
    setSelectedProposalId(pendingApprovalsFocus.proposalId ?? null);
    setPendingCampaignApprovalsFocus(null);
  }, [pendingApprovalsFocus, props.projectId, activeCampaignId, setPendingCampaignApprovalsFocus]);

  const clampLeft = (val: number) =>
    Math.min(Math.max(val, SIDEBAR_MIN_WIDTH), window.innerWidth - PANEL_MIN_WIDTH - 200);
  const clampRight = (val: number) =>
    Math.min(Math.max(val, PANEL_MIN_WIDTH), window.innerWidth - SIDEBAR_MIN_WIDTH - 200);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      <aside
        className="shrink-0 overflow-hidden border-r border-divider"
        style={{ width: leftWidth }}
      >
        <CampaignNavPane
          operationsToday={operationsToday}
          activeId={activeCampaignId}
          onSelect={setSelectedCampaignId}
          onNewCampaign={() => {
            usePanelStore.getState().openCreateCampaignProjectModal();
          }}
        />
      </aside>

      <ResizeBar
        label={t`Resize campaign list`}
        onDrag={(delta) => setLeftWidth((prev) => clampLeft(prev + delta))}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {workspaceView === "planDiff" && planIntelligenceSession && activeCampaignId ? (
          <PlanIntelligencePane
            projectId={props.projectId}
            session={planIntelligenceSession}
            onBack={() => {
              setWorkspaceView("thread");
              setPlanIntelligenceSession(null);
            }}
            onOpenApprovals={(proposalId) => {
              setSelectedProposalId(proposalId);
              setWorkspaceView("approvals");
              setPlanIntelligenceSession(null);
              useAppStore.getState().setPendingCampaignApprovalsFocus({
                projectId: props.projectId,
                campaignGroupId: activeCampaignId,
                proposalId,
              });
            }}
          />
        ) : workspaceView === "approvals" &&
          campaignContext.status === "ready" &&
          activeCampaignId ? (
          <CampaignApprovalsPane
            projectId={props.projectId}
            campaignGroupId={activeCampaignId}
            identity={campaignContext.data.identity}
            pendingProposals={campaignContext.data.pendingProposals}
            selectedProposalId={
              selectedProposalId ?? campaignContext.data.pendingProposals[0]?.id ?? null
            }
            onSelectProposal={setSelectedProposalId}
            onBack={() => setWorkspaceView("thread")}
          />
        ) : (
          <CampaignThreadPane
            projectId={props.projectId}
            identity={threadIdentity}
            suggestedQuestions={
              campaignContext.status === "ready" ? campaignContext.data.suggestedQuestions : []
            }
            onAnalyzeMediaPlan={(input) => {
              setPlanIntelligenceSession({
                filePath: input.filePath,
                filename: input.filename,
                campaignGroupId: activeCampaignId ?? input.campaignGroupId,
                ...(campaignContext.status === "ready" && campaignContext.data.identity.jobNumber
                  ? { jobNumber: campaignContext.data.identity.jobNumber }
                  : {}),
              });
              setWorkspaceView("planDiff");
            }}
          />
        )}
      </main>

      <ResizeBar
        label={t`Resize context panel`}
        onDrag={(delta) => setRightWidth((prev) => clampRight(prev - delta))}
      />

      <aside
        className="shrink-0 overflow-hidden border-l border-divider"
        style={{ width: rightWidth }}
      >
        <CampaignContextPane
          campaignContext={campaignContext}
          isUnlinkedProject={isUnlinkedProject}
          onOpenApprovals={(proposalId) => {
            setSelectedProposalId(proposalId ?? null);
            setWorkspaceView("approvals");
          }}
          {...(activeCampaignId
            ? {
                decisions: {
                  campaignGroupId: activeCampaignId,
                  state: campaignDecisions,
                  record: recordDecision,
                  onRecorded: () => {
                    campaignDecisions.refetch();
                    campaignContext.refetch();
                  },
                },
              }
            : {})}
        />
      </aside>
    </div>
  );
}
