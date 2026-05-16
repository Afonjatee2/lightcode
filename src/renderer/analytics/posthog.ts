import type { PromptSegment, Thread, ThreadConfig } from "@/shared/contracts";
import { isThreadTurnActive } from "@/shared/contracts";
import {
  bucketCount,
  bucketDurationMs,
  sanitizeProductAnalyticsEvent,
  type ProductAnalyticsEventName,
  type ProductAnalyticsProperties,
} from "@/shared/analytics/posthogPrivacy";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useDevTerminalStore } from "@/renderer/state/devTerminalStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useSidebarOverlayStore } from "@/renderer/state/sidebarOverlayStore";

const INSTALL_ID_STORAGE_KEY = "lightcode-posthog-anonymous-id";
const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_BATCH_SIZE = 20;
const MAX_BUFFERED_EVENTS = 1_000;

interface ProductAnalyticsConfig {
  apiKey: string;
  host: string;
  enabled: boolean;
}

interface BufferedProductEvent {
  event: ProductAnalyticsEventName;
  properties: Record<string, string | number | boolean | null>;
  capturedAt: string;
}

type ThreadProductInput = Pick<
  Thread,
  "agentKind" | "config" | "presentationMode" | "sessionRef" | "worktreePath"
>;

let analyticsConfig: ProductAnalyticsConfig | null = null;
let installId: string | null = null;
const sessionId = crypto.randomUUID();
const buffer: BufferedProductEvent[] = [];
let flushPromise: Promise<void> | null = null;

function readBuildEnv(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readBooleanBuildEnv(value: unknown): boolean | null {
  const text = readBuildEnv(value);
  if (!text) return null;
  return text !== "0" && text !== "false";
}

function readBuildPostHogKey(): string {
  return readBuildEnv(import.meta.env.VITE_POSTHOG_KEY);
}

function readBuildPostHogHost(): string {
  return readBuildEnv(import.meta.env.VITE_POSTHOG_HOST);
}

function readBuildPostHogEnabled(): boolean | null {
  return readBooleanBuildEnv(import.meta.env.VITE_POSTHOG_ENABLED);
}

function readBuildPostHogEnableDev(): boolean | null {
  return readBooleanBuildEnv(import.meta.env.VITE_POSTHOG_ENABLE_DEV);
}

function readRuntimePostHogEnabled(value: boolean | undefined): boolean {
  return value !== false;
}

function resolvePostHogConfig(): ProductAnalyticsConfig {
  const bridge = readBridge();
  const runtimeKey = bridge.posthogKey?.trim() ?? "";
  const buildKey = readBuildPostHogKey();
  const apiKey = runtimeKey || buildKey;
  const host = bridge.posthogHost?.trim() || readBuildPostHogHost() || "https://us.i.posthog.com";
  const explicitEnabled = readBuildPostHogEnabled();
  const enableDev = bridge.posthogEnableDev === true || readBuildPostHogEnableDev() === true;
  const enabled =
    Boolean(apiKey) &&
    readRuntimePostHogEnabled(bridge.posthogEnabled) &&
    explicitEnabled !== false &&
    (!bridge.isDev || enableDev || bridge.posthogEnableDev);

  return {
    apiKey,
    host: host.replace(/\/+$/, ""),
    enabled,
  };
}

function readInstallId(): string {
  try {
    const existing = localStorage.getItem(INSTALL_ID_STORAGE_KEY);
    if (existing) return existing;
    const next = crypto.randomUUID();
    localStorage.setItem(INSTALL_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}

function ensureConfig(): ProductAnalyticsConfig | null {
  if (!analyticsConfig) {
    analyticsConfig = resolvePostHogConfig();
  }
  if (!analyticsConfig.enabled) return null;
  installId ??= readInstallId();
  return installId ? analyticsConfig : null;
}

function buildBaseProperties(): ProductAnalyticsProperties {
  const bridge = readBridge();
  return {
    $process_person_profile: false,
    app_version: bridge.appVersion,
    arch: bridge.arch,
    channel: bridge.channel,
    chrome: bridge.chromeVersion,
    electron: bridge.electronVersion,
    is_dev: bridge.isDev,
    node: bridge.nodeVersion,
    platform: bridge.platform,
    session_id: sessionId,
  };
}

function enqueue(event: BufferedProductEvent): void {
  buffer.push(event);
  if (buffer.length > MAX_BUFFERED_EVENTS) {
    buffer.splice(0, buffer.length - MAX_BUFFERED_EVENTS);
  }
  if (buffer.length >= FLUSH_BATCH_SIZE) {
    void flushProductAnalytics();
  }
}

export function captureProductEvent(
  event: ProductAnalyticsEventName,
  properties: ProductAnalyticsProperties = {},
): void {
  const activeConfig = ensureConfig();
  if (!activeConfig || !installId) return;
  const sanitized = sanitizeProductAnalyticsEvent(event, {
    ...buildBaseProperties(),
    ...properties,
  });
  if (!sanitized) return;
  enqueue({
    event: sanitized.event,
    properties: sanitized.properties,
    capturedAt: new Date().toISOString(),
  });
}

async function flushProductAnalyticsBatch(): Promise<void> {
  const activeConfig = ensureConfig();
  if (!activeConfig || !installId || buffer.length === 0) return;

  const batch = buffer.splice(0, FLUSH_BATCH_SIZE);
  try {
    const response = await fetch(`${activeConfig.host}/batch/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        api_key: activeConfig.apiKey,
        batch: batch.map((item) => ({
          event: item.event,
          distinct_id: installId,
          properties: item.properties,
          timestamp: item.capturedAt,
        })),
      }),
    });
    if (!response.ok) {
      throw new Error(`PostHog batch failed with status ${response.status}`);
    }
  } catch {
    buffer.unshift(...batch);
    if (buffer.length > MAX_BUFFERED_EVENTS) {
      buffer.splice(MAX_BUFFERED_EVENTS);
    }
  }
}

export async function flushProductAnalytics(): Promise<void> {
  if (flushPromise) {
    await flushPromise;
    return;
  }

  flushPromise = flushProductAnalyticsBatch().finally(() => {
    flushPromise = null;
  });
  await flushPromise;
}

function viewProperties(): ProductAnalyticsProperties {
  const view = useAppStore.getState().view;
  return {
    view_kind: view.kind,
    pane_count: view.kind === "thread" ? view.panes.length : 0,
  };
}

function appSummaryProperties(): ProductAnalyticsProperties {
  const state = useAppStore.getState();
  const worktreeCount = new Set(state.threads.flatMap((thread) => thread.worktreePath ?? [])).size;
  return {
    ...viewProperties(),
    project_count: state.projects.length,
    thread_count: state.threads.length,
    worktree_count_bucket: bucketCount(worktreeCount),
    position: useSharedSettings.getState().terminalPosition,
  };
}

function segmentProperties(
  segments: readonly PromptSegment[] | undefined,
): ProductAnalyticsProperties {
  const counts = { text: 0, file: 0, attachment: 0 };
  for (const segment of segments ?? []) {
    counts[segment.kind] += 1;
  }
  return {
    attachment_segment_count: counts.attachment,
    file_segment_count: counts.file,
    segment_count: (segments ?? []).length,
    text_segment_count: counts.text,
  };
}

function threadConfigProperties(config: ThreadConfig): ProductAnalyticsProperties {
  return {
    effort: config.effort || "default",
    fast: config.fast === true,
    has_context_size: Boolean(config.contextSize),
    has_effort: Boolean(config.effort),
    mode: config.mode ?? "default",
    thinking: config.thinking === true,
  };
}

export function threadProductProperties(
  thread: ThreadProductInput,
  segments?: readonly PromptSegment[],
): ProductAnalyticsProperties {
  const presentation = thread.presentationMode ?? "terminal";
  return {
    ...threadConfigProperties(thread.config),
    ...segmentProperties(segments),
    has_session_ref: Boolean(thread.sessionRef),
    has_worktree: Boolean(thread.worktreePath),
    presentation,
    provider: thread.agentKind,
    runtime_kind: presentation === "gui" ? "structured" : "pty",
  };
}

export function captureAppStarted(): void {
  captureProductEvent("app.started", appSummaryProperties());
}

export function captureThreadStarted(
  thread: ThreadProductInput,
  segments?: readonly PromptSegment[],
): void {
  captureProductEvent("thread.started", threadProductProperties(thread, segments));
}

export function captureThreadInputSubmitted(
  thread: ThreadProductInput,
  segments?: readonly PromptSegment[],
): void {
  captureProductEvent("thread.input_submitted", threadProductProperties(thread, segments));
}

function outcomeForStatus(status: Thread["status"]): string {
  if (status === "error") return "error";
  if (status === "needs_approval") return "needs_approval";
  if (status === "needs_reply") return "needs_reply";
  if (status === "idle" || status === "finished") return "completed";
  return status;
}

function installStoreSubscriptions(): () => void {
  const disposers: Array<() => void> = [];
  let currentViewStartedAt = Date.now();
  let rightPanelOpen = computeRightPanelOpen();
  const captureRightPanelChange = () => {
    const next = computeRightPanelOpen();
    if (next === rightPanelOpen) return;
    rightPanelOpen = next;
    captureProductEvent("ui.right_panel_toggled", {
      open: next,
      position: useSharedSettings.getState().terminalPosition,
      tab: usePanelStore.getState().rightPanelTab,
    });
  };

  disposers.push(
    useAppStore.subscribe((state, prevState) => {
      if (state.view !== prevState.view) {
        const now = Date.now();
        const durationMs = now - currentViewStartedAt;
        currentViewStartedAt = now;
        captureProductEvent("app.view_duration", {
          ...viewProperties(),
          duration_bucket: bucketDurationMs(durationMs),
          duration_ms: durationMs,
        });
        captureProductEvent("app.view_changed", viewProperties());
      }

      const previousThreads = new Map(prevState.threads.map((thread) => [thread.id, thread]));
      for (const thread of state.threads) {
        const previous = previousThreads.get(thread.id);
        if (previous && isThreadTurnActive(previous.status) && !isThreadTurnActive(thread.status)) {
          const startedAt = previous.activeTurnStartedAt
            ? new Date(previous.activeTurnStartedAt).getTime()
            : NaN;
          const durationMs = Number.isFinite(startedAt) ? Date.now() - startedAt : 0;
          captureProductEvent("thread.turn_completed", {
            ...threadProductProperties(thread),
            attention: thread.attention,
            duration_bucket: bucketDurationMs(durationMs),
            duration_ms: durationMs,
            outcome: outcomeForStatus(thread.status),
            status: thread.status,
          });
        }
      }
    }),
  );

  disposers.push(
    usePanelStore.subscribe((state, prevState) => {
      if (state.rightPanelTab !== prevState.rightPanelTab) {
        captureProductEvent("ui.right_panel_tab_changed", { tab: state.rightPanelTab });
      }
      if (state.gitOverlayOpen !== prevState.gitOverlayOpen) {
        captureProductEvent("git.overlay_toggled", {
          open: state.gitOverlayOpen,
          overlay_mode: state.gitOverlayOpen ? "fullscreen" : "closed",
        });
      }
      if (state.settingsOpen && !prevState.settingsOpen) {
        captureProductEvent("settings.opened");
      }
      if (state.threadSearchOpen !== prevState.threadSearchOpen) {
        captureProductEvent("ui.thread_search_toggled", { open: state.threadSearchOpen });
      }
      captureRightPanelChange();
    }),
  );

  disposers.push(
    useDevTerminalStore.subscribe(() => {
      captureRightPanelChange();
    }),
  );

  disposers.push(
    useSharedSettings.subscribe((state, prevState) => {
      if (state.terminalPosition !== prevState.terminalPosition) {
        captureProductEvent("ui.right_panel_toggled", {
          open: computeRightPanelOpen(),
          position: state.terminalPosition,
          tab: usePanelStore.getState().rightPanelTab,
        });
      }
      captureRightPanelChange();
    }),
  );

  disposers.push(
    useSidebarOverlayStore.subscribe((state, prevState) => {
      if (state.isCollapsed !== prevState.isCollapsed) {
        captureProductEvent("ui.sidebar_toggled", { collapsed: state.isCollapsed });
      }
    }),
  );

  disposers.push(
    useFileEditorStore.subscribe((state, prevState) => {
      if (state.overlayMode !== prevState.overlayMode) {
        captureProductEvent("file.overlay_toggled", {
          open: state.overlayMode !== null,
          overlay_mode: state.overlayMode ?? "closed",
        });
      }
    }),
  );

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      void flushProductAnalytics();
    }
  };
  const handlePageHide = () => {
    void flushProductAnalytics();
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pagehide", handlePageHide);

  return () => {
    for (const dispose of disposers) dispose();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pagehide", handlePageHide);
  };
}

function computeRightPanelOpen(): boolean {
  const terminalPosition = useSharedSettings.getState().terminalPosition;
  const devTerminalOpen = useDevTerminalStore.getState().isOpen;
  const panelState = usePanelStore.getState();
  const gitPanelOpen = Boolean(panelState.gitReviewContext) && panelState.gitReviewAsPanel;
  const filesPanelOpen = panelState.filesPanelContext !== null;
  return terminalPosition === "right"
    ? devTerminalOpen || gitPanelOpen || filesPanelOpen
    : devTerminalOpen;
}

export function installProductAnalytics(): () => void {
  analyticsConfig = resolvePostHogConfig();
  if (!analyticsConfig.enabled) return () => {};
  installId = readInstallId();
  const unsubscribe = installStoreSubscriptions();
  const intervalId = window.setInterval(() => {
    void flushProductAnalytics();
  }, FLUSH_INTERVAL_MS);
  return () => {
    unsubscribe();
    window.clearInterval(intervalId);
    void flushProductAnalytics();
  };
}
