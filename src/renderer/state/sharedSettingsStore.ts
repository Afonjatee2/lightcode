import { create } from "zustand";
import { readBridge } from "../bridge";
import {
  defaultSharedSettings,
  normalizeSharedSettings,
  type SharedSettings,
  type SharedSettingsInput,
} from "@/shared/settings";
import type {
  GitReviewMode,
  NewThreadMode,
  NotificationFilter,
  ProviderDraftConfig,
  TerminalPosition,
  ThemeMode,
  ThreadPresentationMode,
  ThreadRemoveAction,
} from "@/shared/contracts";

const STORAGE_KEY = "lightcode-shared-settings";

interface SharedSettingsState extends SharedSettings {
  sharedSettingsHydrated: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setTerminalPosition: (position: TerminalPosition) => void;
  setCommitGenConfig: (provider: string, model: string, effort: string) => void;
  setTitleGenConfig: (provider: string, model: string, effort: string) => void;
  setConflictResolverConfig: (provider: string, model: string, effort: string) => void;
  setWslCommitGenConfig: (provider: string, model: string, effort: string) => void;
  setWslTitleGenConfig: (provider: string, model: string, effort: string) => void;
  setWslConflictResolverConfig: (provider: string, model: string, effort: string) => void;
  setAgentSetting: (agentKind: string, key: string, value: boolean | string) => void;
  setModelHidden: (agentKind: string, modelId: string, hidden: boolean) => void;
  setHiddenModels: (agentKind: string, hiddenIds: string[]) => void;
  setAgentDisabled: (agentKind: string, disabled: boolean) => void;
  setCollapseTerminalComposer: (value: boolean) => void;
  setStaleThreadUnloadMinutes: (value: number) => void;
  setAutoArchiveDoneAfterDays: (value: number) => void;
  setScrollSpeed: (value: number) => void;
  setAgentTerminalFontSize: (value: number) => void;
  setGuiChatFontSize: (value: number) => void;
  setTerminalPanelFontSize: (value: number) => void;
  setPreventSleepWhileWorking: (value: boolean) => void;
  setThreadRemoveAction: (value: ThreadRemoveAction) => void;
  setNewThreadMode: (value: NewThreadMode) => void;
  setAutoShowTerminalPanel: (value: boolean) => void;
  setGitReviewMode: (value: GitReviewMode) => void;
  setEditorLspEnabled: (value: boolean) => void;
  setSearchUseIgnoreFiles: (value: boolean) => void;
  setSearchExclude: (value: Record<string, boolean>) => void;
  setDisableCliHookPlugin: (value: boolean) => void;
  setProviderConfig: (agentKind: string, config: ProviderDraftConfig) => void;
  setLastPresentationMode: (agentKind: string, mode: ThreadPresentationMode) => void;
  setNotificationsEnabled: (value: boolean) => void;
  setNotificationSound: (value: boolean) => void;
  setNotificationFilter: (value: NotificationFilter) => void;
  setNotificationStatuses: (value: {
    done?: boolean;
    needsAttention?: boolean;
    error?: boolean;
  }) => void;
  setNotifyL2Cli: (value: boolean) => void;
  toggleFavoriteModel: (agentKind: string, modelId: string) => void;
  pushRecentModel: (agentKind: string, modelId: string) => void;
}

const RECENT_MODELS_LIMIT = 16;

function hasBridge(): boolean {
  return typeof window !== "undefined" && window.lightcode !== undefined;
}

function loadFallbackSettings(): SharedSettings {
  if (typeof window === "undefined") {
    return { ...defaultSharedSettings };
  }

  try {
    return normalizeSharedSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return { ...defaultSharedSettings };
  }
}

/**
 * Whether the authoritative settings have been loaded from the main process.
 * Until this is true we skip writing to the settings file so that early
 * useEffect-triggered persists (e.g. setProviderConfig on mount) don't
 * clobber the file with default values before the real settings are loaded.
 */
let initialLoadDone = !hasBridge();

function persistSettings(settings: SharedSettingsInput): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

  if (hasBridge() && initialLoadDone) {
    void readBridge().setSharedSettings(settings);
  }
}

function providerDraftConfigEqual(
  a: ProviderDraftConfig | undefined,
  b: ProviderDraftConfig,
): boolean {
  return (
    a !== undefined &&
    a.model === b.model &&
    a.effort === b.effort &&
    a.contextSize === b.contextSize &&
    a.fast === b.fast &&
    a.thinking === b.thinking &&
    a.mode === b.mode &&
    a.approvalPolicy === b.approvalPolicy &&
    a.sandboxMode === b.sandboxMode
  );
}

const initialSettings = loadFallbackSettings();

export const useSharedSettings = create<SharedSettingsState>()((set, get) => ({
  ...initialSettings,
  sharedSettingsHydrated: initialLoadDone,
  setThemeMode: (themeMode) => {
    set({ themeMode });
    persistSettings(selectSharedSettings(get()));
  },
  setTerminalPosition: (terminalPosition) => {
    set({ terminalPosition });
    persistSettings(selectSharedSettings(get()));
  },
  setCommitGenConfig: (commitGenProvider, commitGenModel, commitGenEffort) => {
    set({ commitGenProvider, commitGenModel, commitGenEffort });
    persistSettings(selectSharedSettings(get()));
  },
  setTitleGenConfig: (titleGenProvider, titleGenModel, titleGenEffort) => {
    set({ titleGenProvider, titleGenModel, titleGenEffort });
    persistSettings(selectSharedSettings(get()));
  },
  setConflictResolverConfig: (
    conflictResolverProvider,
    conflictResolverModel,
    conflictResolverEffort,
  ) => {
    set({ conflictResolverProvider, conflictResolverModel, conflictResolverEffort });
    persistSettings(selectSharedSettings(get()));
  },
  setWslCommitGenConfig: (wslCommitGenProvider, wslCommitGenModel, wslCommitGenEffort) => {
    set({ wslCommitGenProvider, wslCommitGenModel, wslCommitGenEffort });
    persistSettings(selectSharedSettings(get()));
  },
  setWslTitleGenConfig: (wslTitleGenProvider, wslTitleGenModel, wslTitleGenEffort) => {
    set({ wslTitleGenProvider, wslTitleGenModel, wslTitleGenEffort });
    persistSettings(selectSharedSettings(get()));
  },
  setWslConflictResolverConfig: (
    wslConflictResolverProvider,
    wslConflictResolverModel,
    wslConflictResolverEffort,
  ) => {
    set({ wslConflictResolverProvider, wslConflictResolverModel, wslConflictResolverEffort });
    persistSettings(selectSharedSettings(get()));
  },
  setAgentSetting: (agentKind, key, value) => {
    const current = get().agentSettings;
    const agentValues = { ...current[agentKind], [key]: value };
    set({ agentSettings: { ...current, [agentKind]: agentValues } });
    persistSettings(selectSharedSettings(get()));
  },
  setModelHidden: (agentKind, modelId, hidden) => {
    const current = get().hiddenModels;
    const list = current[agentKind] ?? [];
    const next = hidden ? [...new Set([...list, modelId])] : list.filter((id) => id !== modelId);
    set({ hiddenModels: { ...current, [agentKind]: next } });
    persistSettings(selectSharedSettings(get()));
  },
  setHiddenModels: (agentKind, hiddenIds) => {
    const current = get().hiddenModels;
    set({ hiddenModels: { ...current, [agentKind]: hiddenIds } });
    persistSettings(selectSharedSettings(get()));
  },
  setAgentDisabled: (agentKind, disabled) => {
    const current = get().disabledAgents;
    const next = disabled
      ? [...new Set([...current, agentKind])]
      : current.filter((k) => k !== agentKind);
    set({ disabledAgents: next });
    persistSettings(selectSharedSettings(get()));
  },
  setCollapseTerminalComposer: (collapseTerminalComposer) => {
    set({ collapseTerminalComposer });
    persistSettings(selectSharedSettings(get()));
  },
  setStaleThreadUnloadMinutes: (staleThreadUnloadMinutes) => {
    set({ staleThreadUnloadMinutes });
    persistSettings(selectSharedSettings(get()));
  },
  setAutoArchiveDoneAfterDays: (autoArchiveDoneAfterDays) => {
    set({ autoArchiveDoneAfterDays });
    persistSettings(selectSharedSettings(get()));
  },
  setScrollSpeed: (scrollSpeed) => {
    set({ scrollSpeed });
    persistSettings(selectSharedSettings(get()));
  },
  setAgentTerminalFontSize: (agentTerminalFontSize) => {
    set({ agentTerminalFontSize });
    persistSettings(selectSharedSettings(get()));
  },
  setGuiChatFontSize: (guiChatFontSize) => {
    set({ guiChatFontSize });
    persistSettings(selectSharedSettings(get()));
  },
  setTerminalPanelFontSize: (terminalPanelFontSize) => {
    set({ terminalPanelFontSize });
    persistSettings(selectSharedSettings(get()));
  },
  setPreventSleepWhileWorking: (preventSleepWhileWorking) => {
    set({ preventSleepWhileWorking });
    persistSettings(selectSharedSettings(get()));
  },
  setThreadRemoveAction: (threadRemoveAction) => {
    set({ threadRemoveAction });
    persistSettings(selectSharedSettings(get()));
  },
  setNewThreadMode: (newThreadMode) => {
    set({ newThreadMode });
    persistSettings(selectSharedSettings(get()));
  },
  setAutoShowTerminalPanel: (autoShowTerminalPanel) => {
    set({ autoShowTerminalPanel });
    persistSettings(selectSharedSettings(get()));
  },
  setGitReviewMode: (gitReviewMode) => {
    set({ gitReviewMode });
    persistSettings(selectSharedSettings(get()));
  },
  setEditorLspEnabled: (editorLspEnabled) => {
    set({ editorLspEnabled });
    persistSettings(selectSharedSettings(get()));
  },
  setSearchUseIgnoreFiles: (searchUseIgnoreFiles) => {
    set({ searchUseIgnoreFiles });
    persistSettings(selectSharedSettings(get()));
  },
  setSearchExclude: (searchExclude) => {
    set({ searchExclude });
    persistSettings(selectSharedSettings(get()));
  },
  setDisableCliHookPlugin: (disableCliHookPlugin) => {
    set({ disableCliHookPlugin });
    persistSettings(selectSharedSettings(get()));
  },
  setProviderConfig: (agentKind, config) => {
    if (!config.model.trim()) {
      return;
    }
    const current = get().providerConfigs;
    if (providerDraftConfigEqual(current[agentKind], config)) {
      return;
    }
    set({ providerConfigs: { ...current, [agentKind]: config } });
    persistSettings(selectSharedSettings(get()));
  },
  setLastPresentationMode: (agentKind, mode) => {
    const current = get().lastPresentationModeByAgent;
    if (current[agentKind] === mode) return;
    set({ lastPresentationModeByAgent: { ...current, [agentKind]: mode } });
    persistSettings(selectSharedSettings(get()));
  },
  setNotificationsEnabled: (notificationsEnabled) => {
    if (get().notificationsEnabled === notificationsEnabled) return;
    set({ notificationsEnabled });
    persistSettings(selectSharedSettings(get()));
  },
  setNotificationSound: (notificationSound) => {
    if (get().notificationSound === notificationSound) return;
    set({ notificationSound });
    persistSettings(selectSharedSettings(get()));
  },
  setNotificationFilter: (notificationFilter) => {
    if (get().notificationFilter === notificationFilter) return;
    set({ notificationFilter });
    persistSettings(selectSharedSettings(get()));
  },
  setNotificationStatuses: (partial) => {
    const current = get().notificationStatuses;
    const next = { ...current, ...partial };
    if (
      current.done === next.done &&
      current.needsAttention === next.needsAttention &&
      current.error === next.error
    ) {
      return;
    }
    set({ notificationStatuses: next });
    persistSettings(selectSharedSettings(get()));
  },
  setNotifyL2Cli: (notifyL2Cli) => {
    if (get().notifyL2Cli === notifyL2Cli) return;
    set({ notifyL2Cli });
    persistSettings(selectSharedSettings(get()));
  },
  toggleFavoriteModel: (agentKind, modelId) => {
    const current = get().favoriteModels;
    const idx = current.findIndex((m) => m.agentKind === agentKind && m.modelId === modelId);
    const next =
      idx >= 0
        ? [...current.slice(0, idx), ...current.slice(idx + 1)]
        : [...current, { agentKind, modelId }];
    set({ favoriteModels: next });
    persistSettings(selectSharedSettings(get()));
  },
  pushRecentModel: (agentKind, modelId) => {
    const current = get().recentModels;
    const filtered = current.filter((m) => !(m.agentKind === agentKind && m.modelId === modelId));
    const next = [{ agentKind, modelId }, ...filtered].slice(0, RECENT_MODELS_LIMIT);
    if (
      current.length === next.length &&
      current.every((m, i) => m.agentKind === next[i]!.agentKind && m.modelId === next[i]!.modelId)
    ) {
      return;
    }
    set({ recentModels: next });
    persistSettings(selectSharedSettings(get()));
  },
}));

function selectSharedSettings(state: SharedSettingsState): SharedSettingsInput {
  return {
    themeMode: state.themeMode,
    terminalPosition: state.terminalPosition,
    commitGenProvider: state.commitGenProvider,
    commitGenModel: state.commitGenModel,
    commitGenEffort: state.commitGenEffort,
    titleGenProvider: state.titleGenProvider,
    titleGenModel: state.titleGenModel,
    titleGenEffort: state.titleGenEffort,
    conflictResolverProvider: state.conflictResolverProvider,
    conflictResolverModel: state.conflictResolverModel,
    conflictResolverEffort: state.conflictResolverEffort,
    wslCommitGenProvider: state.wslCommitGenProvider,
    wslCommitGenModel: state.wslCommitGenModel,
    wslCommitGenEffort: state.wslCommitGenEffort,
    wslTitleGenProvider: state.wslTitleGenProvider,
    wslTitleGenModel: state.wslTitleGenModel,
    wslTitleGenEffort: state.wslTitleGenEffort,
    wslConflictResolverProvider: state.wslConflictResolverProvider,
    wslConflictResolverModel: state.wslConflictResolverModel,
    wslConflictResolverEffort: state.wslConflictResolverEffort,
    agentSettings: state.agentSettings,
    hiddenModels: state.hiddenModels,
    disabledAgents: state.disabledAgents,
    acpRegistryInstalledAgents: state.acpRegistryInstalledAgents,
    agentInstances: state.agentInstances,
    collapseTerminalComposer: state.collapseTerminalComposer,
    staleThreadUnloadMinutes: state.staleThreadUnloadMinutes,
    autoArchiveDoneAfterDays: state.autoArchiveDoneAfterDays,
    scrollSpeed: state.scrollSpeed,
    agentTerminalFontSize: state.agentTerminalFontSize,
    guiChatFontSize: state.guiChatFontSize,
    terminalPanelFontSize: state.terminalPanelFontSize,
    preventSleepWhileWorking: state.preventSleepWhileWorking,
    threadRemoveAction: state.threadRemoveAction,
    newThreadMode: state.newThreadMode,
    autoShowTerminalPanel: state.autoShowTerminalPanel,
    gitReviewMode: state.gitReviewMode,
    providerConfigs: state.providerConfigs,
    lastPresentationModeByAgent: state.lastPresentationModeByAgent,
    editorLspEnabled: state.editorLspEnabled,
    searchUseIgnoreFiles: state.searchUseIgnoreFiles,
    searchExclude: state.searchExclude,
    disableCliHookPlugin: state.disableCliHookPlugin,
    notificationsEnabled: state.notificationsEnabled,
    notificationSound: state.notificationSound,
    notificationFilter: state.notificationFilter,
    notificationStatuses: state.notificationStatuses,
    notifyL2Cli: state.notifyL2Cli,
    favoriteModels: state.favoriteModels,
    recentModels: state.recentModels,
  };
}

if (hasBridge()) {
  void readBridge()
    .getSharedSettings()
    .then((settings) => {
      const normalized = normalizeSharedSettings(settings);
      useSharedSettings.setState((state) => ({
        ...state,
        ...normalized,
        sharedSettingsHydrated: true,
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      initialLoadDone = true;
    })
    .catch(() => {
      initialLoadDone = true;
      useSharedSettings.setState({ sharedSettingsHydrated: true });
    });
}
