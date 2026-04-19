import { useShallow } from "zustand/shallow";
import { X } from "lucide-react";
import { toast } from "@heroui/react";
import type {
  AgentStatus,
  ExtractContextResult,
  Project,
  PromptSegment,
  Thread,
  ThreadConfig,
} from "@/shared/contracts";
import { getProjectAgentStatuses } from "@/shared/agentStatus";
import { buildWorktreeLocation } from "@/shared/worktree";
import { isDraftPaneId, parseDraftProjectId } from "@/shared/paneId";
import { buildPaneLayoutFromLegacy, findPaneAlign } from "@/shared/paneLayout";
import { readBridge } from "@/renderer/bridge";
import {
  isDetectingAgentsForLocation,
  useAgentStatusesStore,
} from "@/renderer/state/agentStatusesStore";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useDevTerminalStore } from "@/renderer/state/devTerminalStore";
import { SplitPaneContainer } from "@/renderer/components/layout/SplitPaneContainer";
import { ThreadDraftView } from "@/renderer/components/thread/ThreadDraftView";
import { writeScriptToShell } from "@/renderer/utils/shellUtils";
import { generateTitleAsync } from "@/renderer/utils/titleGen";
import { HomeView } from "@/renderer/views/HomeView";
import { ThreadPane } from "./parts/ThreadPane";
import { DraftPane } from "./parts/DraftPane";

export function AppContent() {
  const view = useAppStore((state) => state.view);
  const projects = useAppStore((state) => state.projects);
  const createThread = useAppStore((state) => state.createThread);
  const queueThreadLaunch = useAppStore((state) => state.queueThreadLaunch);
  const updateProjectDraftConfig = useAppStore((state) => state.updateProjectDraftConfig);
  const activeGroupName = useAppStore((s) => {
    const v = s.view;
    if (v.kind !== "thread" || !v.activeGroupId) return undefined;
    const match = s.threads.find((t) => t.groupId === v.activeGroupId);
    return match?.groupName ?? match?.title ?? "Group";
  });
  async function handleDraftStart(
    project: Project,
    input: {
      agentKind: AgentStatus["kind"];
      config: import("@/shared/contracts").ThreadConfig;
      prompt: string;
      segments?: PromptSegment[];
      existingWorktreePath?: string;
      worktreeBranch?: string;
      worktreeBaseBranch?: string;
      worktreeIsNewBranch?: boolean;
    },
    replacePaneIdParam?: string,
  ) {
    const {
      agentKind,
      config,
      prompt,
      segments,
      existingWorktreePath,
      worktreeBranch,
      worktreeBaseBranch,
      worktreeIsNewBranch,
    } = input;

    updateProjectDraftConfig(project.id, {
      agentKind,
      model: config.model,
      effort: config.effort,
      mode: config.mode,
      approvalPolicy: config.approvalPolicy,
      sandboxMode: config.sandboxMode,
      worktreeMode: Boolean(worktreeBranch || existingWorktreePath),
    });

    let worktreePath: string | undefined;
    if (existingWorktreePath) {
      worktreePath = existingWorktreePath;
    } else if (worktreeBranch) {
      try {
        const result = await readBridge().gitAddWorktree({
          projectLocation: project.location,
          branch: worktreeBranch,
          createBranch: worktreeIsNewBranch ?? false,
          startPoint: worktreeBaseBranch,
        });
        worktreePath = result.path;

        const setupScript = project.scripts?.setupScript;
        if (setupScript) {
          const wtLocation = buildWorktreeLocation(project.location, result.path);
          const store = useDevTerminalStore.getState();
          const tab = store.addTab(project.id, "setup", result.path);
          if (useSharedSettings.getState().autoShowTerminalPanel) {
            store.openWorktreePanel(project.id, result.path);
          }
          store.setActiveTab(tab.id);
          void readBridge().startShell({
            shellId: tab.id,
            projectLocation: wtLocation,
            worktreePath: result.path,
          });
          writeScriptToShell(tab.id, setupScript);
        }
      } catch (err) {
        console.error("[renderer] failed to create worktree:", err);
        return;
      }
    }

    const { agentStatuses, wslAgentStatuses } = useAgentStatusesStore.getState();
    const projectAgentStatuses = getProjectAgentStatuses(
      project.location,
      agentStatuses,
      wslAgentStatuses,
    );
    const titlePrompt = segments
      ? segments
          .filter((s) => s.kind !== "attachment")
          .map((s) => (s.kind === "file" ? `@${s.path}` : s.content))
          .join("")
          .trim() || prompt
      : prompt;
    const currentView = useAppStore.getState().view;
    const activeGroup =
      currentView.kind === "thread" && currentView.activeGroupId
        ? {
            groupId: currentView.activeGroupId,
            groupName: useAppStore
              .getState()
              .threads.find((t) => t.groupId === currentView.activeGroupId)?.groupName,
          }
        : undefined;

    const thread = createThread({
      projectId: project.id,
      agentKind,
      config,
      prompt: titlePrompt,
      ...(worktreePath ? { worktreePath, worktreeBranch } : {}),
      ...(replacePaneIdParam ? { replacePaneId: replacePaneIdParam } : {}),
      ...(activeGroup?.groupId ? { groupId: activeGroup.groupId } : {}),
      ...(activeGroup?.groupName ? { groupName: activeGroup.groupName } : {}),
    });
    queueThreadLaunch(thread.id, prompt, segments);
    generateTitleAsync(thread.id, project.location, projectAgentStatuses, titlePrompt);
  }

  async function handleContinueInProvider(
    sourceThread: Thread,
    targetAgentKind: string,
    targetConfig: ThreadConfig,
    closeOriginal: boolean,
    extractedContext: ExtractContextResult | null,
  ) {
    const storeProjects = useAppStore.getState().projects;
    const project = storeProjects.find((p) => p.id === sourceThread.projectId);
    if (!project) return;

    const groupId = sourceThread.groupId ?? crypto.randomUUID();
    const groupName = sourceThread.groupName ?? sourceThread.title;
    if (!sourceThread.groupId) {
      useAppStore.setState((state) => ({
        threads: state.threads.map((t) =>
          t.id === sourceThread.id ? { ...t, groupId, groupName } : t,
        ),
      }));
    }

    const thread = createThread({
      projectId: project.id,
      agentKind: targetAgentKind,
      config: targetConfig,
      prompt: extractedContext ? "Continuing task from another provider..." : sourceThread.title,
      ...(sourceThread.worktreePath ? { worktreePath: sourceThread.worktreePath } : {}),
      ...(sourceThread.worktreeBranch ? { worktreeBranch: sourceThread.worktreeBranch } : {}),
      groupId,
      groupName,
    });

    if (extractedContext) {
      try {
        const filePath = await readBridge().saveHandoffContext({
          threadId: thread.id,
          content: extractedContext.summary,
        });
        const prompt = `This task was handed off from a ${extractedContext.sourceProvider} session. Read the attached context file and understand it. Wait for instructions.`;
        const segments: PromptSegment[] = [
          { kind: "text", content: prompt },
          { kind: "attachment", path: filePath },
        ];
        queueThreadLaunch(thread.id, prompt, segments);
      } catch {
        const prompt = `[Context from previous ${extractedContext.sourceProvider} session]\n\n${extractedContext.summary}\n\nUnderstand the context and wait for instructions.`;
        queueThreadLaunch(thread.id, prompt);
      }
    }

    if (closeOriginal) {
      readBridge()
        .closeThread({ threadId: sourceThread.id })
        .catch(() => {});
      useAppStore.getState().openThread(thread.id);
    } else {
      useAppStore.getState().openThreadSideBySide(thread.id);
    }

    const { agentStatuses, wslAgentStatuses } = useAgentStatusesStore.getState();
    const agents = getProjectAgentStatuses(project.location, agentStatuses, wslAgentStatuses);
    generateTitleAsync(thread.id, project.location, agents, sourceThread.title);

    const targetLabel = agents.find((a) => a.kind === targetAgentKind)?.label ?? targetAgentKind;
    toast.success(`Context transferred to ${targetLabel}`);
  }

  if (view.kind === "draft") {
    const project = projects.find((item) => item.id === view.projectId);
    if (!project) {
      return <HomeView />;
    }
    return (
      <div className="h-full">
        <DraftViewContent
          project={project}
          onStart={(input) => void handleDraftStart(project, input)}
        />
      </div>
    );
  }

  if (view.kind === "thread") {
    const closePane = useAppStore.getState().closePane;
    const paneCount = view.panes.length;
    const paneLayout = view.paneLayout ?? buildPaneLayoutFromLegacy(view.panes, view.rowLayout);
    // Non-subscribing read: threads / projects array identity isn't worth
    // a re-render here — pane deletion always updates view.panes atomically.
    const storeThreads = useAppStore.getState().threads;
    const hasValidPanes = view.panes.some((id) =>
      isDraftPaneId(id)
        ? projects.some((p) => p.id === parseDraftProjectId(id))
        : storeThreads.some((t) => t.id === id),
    );

    if (!hasValidPanes) {
      return (
        <div className="h-full">
          <HomeView />
        </div>
      );
    }

    function renderPane(paneId: string) {
      const draftProjectId = parseDraftProjectId(paneId);
      const paneAlign = findPaneAlign(paneLayout, paneId);
      const paneContent = draftProjectId ? (
        <DraftPane
          key={paneId}
          paneId={paneId}
          projectId={draftProjectId}
          paneCount={paneCount}
          paneAlign={paneAlign}
          onClose={() => closePane(paneId)}
          onStart={(project, input) => void handleDraftStart(project, input, paneId)}
        />
      ) : (
        <ThreadPane
          key={paneId}
          threadId={paneId}
          paneCount={paneCount}
          paneAlign={paneAlign}
          onClose={() => closePane(paneId)}
          onContinueInProvider={handleContinueInProvider}
        />
      );
      return (
        <div
          key={paneId}
          className="h-full outline-none"
          tabIndex={-1}
          onFocusCapture={() => useAppStore.getState().setFocusedPane(paneId)}
        >
          {paneContent}
        </div>
      );
    }

    const activeGroupId = view.activeGroupId;

    return (
      <div className="flex h-full flex-col">
        {activeGroupId && activeGroupName && (
          <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-4 py-1">
            <span className="truncate text-xs font-medium text-muted">{activeGroupName}</span>
            <button
              type="button"
              aria-label="Close group"
              className="shrink-0 rounded p-0.5 text-muted/60 transition-colors hover:bg-white/[0.06] hover:text-foreground"
              onClick={() => useAppStore.getState().closeGroupView()}
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          <SplitPaneContainer layout={paneLayout} renderPane={renderPane} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <HomeView />
    </div>
  );
}

/**
 * Draft view for the full-screen "draft" app view (no thread panes yet).
 * Subscribes to the agent statuses store so the composer re-renders when
 * detection finishes — previously the parent used a non-subscribing read and
 * the "No supported agents" message could persist after statuses arrived.
 */
function DraftViewContent(props: {
  project: Project;
  onStart: (input: {
    agentKind: AgentStatus["kind"];
    config: ThreadConfig;
    prompt: string;
    segments?: PromptSegment[];
    existingWorktreePath?: string;
    worktreeBranch?: string;
    worktreeBaseBranch?: string;
    worktreeIsNewBranch?: boolean;
  }) => void;
}) {
  const { project, onStart } = props;
  const projectAgentStatuses = useAgentStatusesStore(
    useShallow((s) =>
      getProjectAgentStatuses(project.location, s.agentStatuses, s.wslAgentStatuses),
    ),
  );
  const isDetectingAgents = useAgentStatusesStore((s) =>
    isDetectingAgentsForLocation(s, project.location),
  );
  return (
    <ThreadDraftView
      project={project}
      agentStatuses={projectAgentStatuses}
      isDetectingAgents={isDetectingAgents}
      {...(project.lastDraftConfig ? { lastDraftConfig: project.lastDraftConfig } : {})}
      onStart={onStart}
    />
  );
}
