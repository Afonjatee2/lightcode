import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/renderer/state/appStore";
import { toggleMarkThreadDone } from "./threadActions";

const { bridge } = vi.hoisted(() => ({
  bridge: {
    closeThread: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
}));

describe("threadActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAppStore.setState((state) => ({
      ...state,
      projects: [],
      threads: [],
      pendingServerRequests: [],
      view: { kind: "home" },
    }));
  });

  it("closes a live CLI thread when marking done even before a session ref is known", async () => {
    const project = useAppStore.getState().addProject({
      kind: "posix",
      path: "/repo",
    });
    const thread = useAppStore.getState().createThread({
      projectId: project.id,
      agentKind: "codex",
      config: { model: "gpt-5.4" },
      prompt: "hello",
    });
    useAppStore.getState().updateThreadRuntime(thread.id, {
      status: "working",
      attention: "working",
      canResumeWithConfig: false,
    });

    toggleMarkThreadDone(thread.id);

    expect(bridge.closeThread).toHaveBeenCalledWith({ threadId: thread.id });
    expect(useAppStore.getState().threads[0]?.done).toBe(true);

    await Promise.resolve();

    expect(useAppStore.getState().threads[0]?.status).toBe("inactive");
  });
});
