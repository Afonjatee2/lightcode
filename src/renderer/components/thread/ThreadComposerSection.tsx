import { useEffect, useRef, useState, type RefObject } from "react";
import { Tooltip } from "@heroui/react";
import { ChevronDown, GitFork, Paperclip, Zap } from "lucide-react";
import type {
  AgentStatus,
  ProjectLocation,
  PromptSegment,
  Thread,
  ThreadConfig,
  ThreadServerRequestId,
} from "@/shared/contracts";
import { ProviderModelMenuProvider, BranchSelector, type BranchSelection, Button } from "../common";
import { migrateCursorBaseId, parseCursorModelId } from "@/shared/cursorModelId";
import { AttachmentBar, ImageLightbox, MentionInput, useAttachments } from "../composer";
import type { MentionInputHandle } from "../composer";
import { flattenSegments } from "../composer/serializeMentions";
import { getComposerControls } from "../providers";
import { EffortIcon } from "../providers/EffortIcon";
import { readBridge } from "@/renderer/bridge";
import { useAppStore, type PendingThreadServerRequest } from "@/renderer/state/appStore";
import { useGitStore } from "@/renderer/state/gitStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useThread } from "@/renderer/state/useThread";
import { ActiveSubAgentTile } from "./ChatPane/parts/items/ActiveSubAgentTile";
import { selectActiveSubAgentParentItemIds } from "./ChatPane/chatPaneSelectors";
import { ThreadCommandPanel } from "./ThreadCommandPanel";
import { ThreadComposer, type ComposerControl } from "./ThreadComposer";
import { ThreadErrorDock } from "./ThreadErrorDock";
import { ThreadPendingSteerStrip } from "./ThreadPendingSteerStrip";
import { ThreadRuntimeRequestPanel } from "./ThreadRuntimeRequestPanel";
import { ThreadServerRequestPanel } from "./ThreadServerRequestPanel";
import { ThreadTodoDock } from "./ThreadTodoDock";
import { capabilitiesForPresentation, filterHiddenModels } from "./threadComposerOptions";
import {
  filterSlashCommands,
  resolveAvailableSlashCommands,
  resolveLocalSlashCommandAction,
} from "./threadSlashCommands";
import type { ThreadErrorDockState } from "./threadErrorState";
import type { ThreadTodoDockState } from "./threadTodoState";
import type { TerminalPaneHandle } from "./TerminalPane";

function normalizeCursorComposerConfig(
  agentKind: string,
  config: ThreadConfig,
  capabilities: AgentStatus["capabilities"],
): ThreadConfig {
  if (agentKind !== "cursor" || capabilities.models.some((model) => model.id === config.model)) {
    return config;
  }

  const parsed = parseCursorModelId(config.model);
  const baseModel = migrateCursorBaseId(parsed.baseId);
  if (!capabilities.models.some((model) => model.id === baseModel)) {
    const fallback = capabilities.models[0]?.id;
    return fallback
      ? {
          ...config,
          model: fallback,
          effort: undefined,
          contextSize: undefined,
          fast: false,
          thinking: false,
        }
      : config;
  }

  return {
    ...config,
    model: baseModel,
    ...(parsed.effort && !config.effort ? { effort: parsed.effort } : {}),
    fast: config.fast ?? parsed.fast,
    thinking: config.thinking ?? parsed.thinking,
  };
}

function formatEffortLabel(id: string): string {
  if (id === "xhigh") return "Extra High";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function buildControls(
  thread: Thread,
  agentStatus: AgentStatus | undefined,
  hiddenModelIds: readonly string[] | undefined,
  onConfigChange: (config: ThreadConfig) => void,
): ComposerControl[] {
  const presentationMode =
    thread.presentationMode ?? agentStatus?.capabilities.presentationMode ?? "terminal";
  const isCliThread = presentationMode === "terminal";
  if (isCliThread) return [];
  if (!agentStatus) return [];

  const presentationCapabilities = capabilitiesForPresentation(
    agentStatus.capabilities,
    presentationMode,
  );
  const filteredCaps = filterHiddenModels(presentationCapabilities, hiddenModelIds);
  const effectiveConfig = normalizeCursorComposerConfig(
    thread.agentKind,
    thread.config,
    filteredCaps,
  );
  const isDisabled = !thread.canResumeWithConfig;
  const onPatch = (patch: Partial<ThreadConfig>) =>
    onConfigChange({ ...thread.config, ...effectiveConfig, ...patch });
  const provider: ProviderModelMenuProvider = {
    kind: thread.agentKind,
    label: agentStatus.label,
    capabilities: filteredCaps,
  };

  const efforts = (
    filteredCaps.modelEfforts?.[effectiveConfig.model] ??
    filteredCaps.efforts ??
    []
  ).map((id) => ({
    id,
    label: formatEffortLabel(id),
  }));
  const modelContext = filteredCaps.modelContextSizes?.[effectiveConfig.model];
  const contextSizes =
    (modelContext
      ? filteredCaps.contextSizes?.filter((c) => modelContext.includes(c.id))
      : undefined) ?? [];
  const supportsFast = filteredCaps.fastModels?.includes(effectiveConfig.model) ?? false;
  const supportsThinking = filteredCaps.thinkingModels?.includes(effectiveConfig.model) ?? false;

  const controls: ComposerControl[] = [
    {
      kind: "provider-model",
      providers: [provider],
      currentAgentKind: thread.agentKind,
      currentModel: effectiveConfig.model,
      lockedAgentKind: thread.agentKind,
      isDisabled,
      hideLabelOnWrap: true,
      tier: 5,
      onChange: ({ model }) => {
        const nextEfforts = filteredCaps.modelEfforts?.[model] ?? filteredCaps.efforts ?? [];
        const effortValid = effectiveConfig.effort
          ? nextEfforts.includes(effectiveConfig.effort)
          : true;
        const nextContextIds = filteredCaps.modelContextSizes?.[model];
        const contextValid =
          !effectiveConfig.contextSize ||
          (nextContextIds ? nextContextIds.includes(effectiveConfig.contextSize) : false);
        const nextContextDefault = nextContextIds?.[0] ?? filteredCaps.defaultContextSize;
        onPatch({
          model,
          ...(!effortValid && nextEfforts.length > 0 ? { effort: nextEfforts[0] } : {}),
          ...(!contextValid && nextContextDefault ? { contextSize: nextContextDefault } : {}),
          ...(filteredCaps.fastModels?.includes(model) ? {} : { fast: false }),
          ...(filteredCaps.thinkingModels?.includes(model) ? {} : { thinking: false }),
        });
      },
    },
  ];

  if (efforts.length > 0 || contextSizes.length > 0 || supportsThinking) {
    controls.push({
      kind: "effort-context",
      efforts,
      ...(effectiveConfig.effort ? { effortValue: effectiveConfig.effort } : {}),
      onEffortChange: (value) => onPatch({ effort: value }),
      contextSizes,
      ...(effectiveConfig.contextSize ? { contextValue: effectiveConfig.contextSize } : {}),
      onContextChange: (value) => onPatch({ contextSize: value }),
      thinkingSupported: supportsThinking,
      thinkingValue: effectiveConfig.thinking === true,
      onThinkingChange: (value) => onPatch({ thinking: value }),
      isDisabled,
      hideLabelOnWrap: true,
      tier: 4,
      icon:
        efforts.length > 0 ? (
          <EffortIcon
            className="size-4 text-foreground"
            effort={effectiveConfig.effort ?? ""}
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
      iconOnly: true,
      fillIconOnSelect: true,
      isSelected: effectiveConfig.fast === true,
      isDisabled,
      tier: 3,
      onChange: (selected) => onPatch({ fast: selected }),
    });
  }

  const factory = getComposerControls(thread.agentKind);
  if (factory) {
    const providerControls = factory({
      capabilities: filteredCaps,
      config: thread.config,
      isDisabled,
      onConfigChange: onPatch,
      presentationMode,
    });

    controls.push(
      ...providerControls.map((c) => {
        // Assign tiers to provider-specific controls
        let tier = c.tier;
        if (tier === undefined) {
          if (c.kind === "toggle" && (c.label === "Plan" || c.label === "Work")) {
            tier = 2;
          } else if (
            (c.kind === undefined || c.kind === "toggle" || c.kind === "menu") &&
            c.iconKind === "permission"
          ) {
            tier = 1;
          }
        }
        return { ...c, tier };
      }),
    );
  }

  return controls;
}

type ThreadComposerSectionProps = {
  threadId: string;
  fallbackThread: Thread;
  agentStatus: AgentStatus | undefined;
  projectLocation: ProjectLocation;
  paneCount: number;
  pendingServerRequests: PendingThreadServerRequest[];
  terminalPaneRef: RefObject<TerminalPaneHandle | null>;
  todoDockCollapsed: boolean;
  todoDockPlacement: "composer" | "right";
  todoDockState: ThreadTodoDockState | null;
  errorDockState: ThreadErrorDockState | null;
  onDismissError: () => void;
  onConfigChange: (config: ThreadConfig) => void;
  onResolveServerRequest: (input: {
    requestId: ThreadServerRequestId;
    method: string;
    response: unknown;
  }) => Promise<void>;
  onSubmitInput: (prompt: string, segments?: PromptSegment[]) => Promise<void>;
  onTodoDockCollapsedChange: (collapsed: boolean) => void;
  onTodoDockPlacementChange: (placement: "composer" | "right") => void;
  onTodoDockRetire?: () => void;
};

export function ThreadComposerSection(props: ThreadComposerSectionProps) {
  const thread = useThread(props.threadId) ?? props.fallbackThread;
  return <ThreadComposerSectionInner {...props} thread={thread} />;
}

function ThreadComposerSectionInner(props: ThreadComposerSectionProps & { thread: Thread }) {
  const {
    thread,
    agentStatus,
    projectLocation,
    paneCount,
    pendingServerRequests,
    todoDockCollapsed,
    todoDockPlacement,
    todoDockState,
    errorDockState,
  } = props;
  const [prompt, setPrompt] = useState("");
  const [hasContent, setHasContent] = useState(false);
  const mentionRef = useRef<MentionInputHandle>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInterrupting, setIsInterrupting] = useState(false);
  const attachments = useAttachments();
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [controlOpenRequest, setControlOpenRequest] = useState<{
    target: "model" | "effort";
    nonce: number;
  } | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const imageAttachments = attachments.attachments.filter((a) => a.isImage);
  const presentationMode =
    thread.presentationMode ?? agentStatus?.capabilities.presentationMode ?? "terminal";
  const usesTerminalPresentation = presentationMode === "terminal";
  const availableCommands = resolveAvailableSlashCommands(
    thread.slashCommands,
    agentStatus?.capabilities.slashCommands,
    {
      agentKind: thread.agentKind,
      presentationMode,
      hasEffort:
        ((
          agentStatus?.capabilities.modelEfforts?.[thread.config.model] ??
          agentStatus?.capabilities.efforts ??
          []
        ).length ?? 0) > 0,
      supportsFast: agentStatus?.capabilities.fastModels?.includes(thread.config.model) ?? false,
    },
  );
  const filteredCommands = filterSlashCommands(availableCommands, slashQuery);
  const showCommandPanel = filteredCommands.length > 0;
  const isServerControlled =
    agentStatus?.capabilities.liveInputMode === "server" || !usesTerminalPresentation;
  const isTerminalInput = agentStatus?.capabilities.liveInputMode === "terminal";
  const needsFocusBeforeInput = agentStatus?.capabilities.requiresTerminalFocusBeforeInput === true;
  const activeServerRequest = pendingServerRequests[0];
  const canQueueServerInput =
    isServerControlled &&
    !usesTerminalPresentation &&
    thread.sessionRef !== undefined &&
    thread.status === "working";
  const canSubmitServerInput =
    isServerControlled &&
    thread.sessionRef !== undefined &&
    (thread.status === "idle" ||
      thread.status === "needs_reply" ||
      thread.status === "error" ||
      canQueueServerInput);
  const canSubmitTerminalInput =
    usesTerminalPresentation &&
    isTerminalInput &&
    thread.status !== "inactive" &&
    thread.status !== "launching";
  const showServerComposer = isServerControlled && thread.status !== "inactive";
  const showTerminalComposer =
    usesTerminalPresentation &&
    isTerminalInput &&
    thread.status !== "inactive" &&
    thread.status !== "launching";
  const showTodoInComposer =
    !usesTerminalPresentation && todoDockState !== null && todoDockPlacement === "composer";
  const showErrorInComposer = !usesTerminalPresentation && errorDockState !== null;
  const hasActiveSubAgent = useAppStore(
    (s) => !usesTerminalPresentation && selectActiveSubAgentParentItemIds(s, thread.id).length > 0,
  );
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
  const controlsWithOpenSignal = controls.map((control): ComposerControl => {
    if (controlOpenRequest?.target === "model" && control.kind === "provider-model") {
      return { ...control, openSignal: controlOpenRequest.nonce };
    }
    if (controlOpenRequest?.target === "effort" && control.kind === "effort-context") {
      return { ...control, openSignal: controlOpenRequest.nonce };
    }
    return control;
  });
  const isCliThread = usesTerminalPresentation;
  const canSubmit = (canSubmitServerInput || canSubmitTerminalInput) && !isSubmitting;
  const canInterruptStructuredTurn =
    !usesTerminalPresentation && thread.sessionRef !== undefined && thread.status === "working";
  const pendingSteer = useAppStore((s) => s.pendingSteerByThreadId[thread.id]);
  const usesPendingSteerPath = !usesTerminalPresentation && thread.status === "working";
  const runtimeRequests = useAppStore((s) => s.runtimeRequestsByThread[thread.id]);
  const activeRuntimeRequest = !usesTerminalPresentation ? runtimeRequests?.[0] : undefined;

  function handleInterrupt() {
    if (isInterrupting) return;
    setIsInterrupting(true);
    void readBridge()
      .interruptThread({ threadId: thread.id })
      .catch((error: unknown) => {
        setIsInterrupting(false);
        console.error("[thread] failed to interrupt turn", error);
      });
  }

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
    const localAction = resolveLocalSlashCommandAction(flat, {
      agentKind: thread.agentKind,
      presentationMode,
    });
    if (localAction?.kind === "set-mode") {
      props.onConfigChange({ ...thread.config, mode: localAction.mode });
      mentionRef.current?.clear();
      mentionRef.current?.focus();
      setPrompt("");
      setHasContent(false);
      return;
    }
    if (localAction?.kind === "open-control") {
      setControlOpenRequest((prev) => ({
        target: localAction.target,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
      mentionRef.current?.clear();
      setPrompt("");
      setHasContent(false);
      return;
    }
    if (localAction?.kind === "toggle-fast") {
      if (agentStatus?.capabilities.fastModels?.includes(thread.config.model)) {
        props.onConfigChange({ ...thread.config, fast: thread.config.fast !== true });
      }
      mentionRef.current?.clear();
      mentionRef.current?.focus();
      setPrompt("");
      setHasContent(false);
      return;
    }
    setIsSubmitting(true);
    if (!usesTerminalPresentation) {
      useAppStore.getState().requestChatScrollToBottom(thread.id);
    }

    const focusPromise = needsFocusBeforeInput
      ? (props.terminalPaneRef.current?.focus(), new Promise<void>((r) => setTimeout(r, 80)))
      : Promise.resolve();

    // GUI threads + working status → stage as pending steer (replace-latest).
    // The supervisor fires the cancel and drains the slot when the in-flight
    // turn returns with `cancelled` stopReason. No optimistic chat paint —
    // the strip above the composer is the visual confirmation; the real
    // user_message item lands when the turn drains and starts.
    const runSubmission = () =>
      usesPendingSteerPath
        ? readBridge().setPendingSteer({
            threadId: thread.id,
            prompt: flat,
            ...(allSegments.length > 0 ? { segments: allSegments } : {}),
            config: thread.config,
          })
        : props.onSubmitInput(flat, allSegments.length > 0 ? allSegments : undefined);

    void focusPromise
      .then(runSubmission)
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

  function handleCancelPendingSteer() {
    void readBridge()
      .clearPendingSteer({ threadId: thread.id })
      .catch((error: unknown) => {
        console.error("[thread] failed to clear pending steer", error);
      });
  }

  useEffect(() => {
    setSlashActiveIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    if (filteredCommands.length === 0) {
      if (slashActiveIndex !== 0) {
        setSlashActiveIndex(0);
      }
      return;
    }
    if (slashActiveIndex >= filteredCommands.length) {
      setSlashActiveIndex(filteredCommands.length - 1);
    }
  }, [filteredCommands.length, slashActiveIndex]);

  useEffect(() => {
    setPrompt("");
    setIsInterrupting(false);
    setSlashQuery(null);
    setSlashActiveIndex(0);
    setComposerCollapsed(collapseTerminalComposerSetting);
  }, [thread.id, collapseTerminalComposerSetting]);

  useEffect(() => {
    if (thread.status !== "working") setIsInterrupting(false);
  }, [thread.status]);

  useEffect(() => {
    if (isComposerCollapsed) {
      setSlashQuery(null);
    }
  }, [isComposerCollapsed]);

  useEffect(() => {
    function handlePasteToComposer(e: Event) {
      const text = (e as CustomEvent<string>).detail;
      if (text) setPrompt((prev) => prev + text);
    }
    window.addEventListener("lightcode:paste-to-composer", handlePasteToComposer);
    return () => window.removeEventListener("lightcode:paste-to-composer", handlePasteToComposer);
  }, []);

  const pendingComposerFocusThreadId = useAppStore((s) => s.pendingComposerFocusThreadId);
  useEffect(() => {
    if (pendingComposerFocusThreadId !== thread.id) return;
    const raf = requestAnimationFrame(() => {
      mentionRef.current?.focus();
      useAppStore.getState().clearComposerFocusRequest(thread.id);
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingComposerFocusThreadId, thread.id]);

  return (
    <>
      {activeServerRequest ? (
        <ThreadServerRequestPanel
          agentLabel={agentStatus?.label}
          request={activeServerRequest}
          onResolve={props.onResolveServerRequest}
          onPlanApproved={() => props.onConfigChange({ ...thread.config, mode: "agent" })}
        />
      ) : null}

      {thread.status !== "launching" || !usesTerminalPresentation ? (
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
                  fixedContent={
                    hasActiveSubAgent ||
                    showErrorInComposer ||
                    showTodoInComposer ||
                    pendingSteer ||
                    activeRuntimeRequest ||
                    showCommandPanel ? (
                      <>
                        {hasActiveSubAgent ? <ActiveSubAgentTile threadId={thread.id} /> : null}
                        {showErrorInComposer ? (
                          <ThreadErrorDock
                            state={errorDockState!}
                            onDismiss={props.onDismissError}
                          />
                        ) : null}
                        {showTodoInComposer ? (
                          <ThreadTodoDock
                            collapsed={todoDockCollapsed}
                            placement={todoDockPlacement}
                            state={todoDockState!}
                            onCollapsedChange={props.onTodoDockCollapsedChange}
                            onPlacementChange={props.onTodoDockPlacementChange}
                            onRetire={() => props.onTodoDockRetire?.()}
                          />
                        ) : null}
                        {pendingSteer ? (
                          <ThreadPendingSteerStrip
                            pending={pendingSteer}
                            onCancel={handleCancelPendingSteer}
                          />
                        ) : null}
                        {activeRuntimeRequest ? (
                          <ThreadRuntimeRequestPanel
                            threadId={thread.id}
                            request={activeRuntimeRequest}
                            onResolve={props.onResolveServerRequest}
                            onPlanApproved={() =>
                              props.onConfigChange({ ...thread.config, mode: "agent" })
                            }
                          />
                        ) : null}
                        {showCommandPanel ? (
                          <ThreadCommandPanel
                            commands={filteredCommands}
                            activeIndex={slashActiveIndex}
                            onActiveIndexChange={setSlashActiveIndex}
                            onSelect={(cmd) => {
                              mentionRef.current?.insertSlashCommand(cmd.id);
                              setSlashQuery(null);
                            }}
                          />
                        ) : null}
                      </>
                    ) : null
                  }
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
                      onInterceptKey={(e) => {
                        if (showCommandPanel) {
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setSlashActiveIndex((prev) => (prev + 1) % filteredCommands.length);
                            return true;
                          }
                          if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setSlashActiveIndex(
                              (prev) =>
                                (prev - 1 + filteredCommands.length) % filteredCommands.length,
                            );
                            return true;
                          }
                          if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
                            const selected = filteredCommands[slashActiveIndex];
                            if (selected) {
                              e.preventDefault();
                              mentionRef.current?.insertSlashCommand(selected.id);
                              setSlashQuery(null);
                              return true;
                            }
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setSlashQuery(null);
                            return true;
                          }
                        }

                        if (showTerminalComposer) {
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
                        }
                        return false;
                      }}
                      onSlashCommandChange={setSlashQuery}
                    />
                  }
                  controls={controlsWithOpenSignal}
                  placeholder="Send a message..."
                  prompt={prompt}
                  promptDisabled={!(showServerComposer || showTerminalComposer)}
                  stopPending={isInterrupting}
                  submitDisabled={!(hasContent || attachments.attachments.length > 0) || !canSubmit}
                  submitLabel="Send message"
                  onStop={canInterruptStructuredTurn ? handleInterrupt : undefined}
                  {...(() => {
                    const renderExtras = (level: number) => (
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
                                  {level < 3 && <span className="truncate">{branchName}</span>}
                                  {level < 3 && thread.prNumber ? (
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
                              forceHideLabel={level >= 3}
                              iconOnly={level >= 3}
                            />
                          )
                        ) : null}
                      </>
                    );
                    return isCliThread
                      ? { leadingControls: renderExtras }
                      : { afterControls: renderExtras };
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
