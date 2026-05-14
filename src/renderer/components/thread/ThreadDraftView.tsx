import { useEffect, useMemo, useRef, useState } from "react";
import { TerminalSquare, X, Zap } from "lucide-react";
import { toast } from "@heroui/react";
import type {
  AgentStatus,
  Project,
  ProjectDraftConfig,
  ProviderDraftConfig,
  ThreadConfig,
  ThreadPresentationMode,
} from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { macosTrafficLightPadClass } from "@/renderer/components/layout/sidebarChrome";
import { getComposerControls } from "@/renderer/components/providers";
import { getConfigNormalizer } from "@/renderer/components/providers/ProviderIcon";
import { EffortIcon } from "@/renderer/components/providers/EffortIcon";
import { useGitStore } from "@/renderer/state/gitStore";
import { migrateCursorBaseId, parseCursorModelId } from "@/shared/cursorModelId";
import { PixelLoader } from "@/renderer/components/common";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useAppStore } from "@/renderer/state/appStore";
import { capabilitiesForPresentation, filterHiddenModels } from "./threadComposerOptions";
import { friendlyError } from "@/shared/messages";
import { PresentationModeTabs } from "./PresentationModeTabs";
import { ThreadDraftComposerArea, type DraftStartInput } from "./ThreadDraftComposerArea";
import type { ComposerControl } from "./ThreadComposer";
import { AgentDiscoveryScreen } from "./AgentDiscoveryScreen";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";

function resolvePreferredAgentKind(
  installedAgents: AgentStatus[],
  lastDraftConfig?: ProjectDraftConfig,
): AgentStatus["kind"] | undefined {
  if (lastDraftConfig) {
    const savedAgent = installedAgents.find((agent) => agent.kind === lastDraftConfig.agentKind);
    if (savedAgent) {
      return savedAgent.kind;
    }
  }

  return installedAgents[0]?.kind;
}

function resolveSavedProviderDraftConfig(
  agentKind: AgentStatus["kind"],
  lastDraftConfig: ProjectDraftConfig | undefined,
  providerConfigs: Record<string, ProviderDraftConfig>,
): Partial<ProviderDraftConfig> | undefined {
  if (lastDraftConfig?.agentKind === agentKind && lastDraftConfig.model.trim()) {
    return lastDraftConfig;
  }

  return providerConfigs[agentKind];
}

function resolveModelValue(agent: AgentStatus, preferred?: string): string {
  const models = agent.capabilities.models;
  return preferred && models.some((m) => m.id === preferred) ? preferred : (models[0]?.id ?? "");
}

function resolveEffortValue(agent: AgentStatus, model: string, preferred?: string): string {
  const efforts = agent.capabilities.modelEfforts?.[model] ?? agent.capabilities.efforts ?? [];
  if (preferred && efforts.includes(preferred)) {
    return preferred;
  }

  const fallback = agent.capabilities.defaultEffort;
  if (fallback && efforts.includes(fallback)) {
    return fallback;
  }

  return efforts[0] ?? "";
}

function resolveContextSizeValue(
  agent: AgentStatus,
  model: string,
  preferred?: string,
): string | undefined {
  const allowed = agent.capabilities.modelContextSizes?.[model];
  if (!allowed?.length) return agent.capabilities.defaultContextSize;
  if (preferred && allowed.includes(preferred)) return preferred;
  // First entry in the per-model list is the model's default; this lets the
  // adapter spec a different default per model (e.g. Sonnet→200k, Opus→1M)
  // without needing a separate map.
  return allowed[0];
}

function resolveFastValue(agent: AgentStatus, model: string, preferred?: boolean): boolean {
  if (!agent.capabilities.fastModels?.includes(model)) return false;
  return preferred === true;
}

function resolveThinkingValue(agent: AgentStatus, model: string, preferred?: boolean): boolean {
  if (!agent.capabilities.thinkingModels?.includes(model)) return false;
  return preferred === true;
}

function resolveModeValue(agent: AgentStatus, preferred?: string): string {
  const modes = agent.capabilities.modes;
  return preferred && modes.includes(preferred as "agent" | "plan" | "autopilot")
    ? preferred
    : (modes[0] ?? "agent");
}

function normalizeOptionName(value: string): string {
  return value.trim().toLowerCase();
}

function formatEffortLabel(id: string): string {
  if (id === "xhigh") return "Extra High";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function findDefaultApprovalPolicy(agent: AgentStatus): string | undefined {
  const policies = agent.capabilities.approvalPolicies;
  const configuredBypass = agent.capabilities.bypassApprovalPolicy;
  if (configuredBypass && policies.some((policy) => policy.id === configuredBypass)) {
    return configuredBypass;
  }

  const preferredIds = new Set(["never", "yolo", "auto", "bypassPermissions", "dontAsk"]);
  const byId = policies.find((policy) => preferredIds.has(policy.id));
  if (byId) {
    return byId.id;
  }

  const preferredLabels = new Set([
    "full access",
    "yolo",
    "bypass permissions",
    "don't ask",
    "dont ask",
  ]);
  const byLabel = policies.find((policy) => preferredLabels.has(normalizeOptionName(policy.label)));
  return byLabel?.id;
}

function resolveApprovalPolicyValue(agent: AgentStatus, preferred?: string): string {
  const policies = agent.capabilities.approvalPolicies;
  return preferred && policies.some((p) => p.id === preferred)
    ? preferred
    : (findDefaultApprovalPolicy(agent) ?? policies[0]?.id ?? "");
}

function findDefaultSandboxMode(agent: AgentStatus): string | undefined {
  const modes = agent.capabilities.sandboxModes;
  const preferredIds = new Set(["danger-full-access", "full-access"]);
  const byId = modes.find((mode) => preferredIds.has(mode.id));
  if (byId) {
    return byId.id;
  }

  const byLabel = modes.find((mode) => normalizeOptionName(mode.label) === "full access");
  return byLabel?.id;
}

function resolveSandboxModeValue(agent: AgentStatus, preferred?: string): string {
  const modes = agent.capabilities.sandboxModes;
  return preferred && modes.some((m) => m.id === preferred)
    ? preferred
    : (findDefaultSandboxMode(agent) ?? modes[0]?.id ?? "");
}

function resolveInitialPresentationMode(
  agent: AgentStatus | undefined,
  lastByAgent: Record<string, ThreadPresentationMode>,
): ThreadPresentationMode {
  if (!agent) return "gui";
  const supported = agent.capabilities.presentationModes ?? [agent.capabilities.presentationMode];
  const last = lastByAgent[agent.kind];
  if (last && supported.includes(last)) return last;
  if (supported.includes("gui")) return "gui";
  return supported[0] ?? agent.capabilities.presentationMode ?? "gui";
}

function normalizeCursorPreferredDraft(
  agent: AgentStatus,
  preferred?: Partial<ProviderDraftConfig>,
): Partial<ProviderDraftConfig> | undefined {
  if (agent.kind !== "cursor" || !preferred?.model) {
    return preferred;
  }
  if (agent.capabilities.models.some((model) => model.id === preferred.model)) {
    return preferred;
  }

  const parsed = parseCursorModelId(preferred.model);
  const baseModel = migrateCursorBaseId(parsed.baseId);
  if (!agent.capabilities.models.some((model) => model.id === baseModel)) {
    return preferred;
  }

  return {
    ...preferred,
    model: baseModel,
    ...(parsed.effort && !preferred.effort ? { effort: parsed.effort } : {}),
    fast: preferred.fast ?? parsed.fast,
    thinking: preferred.thinking ?? parsed.thinking,
  };
}

function resolveProviderDraftConfig(
  agent: AgentStatus,
  preferred?: Partial<ProviderDraftConfig>,
): ProviderDraftConfig {
  const normalizedPreferred = normalizeCursorPreferredDraft(agent, preferred);
  const nextModel = resolveModelValue(agent, normalizedPreferred?.model);
  const nextEffort = resolveEffortValue(agent, nextModel, normalizedPreferred?.effort);
  const nextContext = resolveContextSizeValue(agent, nextModel, normalizedPreferred?.contextSize);
  const nextFast = resolveFastValue(agent, nextModel, normalizedPreferred?.fast);
  const nextThinking = resolveThinkingValue(agent, nextModel, normalizedPreferred?.thinking);
  const nextMode = resolveModeValue(agent, normalizedPreferred?.mode) as
    | "agent"
    | "plan"
    | "autopilot";
  const nextApproval = resolveApprovalPolicyValue(agent, normalizedPreferred?.approvalPolicy);
  const nextSandbox = resolveSandboxModeValue(agent, normalizedPreferred?.sandboxMode);

  return {
    model: nextModel,
    effort: nextEffort,
    ...(nextContext ? { contextSize: nextContext } : {}),
    ...(nextFast ? { fast: nextFast } : {}),
    ...(nextThinking ? { thinking: nextThinking } : {}),
    mode: nextMode,
    approvalPolicy: nextApproval,
    sandboxMode: nextSandbox,
  };
}

function agentWithCapabilities(
  agent: AgentStatus,
  presentationMode: ThreadPresentationMode,
): AgentStatus {
  return {
    ...agent,
    capabilities: capabilitiesForPresentation(agent.capabilities, presentationMode),
  };
}

function formatAgentList(names: string[]): string {
  if (names.length === 0) return "a supported coding agent";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")}, or ${names.at(-1)}`;
}

export function ThreadDraftView(props: {
  project: Project;
  agentStatuses: AgentStatus[];
  /**
   * True when the supervisor hasn't yet returned agent statuses for this
   * project's environment (first launch, no cache).  The composer shows a
   * "Detecting agents…" placeholder instead of the "No supported agents"
   * prompt while this is true.
   */
  isDetectingAgents?: boolean;
  lastDraftConfig?: ProjectDraftConfig;
  compact?: boolean;
  paneAlign?: "left" | "center" | "right";
  showCloseButton?: boolean;
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
  /**
   * True when this draft pane sits in the top-left and there is no group header
   * above it. Adds a class so CSS can pad the header to clear the macOS
   * traffic-light controls when the sidebar is collapsed.
   */
  headerNeedsTrafficLightPad?: boolean | undefined;
  droppableRef?: React.RefObject<HTMLDivElement | null>;
  onClose?: (() => void) | undefined;
  dragHandleRef?: React.RefCallback<Element>;
  onStart: (input: DraftStartInput) => void;
}) {
  const {
    project,
    agentStatuses,
    lastDraftConfig,
    onStart,
    headerNeedsTrafficLightPad = false,
  } = props;
  const gitBranch = useGitStore((s) => s.statuses[project.id]?.branch);
  const disabledAgents = useSharedSettings((s) => s.disabledAgents);
  const sharedSettingsHydrated = useSharedSettings((s) => s.sharedSettingsHydrated);
  const inFirstLaunchDiscovery = useAgentStatusesStore((s) => s.inFirstLaunchDiscovery);

  // Debugging showed config-only edits were rebuilding the provider/model
  // payload. Keep the installed-agent list stable unless the source inputs
  // actually change.
  const installedAgents = useMemo(
    () =>
      agentStatuses.filter((status) => status.installed && !disabledAgents.includes(status.kind)),
    [agentStatuses, disabledAgents],
  );
  const preferredAgentKind = resolvePreferredAgentKind(installedAgents, lastDraftConfig);
  const [agentKind, setAgentKind] = useState<AgentStatus["kind"] | undefined>(preferredAgentKind);
  const effectiveAgentKind = installedAgents.some((status) => status.kind === agentKind)
    ? agentKind
    : preferredAgentKind;
  const selectedAgent =
    installedAgents.find((status) => status.kind === effectiveAgentKind) ?? installedAgents[0];
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [contextSize, setContextSize] = useState<string | undefined>(undefined);
  const [fast, setFast] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [mode, setMode] = useState<"agent" | "plan" | "autopilot">("agent");
  const [approvalPolicy, setApprovalPolicy] = useState("");
  const [sandboxMode, setSandboxMode] = useState("");
  const [worktreeMode, setWorktreeMode] = useState(lastDraftConfig?.worktreeMode ?? false);
  const lastAppliedAgentKindRef = useRef<AgentStatus["kind"] | undefined>(undefined);

  // Presentation-mode picker — only meaningful for adapters that advertise
  // multiple modes. The render fork in ThreadView consumes `presentationMode`
  // off the Thread row, but we resolve it here so the user's last choice for
  // this provider is remembered across new-thread drafts.
  const lastPresentationModeByAgent = useSharedSettings((s) => s.lastPresentationModeByAgent);
  const setLastPresentationMode = useSharedSettings((s) => s.setLastPresentationMode);
  const supportedPresentationModes = selectedAgent
    ? (selectedAgent.capabilities.presentationModes ?? [
        selectedAgent.capabilities.presentationMode,
      ])
    : [];
  // CLI/Chat reachability is aggregated across all installed providers — the
  // picker stays enabled whenever some provider can serve the mode, even if
  // the currently-selected one can't. Clicking an unreachable-for-this-agent
  // tab swaps to a fallback provider rather than being blocked.
  const anyAgentSupports = (presentation: ThreadPresentationMode): boolean =>
    installedAgents.some((agent) => {
      const modes = agent.capabilities.presentationModes ?? [agent.capabilities.presentationMode];
      return modes.includes(presentation);
    });
  const supportsTerminalMode = anyAgentSupports("terminal");
  const supportsGuiMode = anyAgentSupports("gui");
  const supportsModePicker = supportsTerminalMode && supportsGuiMode;
  const [presentationMode, setPresentationMode] = useState<ThreadPresentationMode>(() =>
    resolveInitialPresentationMode(selectedAgent, lastPresentationModeByAgent),
  );
  const selectedAgentForConfig = useMemo(
    () => (selectedAgent ? agentWithCapabilities(selectedAgent, presentationMode) : undefined),
    [selectedAgent, presentationMode],
  );
  const previousPresentationAgentKindRef = useRef<AgentStatus["kind"] | undefined>(
    selectedAgent?.kind,
  );
  // Re-resolve when the first provider arrives after an empty draft, or on a
  // provider switch when the new provider can't serve the current mode. Why
  // this set of deps:
  //   - `lastPresentationModeByAgent` is the user's per-provider memory; we
  //     intentionally read the *latest* value at provider-switch time but
  //     don't want intra-session writes to retrigger this effect (the user
  //     hasn't changed providers, so their current selection wins).
  //   - `supportedPresentationModes` and `presentationMode` are derived from
  //     `selectedAgent` and `effectiveAgentKind`; including them would either
  //     duplicate the trigger or fire mid-edit on unrelated state.
  // The model picker already filters providers to those that support the
  // active surface, so a model swap should never flip CLI/Chat silently.
  useEffect(() => {
    const previousAgentKind = previousPresentationAgentKindRef.current;
    previousPresentationAgentKindRef.current = selectedAgent?.kind;
    if (!selectedAgent) return;
    if (!previousAgentKind) {
      setPresentationMode(
        resolveInitialPresentationMode(selectedAgent, lastPresentationModeByAgent),
      );
      return;
    }
    if (supportedPresentationModes.includes(presentationMode)) return;
    setPresentationMode(resolveInitialPresentationMode(selectedAgent, lastPresentationModeByAgent));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on provider change
  }, [effectiveAgentKind]);

  // --- Per-provider config memory (app-wide via shared settings) ---
  const updateProjectDraftConfig = useAppStore((s) => s.updateProjectDraftConfig);
  const setProviderConfig = useSharedSettings((s) => s.setProviderConfig);
  const effectiveAgentKindRef = useRef(effectiveAgentKind);
  const providerConfigsRef = useRef<Record<string, ProviderDraftConfig>>({});
  const hasLocalConfigEditRef = useRef(false);
  effectiveAgentKindRef.current = effectiveAgentKind;
  // Spread is required: the effects below mutate `providerConfigsRef.current[kind]`
  // in place to keep effort/model selections in sync mid-render. Assigning the
  // store reference directly would mutate Zustand state and skip subscribers.
  providerConfigsRef.current = { ...useSharedSettings.getState().providerConfigs };

  function persistProviderConfig(providerKind: string, config: ProviderDraftConfig) {
    providerConfigsRef.current[providerKind] = config;
    setProviderConfig(providerKind, config);
  }

  function persistProjectDraftConfig(draftConfig: ProjectDraftConfig) {
    updateProjectDraftConfig(project.id, draftConfig);
  }

  function handleSwitchBranch(branch: string, createNew: boolean) {
    readBridge()
      .gitSwitchBranch({
        projectLocation: project.location,
        branch,
        createNew,
      })
      .then((result) => {
        // Immediately patch the store so the UI updates without waiting
        // for the file-watcher → refreshProject cascade.
        const store = useGitStore.getState();
        const status = store.statuses[project.id];
        if (status) {
          store.setStatus(project.id, {
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
        toast.danger(friendlyError(err));
      });
  }

  useEffect(() => {
    if (effectiveAgentKind && agentKind !== effectiveAgentKind) {
      setAgentKind(effectiveAgentKind);
    }
  }, [agentKind, effectiveAgentKind]);

  useEffect(() => {
    if (!selectedAgentForConfig || !effectiveAgentKind) {
      return;
    }

    if (lastAppliedAgentKindRef.current === effectiveAgentKind) {
      return;
    }

    const saved = resolveSavedProviderDraftConfig(
      effectiveAgentKind,
      lastDraftConfig,
      providerConfigsRef.current,
    );
    const resolved = resolveProviderDraftConfig(selectedAgentForConfig, saved);
    const nextModel = resolved.model;
    const nextEffort = resolved.effort ?? "";
    const nextContext = resolved.contextSize;
    const nextFast = resolved.fast ?? false;
    const nextThinking = resolved.thinking ?? false;
    const nextMode = (resolved.mode ?? "agent") as "agent" | "plan" | "autopilot";
    const nextApproval = resolved.approvalPolicy ?? "";
    const nextSandbox = resolved.sandboxMode ?? "";

    setModel(nextModel);
    setEffort(nextEffort);
    setContextSize(nextContext);
    setFast(nextFast);
    setThinking(nextThinking);
    setMode(nextMode);
    setApprovalPolicy(nextApproval);
    setSandboxMode(nextSandbox);
    lastAppliedAgentKindRef.current = effectiveAgentKind;

    // Persist per-provider config app-wide, last-used provider per project.
    providerConfigsRef.current[effectiveAgentKind] = resolved;
    setProviderConfig(effectiveAgentKind, resolved);
    updateProjectDraftConfig(project.id, {
      agentKind: effectiveAgentKind,
      model: nextModel,
      effort: nextEffort,
      ...(nextContext ? { contextSize: nextContext } : {}),
      ...(nextFast ? { fast: nextFast } : {}),
      ...(nextThinking ? { thinking: nextThinking } : {}),
      mode: nextMode,
      approvalPolicy: nextApproval,
      sandboxMode: nextSandbox,
      worktreeMode,
    });
  }, [
    effectiveAgentKind,
    selectedAgentForConfig,
    project.id,
    lastDraftConfig,
    worktreeMode,
    updateProjectDraftConfig,
    setProviderConfig,
  ]);

  useEffect(() => {
    if (!selectedAgentForConfig || !effectiveAgentKind) {
      return;
    }
    if (!model) {
      return;
    }

    const nextModel = resolveModelValue(selectedAgentForConfig, model);
    const nextEffort = resolveEffortValue(selectedAgentForConfig, nextModel, effort);
    const nextContext = resolveContextSizeValue(selectedAgentForConfig, nextModel, contextSize);
    const nextFast = resolveFastValue(selectedAgentForConfig, nextModel, fast);
    const nextThinking = resolveThinkingValue(selectedAgentForConfig, nextModel, thinking);
    if (
      nextModel !== model ||
      nextEffort !== effort ||
      nextContext !== contextSize ||
      nextFast !== fast ||
      nextThinking !== thinking
    ) {
      if (nextModel !== model) setModel(nextModel);
      if (nextEffort !== effort) setEffort(nextEffort);
      if (nextContext !== contextSize) setContextSize(nextContext);
      if (nextFast !== fast) setFast(nextFast);
      if (nextThinking !== thinking) setThinking(nextThinking);

      // Persist the corrected values
      const corrected: ProviderDraftConfig = {
        ...providerConfigsRef.current?.[effectiveAgentKind],
        model: nextModel,
        effort: nextEffort,
        ...(nextContext ? { contextSize: nextContext } : {}),
        ...(nextFast ? { fast: nextFast } : {}),
        ...(nextThinking ? { thinking: nextThinking } : {}),
      };
      providerConfigsRef.current[effectiveAgentKind] = corrected;
      setProviderConfig(effectiveAgentKind, corrected);
      updateProjectDraftConfig(project.id, {
        agentKind: effectiveAgentKind,
        model: nextModel,
        effort: nextEffort,
        ...(nextContext ? { contextSize: nextContext } : {}),
        ...(nextFast ? { fast: nextFast } : {}),
        ...(nextThinking ? { thinking: nextThinking } : {}),
        mode,
        approvalPolicy,
        sandboxMode,
        worktreeMode,
      });
    }
  }, [
    effort,
    contextSize,
    fast,
    thinking,
    model,
    selectedAgentForConfig,
    effectiveAgentKind,
    mode,
    approvalPolicy,
    sandboxMode,
    worktreeMode,
    project.id,
    updateProjectDraftConfig,
    setProviderConfig,
  ]);

  useEffect(() => {
    if (!sharedSettingsHydrated || hasLocalConfigEditRef.current) {
      return;
    }
    if (!selectedAgentForConfig || !effectiveAgentKind) {
      return;
    }
    if (lastDraftConfig?.agentKind === effectiveAgentKind && lastDraftConfig.model.trim()) {
      return;
    }

    const saved = useSharedSettings.getState().providerConfigs[effectiveAgentKind];
    if (!saved) {
      return;
    }
    providerConfigsRef.current = { ...useSharedSettings.getState().providerConfigs };

    const resolved = resolveProviderDraftConfig(selectedAgentForConfig, saved);
    const nextModel = resolved.model;
    const nextEffort = resolved.effort ?? "";
    const nextContext = resolved.contextSize;
    const nextFast = resolved.fast ?? false;
    const nextThinking = resolved.thinking ?? false;
    const nextMode = (resolved.mode ?? "agent") as "agent" | "plan" | "autopilot";
    const nextApproval = resolved.approvalPolicy ?? "";
    const nextSandbox = resolved.sandboxMode ?? "";

    if (
      nextModel === model &&
      nextEffort === effort &&
      nextContext === contextSize &&
      nextFast === fast &&
      nextThinking === thinking &&
      nextMode === mode &&
      nextApproval === approvalPolicy &&
      nextSandbox === sandboxMode
    ) {
      return;
    }

    setModel(nextModel);
    setEffort(nextEffort);
    setContextSize(nextContext);
    setFast(nextFast);
    setThinking(nextThinking);
    setMode(nextMode);
    setApprovalPolicy(nextApproval);
    setSandboxMode(nextSandbox);
    lastAppliedAgentKindRef.current = effectiveAgentKind;

    if (
      saved.model !== nextModel ||
      saved.effort !== nextEffort ||
      saved.contextSize !== nextContext ||
      saved.fast !== nextFast ||
      saved.thinking !== nextThinking ||
      saved.mode !== nextMode ||
      saved.approvalPolicy !== nextApproval ||
      saved.sandboxMode !== nextSandbox
    ) {
      providerConfigsRef.current[effectiveAgentKind] = resolved;
      setProviderConfig(effectiveAgentKind, resolved);
    }

    updateProjectDraftConfig(project.id, {
      agentKind: effectiveAgentKind,
      model: nextModel,
      effort: nextEffort,
      ...(nextContext ? { contextSize: nextContext } : {}),
      ...(nextFast ? { fast: nextFast } : {}),
      ...(nextThinking ? { thinking: nextThinking } : {}),
      mode: nextMode,
      approvalPolicy: nextApproval,
      sandboxMode: nextSandbox,
      worktreeMode,
    });
  }, [
    sharedSettingsHydrated,
    selectedAgentForConfig,
    effectiveAgentKind,
    lastDraftConfig,
    model,
    effort,
    contextSize,
    fast,
    thinking,
    mode,
    approvalPolicy,
    sandboxMode,
    project.id,
    worktreeMode,
    updateProjectDraftConfig,
    setProviderConfig,
  ]);

  const hiddenModelIds = useSharedSettings((s) =>
    selectedAgent ? s.hiddenModels[selectedAgent.kind] : undefined,
  );
  const allHiddenModels = useSharedSettings((s) => s.hiddenModels);
  const selectedAgentFilteredCapabilities = useMemo(
    () =>
      selectedAgentForConfig
        ? filterHiddenModels(selectedAgentForConfig.capabilities, hiddenModelIds)
        : undefined,
    [selectedAgentForConfig, hiddenModelIds],
  );
  const providerModelProviders = useMemo(
    () =>
      installedAgents
        .filter((agent) => {
          const supported = agent.capabilities.presentationModes ?? [
            agent.capabilities.presentationMode,
          ];
          return supported.includes(presentationMode);
        })
        .map((agent) => ({
          kind: agent.kind,
          label: agent.label,
          ...(agent.icon ? { icon: agent.icon } : {}),
          capabilities: filterHiddenModels(
            capabilitiesForPresentation(agent.capabilities, presentationMode),
            allHiddenModels[agent.kind],
          ),
        })),
    [installedAgents, presentationMode, allHiddenModels],
  );
  const selectedAgentKind = selectedAgent?.kind;
  const factory = useMemo(
    () => (selectedAgentKind ? getComposerControls(selectedAgentKind) : undefined),
    [selectedAgentKind],
  );
  const latestConfigPatchRef = useRef<(patch: Partial<ThreadConfig>) => void>(() => undefined);
  const latestProviderModelChangeRef = useRef<(next: { agentKind: string; model: string }) => void>(
    () => undefined,
  );
  const onConfigPatch = (patch: Partial<ThreadConfig>) => {
    if (!selectedAgentForConfig) return;
    hasLocalConfigEditRef.current = true;
    const resolved = resolveProviderDraftConfig(selectedAgentForConfig, {
      model: patch.model ?? model,
      effort: patch.effort ?? effort,
      ...(patch.contextSize !== undefined ? { contextSize: patch.contextSize } : { contextSize }),
      ...(patch.fast !== undefined ? { fast: patch.fast } : { fast }),
      ...(patch.thinking !== undefined ? { thinking: patch.thinking } : { thinking }),
      mode: patch.mode ?? mode,
      approvalPolicy: patch.approvalPolicy ?? approvalPolicy,
      sandboxMode: patch.sandboxMode ?? sandboxMode,
    });

    setModel(resolved.model);
    setEffort(resolved.effort ?? "");
    setContextSize(resolved.contextSize);
    setFast(resolved.fast ?? false);
    setThinking(resolved.thinking ?? false);
    setMode((resolved.mode ?? "agent") as "agent" | "plan" | "autopilot");
    setApprovalPolicy(resolved.approvalPolicy ?? "");
    setSandboxMode(resolved.sandboxMode ?? "");

    // Keep local state and persisted config in one transaction so menu
    // selection animations do not receive a second delayed state update.
    if (effectiveAgentKind) {
      if (providerConfigsRef.current) {
        providerConfigsRef.current[effectiveAgentKind] = resolved;
      }
      persistProviderConfig(effectiveAgentKind, resolved);
      persistProjectDraftConfig({
        agentKind: effectiveAgentKind,
        model: resolved.model,
        effort: resolved.effort,
        ...(resolved.contextSize ? { contextSize: resolved.contextSize } : {}),
        ...(resolved.fast ? { fast: resolved.fast } : {}),
        ...(resolved.thinking ? { thinking: resolved.thinking } : {}),
        mode: resolved.mode,
        approvalPolicy: resolved.approvalPolicy,
        sandboxMode: resolved.sandboxMode,
        worktreeMode,
      });
    }
  };
  latestConfigPatchRef.current = onConfigPatch;

  latestProviderModelChangeRef.current = ({ agentKind: nextKind, model: nextModel }) => {
    if (!selectedAgent) return;
    hasLocalConfigEditRef.current = true;
    if (nextKind !== selectedAgent.kind) {
      const targetAgent = installedAgents.find((agent) => agent.kind === nextKind);
      if (!targetAgent) return;
      const targetAgentForConfig = agentWithCapabilities(targetAgent, presentationMode);

      // Snapshot current provider before switching, then attach the
      // newly chosen model to the target provider's saved draft so
      // resolveModelValue prefers it on the next effect run.
      if (effectiveAgentKind) {
        const snapshot: ProviderDraftConfig = {
          model,
          effort,
          ...(contextSize ? { contextSize } : {}),
          ...(fast ? { fast } : {}),
          ...(thinking ? { thinking } : {}),
          mode,
          approvalPolicy,
          sandboxMode,
        };
        persistProviderConfig(effectiveAgentKind, snapshot);
      }
      const targetSaved = providerConfigsRef.current[nextKind];
      const resolved = resolveProviderDraftConfig(targetAgentForConfig, {
        ...(targetSaved ?? {}),
        model: nextModel,
      });
      persistProviderConfig(nextKind, resolved);
      setModel(resolved.model);
      setEffort(resolved.effort ?? "");
      setContextSize(resolved.contextSize);
      setFast(resolved.fast ?? false);
      setThinking(resolved.thinking ?? false);
      setMode((resolved.mode ?? "agent") as "agent" | "plan" | "autopilot");
      setApprovalPolicy(resolved.approvalPolicy ?? "");
      setSandboxMode(resolved.sandboxMode ?? "");
      lastAppliedAgentKindRef.current = nextKind as AgentStatus["kind"];
      setAgentKind(nextKind as AgentStatus["kind"]);
      persistProjectDraftConfig({
        agentKind: nextKind as AgentStatus["kind"],
        model: resolved.model,
        effort: resolved.effort,
        ...(resolved.contextSize ? { contextSize: resolved.contextSize } : {}),
        ...(resolved.fast ? { fast: resolved.fast } : {}),
        ...(resolved.thinking ? { thinking: resolved.thinking } : {}),
        mode: resolved.mode,
        approvalPolicy: resolved.approvalPolicy,
        sandboxMode: resolved.sandboxMode,
        worktreeMode,
      });
    } else {
      latestConfigPatchRef.current({ model: nextModel });
    }
  };

  const baseDraftControls = useMemo(() => {
    if (!selectedAgent || !selectedAgentForConfig) return [];
    const filteredCaps = selectedAgentFilteredCapabilities ?? selectedAgentForConfig.capabilities;
    const providers = providerModelProviders;
    const currentEfforts = (filteredCaps.modelEfforts?.[model] ?? filteredCaps.efforts ?? []).map(
      (id) => ({
        id,
        label: formatEffortLabel(id),
      }),
    );
    const selectableEfforts = currentEfforts.length > 1 ? currentEfforts : [];
    const currentContextIds = filteredCaps.modelContextSizes?.[model];
    const currentContextSizes = currentContextIds
      ? (filteredCaps.contextSizes?.filter((c) => currentContextIds.includes(c.id)) ?? [])
      : [];
    const selectableContextSizes = currentContextSizes.length > 1 ? currentContextSizes : [];
    const supportsFast = filteredCaps.fastModels?.includes(model) ?? false;
    const supportsThinking = filteredCaps.thinkingModels?.includes(model) ?? false;
    const ctrls: ComposerControl[] = [
      {
        kind: "provider-model",
        providers,
        currentAgentKind: selectedAgent.kind,
        currentModel: model,
        hideLabelOnWrap: true,
        tier: 5,
        onChange: (next) => latestProviderModelChangeRef.current(next),
      },
    ];
    if (selectableEfforts.length > 0 || selectableContextSizes.length > 0 || supportsThinking) {
      ctrls.push({
        kind: "effort-context",
        efforts: selectableEfforts,
        ...(selectableEfforts.length > 0 && effort ? { effortValue: effort } : {}),
        onEffortChange: (value) => latestConfigPatchRef.current({ effort: value }),
        contextSizes: selectableContextSizes,
        ...(selectableContextSizes.length > 0 && contextSize ? { contextValue: contextSize } : {}),
        onContextChange: (value) => latestConfigPatchRef.current({ contextSize: value }),
        thinkingSupported: supportsThinking,
        thinkingValue: thinking,
        onThinkingChange: (value) => latestConfigPatchRef.current({ thinking: value }),
        hideLabelOnWrap: true,
        tier: 4,
        icon:
          selectableEfforts.length > 0 ? (
            <EffortIcon
              className="size-4 text-foreground"
              effort={effort}
              efforts={selectableEfforts.map((e) => e.id)}
            />
          ) : undefined,
      });
    }
    if (supportsFast) {
      ctrls.push({
        kind: "toggle",
        label: "Fast",
        icon: <Zap className="size-3.5" />,
        iconOnly: true,
        fillIconOnSelect: true,
        tier: 3,
        isSelected: fast,
        onChange: (selected) => latestConfigPatchRef.current({ fast: selected }),
      });
    }
    return ctrls;
  }, [
    selectedAgent,
    selectedAgentForConfig,
    selectedAgentFilteredCapabilities,
    providerModelProviders,
    model,
    effort,
    contextSize,
    fast,
    thinking,
  ]);

  const providerDraftControls = useMemo(() => {
    if (!selectedAgent || !selectedAgentForConfig || !factory) return [];
    const filteredCaps = selectedAgentFilteredCapabilities ?? selectedAgentForConfig.capabilities;
    const controls = factory({
      capabilities: filteredCaps,
      config: {
        model,
        effort,
        ...(contextSize ? { contextSize } : {}),
        ...(fast ? { fast } : {}),
        ...(thinking ? { thinking } : {}),
        mode,
        approvalPolicy,
        sandboxMode,
      },
      isDisabled: false,
      onConfigChange: (patch) => latestConfigPatchRef.current(patch),
      presentationMode,
    }).map((control) => {
      let tier = control.tier;
      if (tier === undefined) {
        if (control.kind === "toggle" && (control.label === "Plan" || control.label === "Work")) {
          tier = 2;
        } else if (
          (control.kind === undefined || control.kind === "toggle" || control.kind === "menu") &&
          control.iconKind === "permission"
        ) {
          tier = 1;
        }
      }
      return { ...control, tier };
    });
    return controls;
  }, [
    selectedAgent,
    selectedAgentForConfig,
    selectedAgentFilteredCapabilities,
    factory,
    model,
    effort,
    contextSize,
    fast,
    thinking,
    mode,
    approvalPolicy,
    sandboxMode,
    presentationMode,
  ]);

  const draftControls = useMemo(
    () => [...baseDraftControls, ...providerDraftControls],
    [baseDraftControls, providerDraftControls],
  );

  if (!selectedAgent) {
    if (props.isDetectingAgents) {
      // First-launch fancy reveal: tiles fade in as `agent-detected` events
      // arrive. Subsequent reloads (cache present, but the user opted out of
      // every agent or none are installed) fall back to the lightweight
      // pixel loader.
      if (inFirstLaunchDiscovery) {
        return <AgentDiscoveryScreen />;
      }
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <PixelLoader size="md" />
          <p className="text-sm text-muted">Detecting agents&hellip;</p>
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">No supported agents detected</h1>
        <p className="text-muted">
          Install {formatAgentList(props.agentStatuses.map((s) => s.label))} to create a thread.
        </p>
      </div>
    );
  }

  const alignClass =
    props.paneAlign === "right" ? "ml-auto" : props.paneAlign === "left" ? "mr-auto" : "mx-auto";
  const paddingClass = "px-2";

  return (
    <div
      ref={props.droppableRef}
      className={`relative flex h-full min-h-0 flex-col ${props.isDragging ? "opacity-50" : ""}`}
    >
      {props.compact && (
        <div className={`px-2 ${headerNeedsTrafficLightPad ? macosTrafficLightPadClass : ""}`}>
          <div
            ref={props.dragHandleRef}
            className={`lightcode-content-over-drag-region ${alignClass} flex w-full max-w-[920px] items-center gap-2 py-1 ${props.dragHandleRef ? "cursor-grab active:cursor-grabbing" : ""}`}
          >
            <TerminalSquare className="size-3.5 shrink-0 text-muted/60" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-muted">
              New thread
            </span>
            <div className="flex shrink-0 items-center">
              <span className="px-1 text-sm leading-tight text-muted/60">{project.name}</span>
              {props.showCloseButton && props.onClose && (
                <button
                  type="button"
                  aria-label="Close pane"
                  className="shrink-0 rounded p-1 text-muted/60 transition-colors hover:bg-white/[0.06] hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onClose?.();
                  }}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div
        className={`${props.compact ? alignClass : "mx-auto"} relative flex h-full min-h-0 w-full max-w-[1040px] flex-col ${paddingClass} px-3 pb-2 ${props.compact ? "" : "pt-2"}`}
      >
        {props.dropIndicator === "replace" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-20 rounded-2xl bg-accent/10 ring-1 ring-inset ring-accent/30"
          />
        )}
        {props.dropIndicator === "insert-left" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 bottom-0 left-0 z-20 w-0.5 rounded-full bg-accent"
          />
        )}
        {props.dropIndicator === "insert-right" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 right-0 bottom-0 z-20 w-0.5 rounded-full bg-accent"
          />
        )}
        {props.dropIndicator === "insert-top" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 right-0 left-0 z-20 h-0.5 rounded-full bg-accent"
          />
        )}
        {props.dropIndicator === "insert-bottom" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-0 bottom-0 left-0 z-20 h-0.5 rounded-full bg-accent"
          />
        )}
        {/* Center area — logo */}
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="w-full max-w-[920px] overflow-visible pb-3 text-center">
            <h1
              className={`inline-flex items-baseline gap-3 overflow-visible pb-[0.12em] leading-[1.28] font-semibold tracking-normal ${props.compact ? "text-[clamp(1.375rem,2.75vw,1.875rem)]" : "text-[clamp(1.875rem,4.25vw,3.125rem)]"}`}
            >
              <span className="inline-block pr-[0.04em] pb-[0.12em] text-transparent [background-image:linear-gradient(135deg,var(--foreground)_0%,color-mix(in_oklab,var(--accent)_60%,var(--foreground))_52%,var(--muted)_100%)] [background-size:100%_100%] bg-clip-text">
                Lightcode
              </span>
              <TerminalSquare className="translate-y-[-0.04em] size-[0.48em] shrink-0 text-[color:color-mix(in_oklab,var(--accent)_58%,var(--foreground))] opacity-90" />
            </h1>
            <p
              className={`mx-auto mt-1.5 max-w-full truncate pb-[0.08em] leading-snug font-medium tracking-normal text-transparent [background-image:linear-gradient(135deg,var(--muted)_0%,color-mix(in_oklab,var(--accent)_30%,var(--muted))_100%)] [background-size:100%_100%] bg-clip-text font-mono ${props.compact ? "text-[clamp(0.6875rem,1.05vw,0.8125rem)]" : "text-[clamp(0.75rem,1.35vw,0.9375rem)]"}`}
            >
              {project.name}
            </p>
          </div>
        </div>

        <PresentationModeTabs
          presentationMode={presentationMode}
          supportsTerminal={supportsTerminalMode}
          supportsGui={supportsGuiMode}
          className={`${props.compact ? alignClass : "mx-auto"} mb-1 w-full max-w-[920px]`}
          onChange={(next) => {
            // If the active provider can't serve this surface, swap to
            // another installed provider that can — the provider-switch
            // effect will then reload the per-provider config snapshot.
            if (!supportedPresentationModes.includes(next)) {
              const fallback = installedAgents.find((agent) => {
                const modes = agent.capabilities.presentationModes ?? [
                  agent.capabilities.presentationMode,
                ];
                return modes.includes(next);
              });
              if (!fallback) return;
              setPresentationMode(next);
              setAgentKind(fallback.kind);
              return;
            }
            setPresentationMode(next);
            // Drop config values that the new presentation surface
            // doesn't support (e.g. Codex plan mode is ACP-only).
            const normalizer = effectiveAgentKind
              ? getConfigNormalizer(effectiveAgentKind)
              : undefined;
            if (!normalizer) return;
            const patch = normalizer({
              capabilities: capabilitiesForPresentation(selectedAgent.capabilities, next),
              config: {
                model,
                effort,
                ...(contextSize ? { contextSize } : {}),
                ...(fast ? { fast } : {}),
                ...(thinking ? { thinking } : {}),
                mode,
                approvalPolicy,
                sandboxMode,
              },
              presentationMode: next,
            });
            if (Object.keys(patch).length > 0) onConfigPatch(patch);
          }}
        />

        {/* Composer at bottom */}
        <div className={`${props.compact ? alignClass : "mx-auto"} w-full max-w-[920px]`}>
          <ThreadDraftComposerArea
            project={project}
            selectedAgent={selectedAgent}
            controls={draftControls}
            config={{
              model,
              ...(effort ? { effort } : {}),
              ...(contextSize ? { contextSize } : {}),
              ...(fast ? { fast } : {}),
              ...(thinking ? { thinking } : {}),
              ...(mode ? { mode } : {}),
              ...(approvalPolicy ? { approvalPolicy } : {}),
              ...(sandboxMode ? { sandboxMode } : {}),
            }}
            compact={props.compact}
            paneCount={props.paneCount}
            gitBranch={gitBranch}
            worktreeMode={worktreeMode}
            supportsModePicker={supportsModePicker}
            presentationMode={presentationMode}
            onConfigChange={onConfigPatch}
            onWorktreeModeChange={setWorktreeMode}
            onSwitchBranch={handleSwitchBranch}
            onRememberPresentationMode={() => {
              setLastPresentationMode(selectedAgent.kind, presentationMode);
            }}
            onStart={onStart}
          />
        </div>
      </div>
    </div>
  );
}
