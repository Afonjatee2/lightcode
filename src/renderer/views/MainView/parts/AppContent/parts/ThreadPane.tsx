import { startTransition, useRef } from "react";
import type { ExtractContextResult, Thread, ThreadConfig } from "@/shared/contracts";
import { buildWorktreeLocation } from "@/shared/worktree";
import { buildPromptContentBlocks } from "@/shared/promptContent";
import { readBridge } from "@/renderer/bridge";
import { closePanelsForUnloadedThread } from "@/renderer/actions/panelActions";
import { useAppStore } from "@/renderer/state/appStore";
import { useProject, useThread } from "@/renderer/state/useThread";
import { ThreadView } from "@/renderer/components/thread/ThreadView";
import { useDraggable, useDroppable } from "@dnd-kit/react";
import { useIsDraggingPane, usePaneDropIndicatorState, type DragSourceData } from "@/renderer/dnd";
import {
  useInstalledAgents,
  useProjectAgentStatuses,
  useThreadPendingLaunch,
  useThreadServerRequests,
} from "@/renderer/hooks/uiSelectors";

export function ThreadPane(props: {
  threadId: string;
  paneCount: number;
  paneAlign: "left" | "center" | "right";
  onClose: () => void;
  onContinueInProvider?: (
    sourceThread: Thread,
    targetKind: string,
    targetConfig: ThreadConfig,
    closeOriginal: boolean,
    extractedContext: ExtractContextResult | null,
  ) => void;
}) {
  const thread = useThread(props.threadId);
  const project = useProject(thread?.projectId);
  const installedAgents = useInstalledAgents();
  const projectAgentStatuses = useProjectAgentStatuses(project?.location);
  const agentStatus = projectAgentStatuses.find((status) => status.kind === thread?.agentKind);
  const pendingServerRequests = useThreadServerRequests(props.threadId);
  const { prompt: pendingLaunchPrompt, segments: pendingLaunchSegments } = useThreadPendingLaunch(
    props.threadId,
  );
  const {
    applyRuntimeEvent,
    updateThreadConfig,
    updateThreadRuntime,
    consumeThreadLaunch,
    removeThreadServerRequest,
    touchThread,
    markThreadDone,
    unmarkThreadDone,
  } = useAppStore.getState();

  const paneElementRef = useRef<HTMLDivElement>(null);
  const { handleRef } = useDraggable({
    id: `pane:${props.threadId}`,
    type: "pane",
    data: { type: "pane", paneId: props.threadId } satisfies DragSourceData,
    disabled: props.paneCount <= 1,
    element: paneElementRef,
  });
  useDroppable({
    id: `pane-drop:${props.threadId}`,
    accept: ["pane", "thread", "new-thread"],
    data: { type: "pane-drop-zone", paneId: props.threadId },
    element: paneElementRef,
  });

  const isDragging = useIsDraggingPane(props.threadId);
  const dropIndicator = usePaneDropIndicatorState(props.threadId);

  if (!thread) return null;
  if (!project) return null;
  return (
    <ThreadView
      key={props.threadId}
      thread={thread}
      projectName={project.name}
      agentStatus={agentStatus}
      isWsl={project.location.kind === "wsl"}
      showCloseButton
      paneAlign={props.paneAlign}
      isDragging={isDragging}
      dropIndicator={dropIndicator}
      paneCount={props.paneCount}
      {...(props.paneCount > 1 ? { dragHandleRef: handleRef } : {})}
      droppableRef={paneElementRef}
      onClose={props.onClose}
      onMarkDone={() => {
        const latestThread = useAppStore.getState().threads.find((t) => t.id === props.threadId);
        if (!latestThread) return;
        if (latestThread.done) {
          unmarkThreadDone(latestThread.id);
        } else {
          if (latestThread.status !== "inactive" && latestThread.sessionRef) {
            void readBridge().closeThread({ threadId: latestThread.id });
            useAppStore.getState().markThreadExited(latestThread.id);
            closePanelsForUnloadedThread(latestThread);
          }
          markThreadDone(latestThread.id);
        }
      }}
      onConfigChange={(config) => updateThreadConfig(thread.id, config)}
      pendingServerRequests={pendingServerRequests}
      projectLocation={
        thread.worktreePath
          ? buildWorktreeLocation(project.location, thread.worktreePath)
          : project.location
      }
      onLaunchConsumed={() => consumeThreadLaunch(thread.id)}
      onLaunchFailed={(message) => {
        startTransition(() => {
          applyRuntimeEvent(thread.id, {
            type: "error",
            threadId: thread.id,
            message,
          });
          updateThreadRuntime(thread.id, {
            status: "error",
            attention: "error",
            ...(thread.sessionRef ? { sessionRef: thread.sessionRef } : {}),
            canResumeWithConfig: thread.canResumeWithConfig || thread.sessionRef !== undefined,
          });
        });
      }}
      onResolveServerRequest={async ({ requestId, method, response }) => {
        await readBridge().resolveThreadServerRequest({
          threadId: thread.id,
          requestId,
          method,
          response,
        });
        removeThreadServerRequest(thread.id, requestId);
        touchThread(thread.id);
      }}
      {...(pendingLaunchPrompt !== undefined ? { pendingLaunchPrompt } : {})}
      {...(pendingLaunchSegments ? { pendingLaunchSegments } : {})}
      onSubmitInput={async (prompt, segments) => {
        // Optimistic user_message for GUI threads: paint the typed prompt
        // into the chat pane synchronously so it shows before the IPC
        // round-trip + (for first prompts) ACP handshake completes. The
        // supervisor reuses the same item id end-to-end so duplicates are
        // dropped by the renderer's per-id dedupe in `applyRuntimeEvent`.
        const presentation = thread.presentationMode ?? "terminal";
        let optimisticUserMessageItemId: string | undefined;
        if (presentation === "gui" && prompt.length > 0) {
          optimisticUserMessageItemId = `user-${crypto.randomUUID()}`;
          useAppStore.getState().applyRuntimeEvent(thread.id, {
            type: "item.started",
            threadId: thread.id,
            itemId: optimisticUserMessageItemId,
            itemType: "user_message",
            payload: { content: buildPromptContentBlocks(prompt, segments) },
          });
          useAppStore.getState().applyRuntimeEvent(thread.id, {
            type: "item.completed",
            threadId: thread.id,
            itemId: optimisticUserMessageItemId,
          });
        }
        await readBridge().sendThreadInput({
          threadId: thread.id,
          prompt,
          ...(segments ? { segments } : {}),
          config: thread.config,
          ...(optimisticUserMessageItemId
            ? { userMessageItemId: optimisticUserMessageItemId }
            : {}),
        });
        touchThread(thread.id);
      }}
      installedAgents={installedAgents}
      onContinueInProvider={
        props.onContinueInProvider
          ? (targetKind, tConfig, closeOrig, ctx) => {
              props.onContinueInProvider?.(thread, targetKind, tConfig, closeOrig, ctx);
            }
          : undefined
      }
    />
  );
}
