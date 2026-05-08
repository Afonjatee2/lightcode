import { memo, useEffect, useRef, useState } from "react";
import { Tooltip } from "@heroui/react";
import { ArrowRightLeft, Bug, CircleCheck, X } from "lucide-react";
import type {
  AgentStatus,
  ProjectLocation,
  PromptSegment,
  TerminalSize,
  Thread,
  ThreadConfig,
  ThreadServerRequestId,
} from "@/shared/contracts";
import { buildPromptContentBlocks } from "@/shared/promptContent";

import { useAppStore, type PendingThreadServerRequest } from "@/renderer/state/appStore";
import { TuxIcon } from "@/renderer/components/common";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { readBridge } from "@/renderer/bridge";
import type { TerminalPaneHandle } from "./TerminalPane";
import { ContinueInProviderDialog } from "./ContinueInProviderDialog";
import { GuiThreadContent, TerminalThreadContent } from "./ThreadContent";
import { ThreadHeaderStatusButton } from "./ThreadHeaderStatus";

const DEFAULT_HIDDEN_TERMINAL_SIZE: TerminalSize = { cols: 120, rows: 30 };

function formatLaunchError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }
  return "Thread failed to start.";
}

function areThreadViewPropsEqual(prev: ThreadViewProps, next: ThreadViewProps): boolean {
  return (
    prev.thread.id === next.thread.id &&
    prev.thread.projectId === next.thread.projectId &&
    prev.thread.title === next.thread.title &&
    prev.thread.agentKind === next.thread.agentKind &&
    prev.thread.agentInstanceId === next.thread.agentInstanceId &&
    prev.thread.worktreePath === next.thread.worktreePath &&
    prev.thread.presentationMode === next.thread.presentationMode &&
    prev.thread.done === next.thread.done &&
    prev.thread.canResumeWithConfig === next.thread.canResumeWithConfig &&
    prev.thread.sessionRef?.providerSessionId === next.thread.sessionRef?.providerSessionId &&
    prev.thread.config === next.thread.config &&
    prev.agentStatus === next.agentStatus &&
    prev.projectLocation === next.projectLocation &&
    prev.projectName === next.projectName &&
    prev.pendingLaunchPrompt === next.pendingLaunchPrompt &&
    prev.pendingLaunchSegments === next.pendingLaunchSegments &&
    prev.isWsl === next.isWsl &&
    prev.pendingServerRequests === next.pendingServerRequests &&
    prev.showCloseButton === next.showCloseButton &&
    prev.paneAlign === next.paneAlign &&
    prev.isDragging === next.isDragging &&
    prev.dropIndicator === next.dropIndicator &&
    prev.paneCount === next.paneCount &&
    prev.dragHandleRef === next.dragHandleRef &&
    prev.droppableRef === next.droppableRef &&
    prev.installedAgents === next.installedAgents &&
    prev.onContinueInProvider === next.onContinueInProvider
  );
}

export type ThreadViewProps = {
  thread: Thread;
  agentStatus: AgentStatus | undefined;
  projectLocation: ProjectLocation;
  projectName?: string;
  pendingLaunchPrompt?: string;
  pendingLaunchSegments?: PromptSegment[];
  isWsl?: boolean;
  pendingServerRequests: PendingThreadServerRequest[];
  showCloseButton?: boolean;
  paneAlign?: "left" | "center" | "right";
  isDragging?: boolean;
  dropIndicator?:
    | false
    | "replace"
    | "insert-left"
    | "insert-right"
    | "insert-top"
    | "insert-bottom";
  paneIndex?: number;
  paneCount?: number;
  dragHandleRef?: (element: Element | null) => void;
  droppableRef?: React.RefObject<HTMLDivElement | null>;
  onClose?: (() => void) | undefined;
  onMarkDone?: (() => void) | undefined;
  installedAgents?: AgentStatus[];
  onContinueInProvider?:
    | ((
        targetKind: string,
        targetConfig: ThreadConfig,
        closeOriginal: boolean,
        extractedContext: import("../../../shared/contracts").ExtractContextResult | null,
      ) => void)
    | undefined;
  onConfigChange: (config: ThreadConfig) => void;
  onLaunchConsumed?: (() => void) | undefined;
  onLaunchFailed?: ((message: string) => void) | undefined;
  onResolveServerRequest: (input: {
    requestId: ThreadServerRequestId;
    method: string;
    response: unknown;
  }) => Promise<void>;
  onSubmitInput: (prompt: string, segments?: PromptSegment[]) => Promise<void>;
};

export const ThreadView = memo(function ThreadView(props: ThreadViewProps) {
  const {
    thread,
    agentStatus,
    projectLocation,
    projectName,
    pendingLaunchPrompt,
    pendingLaunchSegments,
    isWsl,
    pendingServerRequests,
    showCloseButton,
    paneAlign = "center",
    isDragging,
    dropIndicator,
    paneIndex: _paneIndex,
    paneCount = 1,
    dragHandleRef,
    droppableRef,
    onClose,
    onMarkDone,
    installedAgents,
    onContinueInProvider,
    onConfigChange,
    onLaunchConsumed,
    onLaunchFailed,
    onResolveServerRequest,
    onSubmitInput,
  } = props;
  const terminalPaneRef = useRef<TerminalPaneHandle>(null);
  const [terminalSize, setTerminalSize] = useState<TerminalSize | null>(null);
  const [continueDialogOpen, setContinueDialogOpen] = useState(false);
  const [runtimeDebugOpen, setRuntimeDebugOpen] = useState(false);
  const launchRequestRef = useRef<string | null>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const [isTitleTooltipOpen, setIsTitleTooltipOpen] = useState(false);
  // Thread-level mode wins over the adapter-declared default. Existing rows
  // load from DB with `presentationMode: "terminal"` thanks to the schema
  // default, so behaviour is preserved for everything that already shipped.
  const usesTerminalPresentation =
    (thread.presentationMode ?? agentStatus?.capabilities.presentationMode ?? "terminal") ===
    "terminal";
  const launchTerminalSize = usesTerminalPresentation ? terminalSize : DEFAULT_HIDDEN_TERMINAL_SIZE;

  useEffect(() => {
    setRuntimeDebugOpen(false);
  }, [thread.id]);

  useEffect(() => {
    if (pendingLaunchPrompt === undefined) {
      launchRequestRef.current = null;
    }
  }, [pendingLaunchPrompt, thread.id]);

  useEffect(() => {
    if (pendingLaunchPrompt === undefined || launchTerminalSize === null) {
      return;
    }

    const launchKey = [
      thread.id,
      thread.sessionRef?.providerSessionId ?? "new",
      pendingLaunchPrompt,
      launchTerminalSize.cols,
      launchTerminalSize.rows,
    ].join(":");
    if (launchRequestRef.current === launchKey) {
      return;
    }

    launchRequestRef.current = launchKey;
    onLaunchConsumed?.();

    if (thread.config.model) {
      useSharedSettings.getState().pushRecentModel(thread.agentKind, thread.config.model);
    }

    // Optimistic user_message for the FIRST prompt in a fresh GUI thread.
    // Without this the chat sits empty for the duration of the supervisor's
    // structured-session bringup (process spawn + ACP handshake +
    // newSession), which can be a noticeable delay. The supervisor reuses
    // this id when it emits its own canonical user_message events so the
    // renderer's per-id dedupe drops the duplicate.
    const presentation = thread.presentationMode ?? "terminal";
    let optimisticUserMessageItemId: string | undefined;
    if (
      presentation === "gui" &&
      pendingLaunchPrompt.length > 0 &&
      thread.sessionRef === undefined
    ) {
      optimisticUserMessageItemId = `user-${crypto.randomUUID()}`;
      useAppStore.getState().applyRuntimeEvent(thread.id, {
        type: "item.started",
        threadId: thread.id,
        itemId: optimisticUserMessageItemId,
        itemType: "user_message",
        payload: { content: buildPromptContentBlocks(pendingLaunchPrompt, pendingLaunchSegments) },
      });
      useAppStore.getState().applyRuntimeEvent(thread.id, {
        type: "item.completed",
        threadId: thread.id,
        itemId: optimisticUserMessageItemId,
      });
    }

    void readBridge()
      .startThread({
        threadId: thread.id,
        projectLocation,
        agentKind: thread.agentKind,
        ...(thread.agentInstanceId ? { agentInstanceId: thread.agentInstanceId } : {}),
        config: thread.config,
        prompt: pendingLaunchPrompt,
        ...(pendingLaunchSegments ? { segments: pendingLaunchSegments } : {}),
        initialSize: launchTerminalSize,
        ...(thread.sessionRef ? { sessionRef: thread.sessionRef } : {}),
        ...(thread.presentationMode ? { presentationMode: thread.presentationMode } : {}),
        ...(optimisticUserMessageItemId ? { userMessageItemId: optimisticUserMessageItemId } : {}),
      })
      .catch((error) => {
        launchRequestRef.current = null;
        onLaunchFailed?.(formatLaunchError(error));
      });
  }, [
    onLaunchConsumed,
    onLaunchFailed,
    pendingLaunchPrompt,
    pendingLaunchSegments,
    projectLocation,
    launchTerminalSize,
    thread.agentKind,
    thread.agentInstanceId,
    thread.config,
    thread.id,
    thread.sessionRef,
    thread.presentationMode,
  ]);

  const alignClass =
    paneAlign === "right" ? "ml-auto" : paneAlign === "left" ? "mr-auto" : "mx-auto";
  const paddingClass = "px-2";

  return (
    <>
      <div
        ref={droppableRef}
        className={`relative flex h-full min-h-0 flex-col ${isDragging ? "opacity-50" : ""}`}
      >
        {/* Header bar — provider icon outside pane drag handle; status tooltip uses HeroUI tooltip (anchored bottom start). */}
        <div className="px-2">
          <div className={`${alignClass} flex w-full max-w-[920px] items-center gap-2 py-1`}>
            <ThreadHeaderStatusButton
              threadId={thread.id}
              fallbackThread={thread}
              fallbackAgentKind={thread.agentKind}
              agentLabel={agentStatus?.label}
            />
            <div
              ref={dragHandleRef}
              className={`flex min-w-0 flex-1 items-center gap-2 ${dragHandleRef ? "cursor-grab active:cursor-grabbing" : ""}`}
            >
              <Tooltip
                delay={500}
                isOpen={isTitleTooltipOpen}
                onOpenChange={(open) => {
                  if (open) {
                    const el = titleRef.current;
                    if (el && el.scrollWidth > el.clientWidth) {
                      setIsTitleTooltipOpen(true);
                    }
                  } else {
                    setIsTitleTooltipOpen(false);
                  }
                }}
              >
                <Tooltip.Trigger className="min-w-0 flex-1" tabIndex={-1} role="none">
                  <span
                    ref={titleRef}
                    className="block truncate text-sm font-medium leading-tight text-foreground"
                  >
                    {thread.title}
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Content placement="bottom" className="max-w-[28rem] break-words text-xs">
                  {thread.title}
                </Tooltip.Content>
              </Tooltip>
              <div className="flex shrink-0 items-center">
                {projectName ? (
                  <span className="px-1 text-sm leading-tight text-muted/60">{projectName}</span>
                ) : null}
                {isWsl ? <TuxIcon className="h-3 w-auto shrink-0 px-1 text-muted/60" /> : null}
                {onContinueInProvider &&
                installedAgents &&
                installedAgents.filter((a) => a.kind !== thread.agentKind).length > 0 &&
                thread.sessionRef ? (
                  <Tooltip delay={0}>
                    <Tooltip.Trigger>
                      <button
                        type="button"
                        aria-label="Continue in another provider"
                        className="shrink-0 rounded p-1 text-muted/60 transition-colors hover:bg-white/[0.06] hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setContinueDialogOpen(true);
                        }}
                      >
                        <ArrowRightLeft className="size-3.5" />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>Continue in another provider</Tooltip.Content>
                  </Tooltip>
                ) : null}
                {!usesTerminalPresentation ? (
                  <Tooltip delay={0}>
                    <Tooltip.Trigger>
                      <button
                        type="button"
                        aria-label={
                          runtimeDebugOpen ? "Hide runtime debug panel" : "Show runtime debug panel"
                        }
                        aria-pressed={runtimeDebugOpen}
                        className={`shrink-0 rounded p-1 transition-colors hover:bg-white/[0.06] ${runtimeDebugOpen ? "text-foreground" : "text-muted/60 hover:text-foreground"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRuntimeDebugOpen((o) => !o);
                        }}
                      >
                        <Bug className="size-3.5" />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      {runtimeDebugOpen
                        ? "Hide canonical runtime item inspector"
                        : "Inspect canonical runtime items"}
                    </Tooltip.Content>
                  </Tooltip>
                ) : null}
                {onMarkDone ? (
                  <button
                    type="button"
                    aria-label={thread.done ? "Unmark done" : "Mark done"}
                    className={`shrink-0 rounded p-1 transition-colors hover:bg-white/[0.06] ${thread.done ? "text-[oklch(0.78_0.1_180)]" : "text-muted/60 hover:text-foreground"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMarkDone();
                    }}
                  >
                    <CircleCheck className="size-3.5" />
                  </button>
                ) : null}
                {showCloseButton ? (
                  <button
                    type="button"
                    aria-label="Close pane"
                    className="shrink-0 rounded p-1 text-muted/60 transition-colors hover:bg-white/[0.06] hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose?.();
                    }}
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div
          className={`${alignClass} relative flex h-full min-h-0 w-full max-w-[1040px] flex-col ${paddingClass} px-3 pb-2`}
        >
          {dropIndicator === "replace" && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-20 rounded-2xl bg-accent/10 ring-1 ring-inset ring-accent/30"
            />
          )}
          {dropIndicator === "insert-left" && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 bottom-0 left-0 z-20 w-0.5 rounded-full bg-accent"
            />
          )}
          {dropIndicator === "insert-right" && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 right-0 bottom-0 z-20 w-0.5 rounded-full bg-accent"
            />
          )}
          {dropIndicator === "insert-top" && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 right-0 left-0 z-20 h-0.5 rounded-full bg-accent"
            />
          )}
          {dropIndicator === "insert-bottom" && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute right-0 bottom-0 left-0 z-20 h-0.5 rounded-full bg-accent"
            />
          )}

          <div className={`${alignClass} flex min-h-0 w-full max-w-[920px] flex-1 flex-col pt-2`}>
            {usesTerminalPresentation ? (
              <TerminalThreadContent
                threadId={thread.id}
                fallbackThread={thread}
                agentStatus={agentStatus}
                projectLocation={projectLocation}
                paneCount={paneCount}
                pendingServerRequests={pendingServerRequests}
                terminalPaneRef={terminalPaneRef}
                onTerminalResize={setTerminalSize}
                onConfigChange={onConfigChange}
                onResolveServerRequest={onResolveServerRequest}
                onSubmitInput={onSubmitInput}
              />
            ) : (
              <GuiThreadContent
                threadId={thread.id}
                fallbackThread={thread}
                agentStatus={agentStatus}
                projectLocation={projectLocation}
                paneCount={paneCount}
                pendingServerRequests={pendingServerRequests}
                terminalPaneRef={terminalPaneRef}
                runtimeDebugOpen={runtimeDebugOpen}
                onConfigChange={onConfigChange}
                onResolveServerRequest={onResolveServerRequest}
                onSubmitInput={onSubmitInput}
              />
            )}
          </div>
        </div>
      </div>
      {onContinueInProvider && installedAgents && continueDialogOpen ? (
        <ContinueInProviderDialog
          isOpen
          thread={thread}
          projectLocation={projectLocation}
          installedAgents={installedAgents}
          {...(() => {
            const cfg = useAppStore
              .getState()
              .projects.find((p) => p.id === thread.projectId)?.lastDraftConfig;
            return cfg ? { lastDraftConfig: cfg } : {};
          })()}
          onClose={() => setContinueDialogOpen(false)}
          onContinue={(targetKind, targetConfig, closeOrig, ctx) => {
            setContinueDialogOpen(false);
            onContinueInProvider(targetKind, targetConfig, closeOrig, ctx);
          }}
        />
      ) : null}
    </>
  );
}, areThreadViewPropsEqual);
