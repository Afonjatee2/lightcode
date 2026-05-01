import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";

const { sharedSettingsState, toastMock } = vi.hoisted(() => ({
  sharedSettingsState: {
    current: {
      notificationsEnabled: true,
      notificationSound: true,
      notificationFilter: "unfocused",
      notificationStatuses: { done: true, needsAttention: true, error: true },
    },
  },
  toastMock: {
    danger: vi.fn<(title: string, options: unknown) => void>(),
    success: vi.fn<(title: string, options: unknown) => void>(),
    warning: vi.fn<(title: string, options: unknown) => void>(),
  },
}));

vi.mock("@heroui/react", () => ({
  toast: toastMock,
}));

vi.mock("@/renderer/actions/threadActions", () => ({
  openThread: vi.fn<() => void>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    focusWindow: vi.fn<() => void>(),
  }),
}));

vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: {
    getState: () => ({
      view: { kind: "home" },
      projects: [],
    }),
  },
}));

vi.mock("@/renderer/state/sharedSettingsStore", () => ({
  useSharedSettings: {
    getState: () => sharedSettingsState.current,
  },
}));

import {
  handleThreadStateNotification,
  shouldInspectThreadStateForNotification,
} from "./notifications";

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Thread",
    agentKind: "codex",
    config: { model: "gpt-5.4" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("shouldInspectThreadStateForNotification", () => {
  beforeEach(() => {
    sharedSettingsState.current = {
      notificationsEnabled: true,
      notificationSound: true,
      notificationFilter: "unfocused",
      notificationStatuses: { done: true, needsAttention: true, error: true },
    };
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    toastMock.danger.mockClear();
    toastMock.success.mockClear();
    toastMock.warning.mockClear();
  });

  it("skips focused hot-path work for the default unfocused-only setting", () => {
    expect(shouldInspectThreadStateForNotification()).toBe(false);
  });

  it("keeps unfocused native notification checks enabled", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    expect(shouldInspectThreadStateForNotification()).toBe(true);
  });

  it("keeps focused checks when in-app notifications are enabled", () => {
    sharedSettingsState.current = {
      ...sharedSettingsState.current,
      notificationFilter: "all",
    };

    expect(shouldInspectThreadStateForNotification()).toBe(true);
  });

  it("skips checks when every notification category is disabled", () => {
    sharedSettingsState.current = {
      ...sharedSettingsState.current,
      notificationStatuses: { done: false, needsAttention: false, error: false },
    };

    expect(shouldInspectThreadStateForNotification()).toBe(false);
  });
});

describe("handleThreadStateNotification", () => {
  beforeEach(() => {
    sharedSettingsState.current = {
      notificationsEnabled: true,
      notificationSound: false,
      notificationFilter: "all",
      notificationStatuses: { done: true, needsAttention: true, error: true },
    };
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    toastMock.danger.mockClear();
    toastMock.success.mockClear();
    toastMock.warning.mockClear();
  });

  it("does not notify for attention-only updates when status is unchanged", () => {
    const oldThread = thread({ status: "idle", attention: "none" });

    handleThreadStateNotification(
      {
        type: "thread-state",
        threadId: oldThread.id,
        status: "idle",
        attention: "needs_reply",
      },
      oldThread,
      { status: "idle", attention: "needs_reply" },
    );

    expect(toastMock.warning).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.danger).not.toHaveBeenCalled();
  });

  it("uses the actual stored next status for done notifications", () => {
    const oldThread = thread({ status: "working", attention: "working" });

    handleThreadStateNotification(
      {
        type: "thread-state",
        threadId: oldThread.id,
        status: "idle",
        attention: "none",
      },
      oldThread,
      { status: "finished", attention: "none" },
    );

    expect(toastMock.success).toHaveBeenCalledWith(
      "Unknown project",
      expect.objectContaining({
        description: "Thread\nFinished · Waiting for your input",
      }),
    );
  });
});
