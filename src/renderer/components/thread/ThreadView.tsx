import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@heroui/react";
import { ArrowRightLeft, ChevronDown, CircleCheck, GitFork, Paperclip, X, Zap } from "lucide-react";
import type {
  AgentStatus,
  ProjectLocation,
  PromptSegment,
  TerminalSize,
  Thread,
  ThreadConfig,
  ThreadServerRequestId,
  ThreadStatusSource,
} from "@/shared/contracts";

import { ProviderIcon, getComposerControls, getStatusTone } from "@/renderer/components/providers";
import { EffortIcon } from "@/renderer/components/providers/EffortIcon";
import { useAppStore, type PendingThreadServerRequest } from "@/renderer/state/appStore";
import { useGitStore } from "@/renderer/state/gitStore";
import {
  BranchSelector,
  type BranchSelection,
  Button,
  PixelLoader,
  type ProviderModelMenuProvider,
  TuxIcon,
} from "@/renderer/components/common";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { readBridge } from "@/renderer/bridge";
import {
  MentionInput,
  type MentionInputHandle,
  AttachmentBar,
  ImageLightbox,
  useAttachments,
} from "@/renderer/components/composer";
import { flattenSegments } from "@/renderer/components/composer/serializeMentions";
import { filterHiddenModels } from "./threadComposerOptions";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
import { ThreadComposer, type ComposerControl } from "./ThreadComposer";
import { ContinueInProviderDialog } from "./ContinueInProviderDialog";
import { ThreadServerRequestPanel } from "./ThreadServerRequestPanel";

const DEFAULT_HIDDEN_TERMINAL_SIZE: TerminalSize = { cols: 120, rows: 30 };

function threadRuntimeStatusLabel(thread: Thread): string {
  const { status, attention } = thread;
  if (status === "launching") return "Launching…";
  if (status === "inactive") return "Inactive";
  if (status === "error") return "Error";
  if (status === "finished") return "Finished";
  if (status === "needs_approval" || attention === "needs_approval") return "Needs approval";
  if (status === "needs_reply" || attention === "needs_reply") return "Needs reply";
  if (status === "working" || attention === "working") return "Working";
  if (status === "idle") return "Idle";
  return status;
}

/** Third line of the header status tooltip — detail only, no duplicate labels. */
function activeSupportLabel(source: ThreadStatusSource | undefined): string {
  switch (source) {
    case "cli_hook":
      return "Enhanced (Hooks)";
    case "terminal_parse":
      return "Basic (CLI)";
    case "server":
      return "ACP";
    default:
      return "Basic (CLI)";
  }
}

function threadStatusSupportDetail(source: ThreadStatusSource | undefined): string {
  switch (source) {
    case "cli_hook":
      return "Status updates come from the CLI hook plugin.";
    case "terminal_parse":
      return "Status is inferred from terminal output (L2). Install the hook plugin in settings for structured updates.";
    case "server":
      return "This thread uses the agent server protocol (ACP-style); terminal hooks do not apply.";
    default:
      return "Support mode appears once the session connects.";
  }
}

/** Dot next to Support — encodes how status is sourced, not runtime state (so Basic ≠ “idle green”). */
function supportSourceDotClass(source: ThreadStatusSource | undefined): string {
  switch (source) {
    case "cli_hook":
      return "bg-[oklch(0.72_0.12_145)]";
    case "terminal_parse":
      return "bg-[oklch(0.72_0.11_75)]";
    case "server":
      return "bg-[oklch(0.68_0.12_265)]";
    default:
      return "bg-muted/70";
  }
}

function ThreadHeaderStatusTooltipBody(props: { thread: Thread }) {
  const { thread } = props;
  const runtime = threadRuntimeStatusLabel(thread);
  const source = thread.threadStatusSource;

  return (
    <div className="w-[min(22rem,calc(100vw-2rem))] space-y-3 py-3 pl-2 pr-5 [overflow-wrap:break-word] [word-break:normal] hyphens-none">
      <div className="space-y-2.5">
        <p className="text-sm leading-snug">
          <span className="text-muted">Status: </span>
          <span className="font-semibold text-foreground">{runtime}</span>
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-relaxed">
          <span className="text-muted">Support:</span>
          <span
            className={`relative top-px size-1.5 shrink-0 rounded-full ring-1 ring-white/10 ${supportSourceDotClass(source)}`}
            aria-hidden
          />
          <span className="font-semibold text-foreground">{activeSupportLabel(source)}</span>
        </p>
      </div>
      <p className="border-t border-border/60 pt-2.5 text-xs leading-snug text-muted [overflow-wrap:break-word] [word-break:normal] hyphens-none">
        {threadStatusSupportDetail(source)}
      </p>
    </div>
  );
}

function buildControls(
  thread: Thread,
  agentStatus: AgentStatus | undefined,
  hiddenModelIds: readonly string[] | undefined,
  onConfigChange: (config: ThreadConfig) => void,
): ComposerControl[] {
  const isCliThread = (agentStatus?.capabilities.presentationMode ?? "terminal") === "terminal";
  if (isCliThread) return [];
  if (!agentStatus) return [];

  const filteredCaps = filterHiddenModels(agentStatus.capabilities, hiddenModelIds);
  const isDisabled = !thread.canResumeWithConfig;
  const onPatch = (patch: Partial<ThreadConfig>) => onConfigChange({ ...thread.config, ...patch });
  const provider: ProviderModelMenuProvider = {
    kind: thread.agentKind,
    label: agentStatus.label,
    capabilities: filteredCaps,
  };

  const efforts = (
    filteredCaps.modelEfforts?.[thread.config.model] ??
    filteredCaps.efforts ??
    []
  ).map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
  }));
  const modelContext = filteredCaps.modelContextSizes?.[thread.config.model];
  const contextSizes =
    (modelContext
      ? filteredCaps.contextSizes?.filter((c) => modelContext.includes(c.id))
      : undefined) ?? [];
  const supportsFast = filteredCaps.fastModels?.includes(thread.config.model) ?? false;

  const controls: ComposerControl[] = [
    {
      kind: "provider-model",
      providers: [provider],
      currentAgentKind: thread.agentKind,
      currentModel: thread.config.model,
      lockedAgentKind: thread.agentKind,
      isDisabled,
      hideLabelOnWrap: true,
      onChange: ({ model }) => {
        const nextEfforts = filteredCaps.modelEfforts?.[model] ?? filteredCaps.efforts ?? [];
        const effortValid = thread.config.effort
          ? nextEfforts.includes(thread.config.effort)
          : true;
        const nextContextIds = filteredCaps.modelContextSizes?.[model];
        const contextValid =
          !thread.config.contextSize ||
          (nextContextIds ? nextContextIds.includes(thread.config.contextSize) : false);
        // First entry in the per-model context list is the model's default; fall
        // back to the global default only when the model is unmapped.
        const nextContextDefault = nextContextIds?.[0] ?? filteredCaps.defaultContextSize;
        onPatch({
          model,
          ...(!effortValid && nextEfforts.length > 0 ? { effort: nextEfforts[0] } : {}),
          ...(!contextValid && nextContextDefault ? { contextSize: nextContextDefault } : {}),
          ...(filteredCaps.fastModels?.includes(model) ? {} : { fast: false }),
        });
      },
    },
  ];

  if (efforts.length > 0 || contextSizes.length > 0) {
    controls.push({
      kind: "effort-context",
      efforts,
      ...(thread.config.effort ? { effortValue: thread.config.effort } : {}),
      onEffortChange: (value) => onPatch({ effort: value }),
      contextSizes,
      ...(thread.config.contextSize ? { contextValue: thread.config.contextSize } : {}),
      onContextChange: (value) => onPatch({ contextSize: value }),
      isDisabled,
      hideLabelOnWrap: true,
      icon:
        efforts.length > 0 ? (
          <EffortIcon
            className="size-4 text-foreground"
            effort={thread.config.effort ?? ""}
            efforts={efforts.map((e) => e.id)}
          />
        ) : undefined,
    });
  }

  if (supportsFast) {
    controls.push({
      kind: "toggle",
      label: "Fast",
      icon: <Zap className="size-3.5" />,
      hideLabelOnWrap: true,
      isSelected: thread.config.fast === true,
      isDisabled,
      onChange: (selected) => onPatch({ fast: selected }),
    });
  }

  const factory = getComposerControls(thread.agentKind);
  if (factory) {
    controls.push(
      ...factory({
        capabilities: filteredCaps,
        config: thread.config,
        isDisabled,
        onConfigChange: onPatch,
      }),
    );
  }

  return controls;
}

function ThreadComposerSection(props: {
  thread: Thread;
  agentStatus: AgentStatus | undefined;
  projectLocation: ProjectLocation;
  paneCount: number;
  pendingServerRequests: PendingThreadServerRequest[];
  terminalPaneRef: React.RefObject<TerminalPaneHandle | null>;
  onConfigChange: (config: ThreadConfig) => void;
  onResolveServerRequest: (input: {
    requestId: ThreadServerRequestId;
    method: string;
    response: unknown;
  }) => Promise<void>;
  onSubmitInput: (prompt: string, segments?: PromptSegment[]) => Promise<void>;
}) {
  const { thread, agentStatus, projectLocation, paneCount, pendingServerRequests } = props;
  const [prompt, setPrompt] = useState("");
  const [hasContent, setHasContent] = useState(false);
  const mentionRef = useRef<MentionInputHandle>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const attachments = useAttachments();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const imageAttachments = attachments.attachments.filter((a) => a.isImage);
  const isServerControlled = agentStatus?.capabilities.liveInputMode === "server";
  const isTerminalInput = agentStatus?.capabilities.liveInputMode === "terminal";
  const usesTerminalPresentation =
    (agentStatus?.capabilities.presentationMode ?? "terminal") === "terminal";
  const needsFocusBeforeInput = agentStatus?.capabilities.requiresTerminalFocusBeforeInput === true;
  const activeServerRequest = pendingServerRequests[0];
  const canSubmitServerInput =
    isServerControlled &&
    thread.sessionRef !== undefined &&
    (thread.status === "idle" || thread.status === "needs_reply");
  const canSubmitTerminalInput =
    usesTerminalPresentation &&
    isTerminalInput &&
    thread.status !== "inactive" &&
    thread.status !== "launching";
  const showServerComposer =
    isServerControlled && thread.status !== "inactive" && thread.status !== "launching";
  const showTerminalComposer =
    usesTerminalPresentation &&
    isTerminalInput &&
    thread.status !== "inactive" &&
    thread.status !== "launching";
  const collapseTerminalComposerSetting = useSharedSettings((s) => s.collapseTerminalComposer);
  const [composerCollapsed, setComposerCollapsed] = useState(collapseTerminalComposerSetting);
  const canCollapseComposer = showTerminalComposer;
  const isComposerCollapsed = canCollapseComposer && composerCollapsed;
  const branchName = useGitStore(
    (s) =>
      thread.worktreeBranch ??
      (thread.worktreePath
        ? s.worktreeStatuses[thread.worktreePath]?.branch
        : s.statuses[thread.projectId]?.branch),
  );
  const hiddenModelIds = useSharedSettings((s) => s.hiddenModels[thread.agentKind]);
  const controls = buildControls(thread, agentStatus, hiddenModelIds, props.onConfigChange);
  const isCliThread = (agentStatus?.capabilities.presentationMode ?? "terminal") === "terminal";
  const canSubmit = (canSubmitServerInput || canSubmitTerminalInput) && !isSubmitting;

  function handleSwitchBranch(branch: string, createNew: boolean) {
    readBridge()
      .gitSwitchBranch({
        projectLocation,
        branch,
        createNew,
      })
      .then((result) => {
        const store = useGitStore.getState();
        const status = store.statuses[thread.projectId];
        if (status) {
          store.setStatus(thread.projectId, {
            ...status,
            branch: result.branch,
            tracking: result.tracking,
            ahead: result.ahead,
            behind: result.behind,
          });
        }
      })
      .catch((err: unknown) => {
        console.error("[git] switch branch failed", err);
      });
  }

  function handleBranchSelect(selection: BranchSelection) {
    if (!selection.isWorktree && selection.branch !== branchName) {
      handleSwitchBranch(selection.branch, false);
    }
  }

  function submitPrompt(segments: PromptSegment[]) {
    const attachmentSegments = attachments.toSegments();
    const allSegments = [...attachmentSegments, ...segments];
    const flat = flattenSegments(allSegments);
    if (flat.length === 0 || !canSubmit) return;
    setIsSubmitting(true);

    const focusPromise = needsFocusBeforeInput
      ? (props.terminalPaneRef.current?.focus(), new Promise<void>((r) => setTimeout(r, 80)))
      : Promise.resolve();

    void focusPromise
      .then(() => props.onSubmitInput(flat, allSegments.length > 0 ? allSegments : undefined))
      .then(() => {
        mentionRef.current?.clear();
        mentionRef.current?.focus();
        setPrompt("");
        setHasContent(false);
        attachments.clearAll();
      })
      .catch(() => {
        // Leave the prompt intact so the user can retry.
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  }

  useEffect(() => {
    setPrompt("");
    setComposerCollapsed(collapseTerminalComposerSetting);
  }, [thread.id, collapseTerminalComposerSetting]);

  useEffect(() => {
    function handlePasteToComposer(e: Event) {
      const text = (e as CustomEvent<string>).detail;
      if (text) setPrompt((prev) => prev + text);
    }
    window.addEventListener("lightcode:paste-to-composer", handlePasteToComposer);
    return () => window.removeEventListener("lightcode:paste-to-composer", handlePasteToComposer);
  }, []);

  return (
    <>
      {activeServerRequest ? (
        <ThreadServerRequestPanel
          agentLabel={agentStatus?.label}
          request={activeServerRequest}
          onResolve={props.onResolveServerRequest}
        />
      ) : null}

      {thread.status !== "launching" ? (
        <div>
          <div
            className={`grid transition-[grid-template-rows] ease-[cubic-bezier(0.16,1,0.3,1)] ${isComposerCollapsed ? "duration-300" : "duration-200"}`}
            style={{ gridTemplateRows: isComposerCollapsed ? "0fr" : "1fr" }}
          >
            <div className="overflow-hidden">
              <div
                className={`relative ${isComposerCollapsed ? "pointer-events-none" : ""}`}
                style={{
                  opacity: isComposerCollapsed ? 0 : 1,
                  transition: isComposerCollapsed
                    ? "opacity 150ms ease 50ms"
                    : "opacity 200ms ease 100ms",
                }}
              >
                <ThreadComposer
                  autoFocus={paneCount === 1} // eslint-disable-line jsx-a11y/no-autofocus -- desktop app, expected UX
                  compact
                  attachmentBar={
                    <AttachmentBar
                      attachments={attachments.attachments}
                      onRemove={attachments.removeAttachment}
                      onPreviewImage={(att) => {
                        const idx = imageAttachments.findIndex((a) => a.id === att.id);
                        if (idx >= 0) setLightboxIndex(idx);
                      }}
                    />
                  }
                  inputContent={
                    <MentionInput
                      ref={mentionRef}
                      autoFocus={paneCount === 1} // eslint-disable-line jsx-a11y/no-autofocus -- desktop app, expected UX
                      compact
                      disabled={!(showServerComposer || showTerminalComposer)}
                      placeholder={
                        isServerControlled
                          ? `Ask ${agentStatus?.label ?? "the agent"} anything about this workspace`
                          : "Send a message..."
                      }
                      projectLocation={projectLocation}
                      projectId={thread.projectId}
                      onTextChange={setHasContent}
                      onSubmit={submitPrompt}
                      onPasteImage={(file) => {
                        void attachments.addClipboardImage(file, thread.id);
                      }}
                      {...(showTerminalComposer
                        ? {
                            onInterceptKey: (e) => {
                              // Forward common terminal shortcuts (Shift+Tab,
                              // Ctrl/Cmd+T) to the PTY so users can drive the
                              // CLI agent without leaving the composer.
                              if (e.key === "Tab" && e.shiftKey && !e.ctrlKey && !e.metaKey) {
                                e.preventDefault();
                                void readBridge().writeTerminal({
                                  threadId: thread.id,
                                  data: "\x1b[Z",
                                });
                                return true;
                              }
                              if (
                                (e.ctrlKey || e.metaKey) &&
                                !e.shiftKey &&
                                !e.altKey &&
                                e.key.toLowerCase() === "t"
                              ) {
                                e.preventDefault();
                                void readBridge().writeTerminal({
                                  threadId: thread.id,
                                  data: "\x14",
                                });
                                return true;
                              }
                              return false;
                            },
                          }
                        : {})}
                    />
                  }
                  controls={controls}
                  placeholder="Send a message..."
                  prompt={prompt}
                  promptDisabled={!(showServerComposer || showTerminalComposer)}
                  submitDisabled={!(hasContent || attachments.attachments.length > 0) || !canSubmit}
                  submitLabel="Send message"
                  {...(() => {
                    const extras = (
                      <>
                        <Button
                          isIconOnly
                          aria-label="Attach files"
                          className="lightcode-composer-menu min-w-9 px-2"
                          size="sm"
                          variant="ghost"
                          onPress={() => {
                            void readBridge()
                              .pickFiles()
                              .then((paths) => {
                                if (paths) attachments.addFiles(paths);
                              });
                          }}
                        >
                          <Paperclip className="size-4" />
                        </Button>
                        {branchName ? (
                          thread.worktreePath ? (
                            <Tooltip delay={0}>
                              <Tooltip.Trigger tabIndex={-1} role="none">
                                <div className="lightcode-composer-static min-w-0 max-w-48 px-2.5">
                                  <GitFork className="size-3.5 text-muted" />
                                  <span className="truncate">{branchName}</span>
                                  {thread.prNumber ? (
                                    <span className="shrink-0 text-muted/60">
                                      PR #{thread.prNumber}
                                    </span>
                                  ) : null}
                                </div>
                              </Tooltip.Trigger>
                              <Tooltip.Content placement="top">{branchName}</Tooltip.Content>
                            </Tooltip>
                          ) : (
                            <BranchSelector
                              projectId={thread.projectId}
                              currentBranch={branchName}
                              value={branchName}
                              onSelect={handleBranchSelect}
                              onSwitchBranch={handleSwitchBranch}
                              hideWorktreeToggle
                            />
                          )
                        ) : null}
                      </>
                    );
                    return isCliThread ? { leadingControls: extras } : { afterControls: extras };
                  })()}
                  onPromptChange={setPrompt}
                  onSubmit={() => {
                    const segments = mentionRef.current?.serializeSegments();
                    submitPrompt(
                      segments && segments.length > 0
                        ? segments
                        : [{ kind: "text", content: prompt.trim() }],
                    );
                  }}
                />
              </div>
            </div>
          </div>
          {canCollapseComposer ? (
            <div className="relative z-10 flex h-0 justify-center">
              <button
                type="button"
                aria-label={isComposerCollapsed ? "Show composer" : "Collapse composer"}
                className="absolute -top-[9px] flex items-center rounded-full border border-[var(--border)] bg-[var(--background)] px-2 py-0 text-muted transition-colors hover:text-foreground"
                onClick={() => setComposerCollapsed(!composerCollapsed)}
              >
                <ChevronDown
                  className={`size-3.5 transition-transform duration-150 ${isComposerCollapsed ? "rotate-180" : ""}`}
                />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {lightboxIndex !== null && imageAttachments.length > 0 ? (
        <ImageLightbox
          images={imageAttachments}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </>
  );
}

export function ThreadView(props: {
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
  onLaunchFailed?: (() => void) | undefined;
  onResolveServerRequest: (input: {
    requestId: ThreadServerRequestId;
    method: string;
    response: unknown;
  }) => Promise<void>;
  onSubmitInput: (prompt: string, segments?: PromptSegment[]) => Promise<void>;
}) {
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
  const launchRequestRef = useRef<string | null>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const [isTitleTooltipOpen, setIsTitleTooltipOpen] = useState(false);
  const usesTerminalPresentation =
    (agentStatus?.capabilities.presentationMode ?? "terminal") === "terminal";
  const launchTerminalSize = usesTerminalPresentation ? terminalSize : DEFAULT_HIDDEN_TERMINAL_SIZE;

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

    void readBridge()
      .startThread({
        threadId: thread.id,
        projectLocation,
        agentKind: thread.agentKind,
        config: thread.config,
        prompt: pendingLaunchPrompt,
        ...(pendingLaunchSegments ? { segments: pendingLaunchSegments } : {}),
        initialSize: launchTerminalSize,
        ...(thread.sessionRef ? { sessionRef: thread.sessionRef } : {}),
      })
      .catch(() => {
        launchRequestRef.current = null;
        onLaunchFailed?.();
      });
  }, [
    onLaunchConsumed,
    onLaunchFailed,
    pendingLaunchPrompt,
    pendingLaunchSegments,
    projectLocation,
    launchTerminalSize,
    thread.agentKind,
    thread.config,
    thread.id,
    thread.sessionRef,
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
            <Tooltip delay={0}>
              <Tooltip.Trigger>
                <button
                  type="button"
                  className="inline-flex shrink-0 rounded-sm p-0.5 outline-offset-2 hover:bg-white/[0.06]"
                  aria-label={`${agentStatus?.label ?? thread.agentKind}: ${threadRuntimeStatusLabel(thread)}. Hover for status details.`}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <ProviderIcon
                    kind={thread.agentKind}
                    tone={getStatusTone(thread)}
                    className="size-3.5 shrink-0"
                  />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content
                placement="bottom start"
                offset={8}
                showArrow
                className="max-w-[min(22rem,calc(100vw-2rem))] text-left [overflow-wrap:break-word] [word-break:normal] hyphens-none"
              >
                <ThreadHeaderStatusTooltipBody thread={thread} />
              </Tooltip.Content>
            </Tooltip>
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

          <div
            className={`${alignClass} flex min-h-0 w-full max-w-[920px] flex-1 flex-col gap-2 pt-2`}
          >
            <div
              className={`relative min-h-0 flex-1 ${
                usesTerminalPresentation ? "overflow-visible" : "overflow-hidden"
              }`}
            >
              {usesTerminalPresentation ? (
                <TerminalPane
                  ref={terminalPaneRef}
                  key={thread.id}
                  onTerminalResize={setTerminalSize}
                  status={thread.status}
                  threadId={thread.id}
                />
              ) : null}
              {thread.status === "launching" ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <PixelLoader size="md" />
                </div>
              ) : null}
            </div>

            <ThreadComposerSection
              thread={thread}
              agentStatus={agentStatus}
              projectLocation={projectLocation}
              paneCount={paneCount}
              pendingServerRequests={pendingServerRequests}
              terminalPaneRef={terminalPaneRef}
              onConfigChange={onConfigChange}
              onResolveServerRequest={onResolveServerRequest}
              onSubmitInput={onSubmitInput}
            />
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
}
