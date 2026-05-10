import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadConfig } from "@/shared/contracts";
import { AppProvider } from "@/renderer/components/ui/provider";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useThreadTodoDockStore } from "@/renderer/state/threadTodoDockStore";
import { ThreadView } from "./ThreadView";

const { bridge } = vi.hoisted(() => ({
  bridge: {
    startThread: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    interruptThread: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    setPendingSteer: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    clearPendingSteer: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    writeTerminal: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    searchProjectFiles: vi
      .fn<() => Promise<{ entries: unknown[]; totalIndexed: number }>>()
      .mockResolvedValue({ entries: [], totalIndexed: 0 }),
    dbGetThreadRuntimeItems: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  },
}));

vi.mock("../../bridge", () => ({
  readBridge: () => bridge,
  isDevApp: () => false,
}));

vi.mock("./TerminalPane", () => ({
  TerminalPane: (props: { onTerminalResize?: (size: { cols: number; rows: number }) => void }) => (
    <div>
      terminal pane
      <button onClick={() => props.onTerminalResize?.({ cols: 120, rows: 40 })} type="button">
        report terminal size
      </button>
    </div>
  ),
}));

function renderThreadView(props: Parameters<typeof ThreadView>[0]) {
  return render(
    <AppProvider>
      <ThreadView {...props} />
    </AppProvider>,
  );
}

describe("ThreadView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSharedSettings.setState({ collapseTerminalComposer: false });
    useThreadTodoDockStore.setState({
      defaultPlacement: "composer",
      defaultCollapsed: false,
      byThreadId: {},
    });
    useAppStore.setState({
      runtimeItemIdsByThread: {},
      runtimeItemsByIdByThread: {},
      runtimeRequestsByThread: {},
    });
  });

  it("starts a queued launch after the terminal reports its first size", async () => {
    const onLaunchConsumed = vi.fn<() => void>();

    renderThreadView({
      thread: {
        id: "thread-launch",
        projectId: "project-1",
        title: "Queued Codex thread",
        agentKind: "codex",
        config: {
          model: "gpt-5.4",
        },
        status: "launching",
        attention: "none",
        canResumeWithConfig: false,
        archived: false,
        done: false,
        starred: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "codex",
        label: "Codex",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "terminal",
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingLaunchPrompt: "hi",
      pendingServerRequests: [],
      onConfigChange: () => undefined,
      onLaunchConsumed,
      onResolveServerRequest: async () => undefined,
      onSubmitInput: async () => undefined,
    });

    expect(bridge.startThread).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("report terminal size"));

    await waitFor(() => {
      expect(onLaunchConsumed).toHaveBeenCalledTimes(1);
      expect(bridge.startThread).toHaveBeenCalledWith({
        threadId: "thread-launch",
        projectLocation: {
          kind: "windows",
          path: "C:\\repo",
        },
        agentKind: "codex",
        config: {
          model: "gpt-5.4",
        },
        prompt: "hi",
        initialSize: {
          cols: 120,
          rows: 40,
        },
      });
    });
  });

  it("forwards launch rejection messages to the launch failure callback", async () => {
    bridge.startThread.mockRejectedValueOnce(new Error("launcher boom"));
    const onLaunchConsumed = vi.fn<() => void>();
    const onLaunchFailed = vi.fn<(message: string) => void>();

    renderThreadView({
      thread: {
        id: "thread-launch-error",
        projectId: "project-1",
        title: "Queued Codex thread",
        agentKind: "codex",
        config: {
          model: "gpt-5.4",
        },
        status: "launching",
        attention: "none",
        canResumeWithConfig: false,
        archived: false,
        done: false,
        starred: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "codex",
        label: "Codex",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "terminal",
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingLaunchPrompt: "hi",
      pendingServerRequests: [],
      onConfigChange: () => undefined,
      onLaunchConsumed,
      onLaunchFailed,
      onResolveServerRequest: async () => undefined,
      onSubmitInput: async () => undefined,
    });

    fireEvent.click(screen.getByText("report terminal size"));

    await waitFor(() => {
      expect(onLaunchConsumed).toHaveBeenCalledTimes(1);
      expect(onLaunchFailed).toHaveBeenCalledWith("launcher boom");
    });
  });

  it("renders a server-mode composer for Codex live threads", () => {
    renderThreadView({
      thread: {
        id: "thread-1",
        projectId: "project-1",
        title: "Codex thread",
        agentKind: "codex",
        config: {
          model: "gpt-5.4",
        },
        status: "idle",
        attention: "none",
        canResumeWithConfig: true,
        archived: false,
        done: false,
        starred: false,
        sessionRef: {
          providerSessionId: "session-1",
          discoveredAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "codex",
        label: "Codex",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "terminal",
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingServerRequests: [],
      onConfigChange: () => undefined,
      onResolveServerRequest: async () => undefined,
      onSubmitInput: async () => undefined,
    });

    expect(
      screen.getByPlaceholderText("Ask Codex anything about this workspace"),
    ).toBeInTheDocument();
    expect(screen.getByText("terminal pane")).toBeInTheDocument();
  });

  it("disables the composer for inactive Codex threads", () => {
    renderThreadView({
      thread: {
        id: "thread-inactive",
        projectId: "project-1",
        title: "Inactive Codex thread",
        agentKind: "codex",
        config: {
          model: "gpt-5.4",
        },
        status: "inactive",
        attention: "none",
        canResumeWithConfig: false,
        archived: false,
        done: false,
        starred: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "codex",
        label: "Codex",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "terminal",
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingServerRequests: [],
      onConfigChange: () => undefined,
      onResolveServerRequest: async () => undefined,
      onSubmitInput: async () => undefined,
    });

    expect(screen.getByPlaceholderText("Ask Codex anything about this workspace")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("shows a loading overlay without the composer while a terminal Codex thread is launching", () => {
    renderThreadView({
      thread: {
        id: "thread-launching",
        projectId: "project-1",
        title: "Launching Codex thread",
        agentKind: "codex",
        config: {
          model: "gpt-5.4",
        },
        status: "launching",
        attention: "none",
        canResumeWithConfig: false,
        archived: false,
        done: false,
        starred: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "codex",
        label: "Codex",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "terminal",
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingServerRequests: [],
      onConfigChange: () => undefined,
      onResolveServerRequest: async () => undefined,
      onSubmitInput: async () => undefined,
    });

    expect(screen.getByRole("img", { name: "Loading" })).toBeInTheDocument();
    // Terminal composer stays hidden during launching — only the loader overlay is visible.
    expect(
      screen.queryByPlaceholderText("Ask Codex anything about this workspace"),
    ).not.toBeInTheDocument();
  });

  it("keeps the GUI ACP composer visible but send-disabled while reconnecting", () => {
    renderThreadView({
      thread: {
        id: "thread-gui-launching",
        projectId: "project-1",
        title: "Launching GUI Codex thread",
        agentKind: "codex",
        config: {
          model: "gpt-5.4",
        },
        status: "launching",
        attention: "none",
        canResumeWithConfig: true,
        presentationMode: "gui",
        sessionRef: {
          providerSessionId: "session-gui-launching",
          discoveredAt: new Date().toISOString(),
        },
        archived: false,
        done: false,
        starred: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "codex",
        label: "Codex",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingServerRequests: [],
      onConfigChange: () => undefined,
      onResolveServerRequest: async () => undefined,
      onSubmitInput: async () => undefined,
    });

    expect(screen.queryByText("terminal pane")).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Ask Codex anything about this workspace"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Send message")).toBeDisabled();
  });

  it("renders server request UI instead of the composer while Codex is waiting", () => {
    renderThreadView({
      thread: {
        id: "thread-1",
        projectId: "project-1",
        title: "Codex thread",
        agentKind: "codex",
        config: {
          model: "gpt-5.4",
        },
        status: "needs_reply",
        attention: "needs_reply",
        canResumeWithConfig: true,
        archived: false,
        done: false,
        starred: false,
        sessionRef: {
          providerSessionId: "session-1",
          discoveredAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "codex",
        label: "Codex",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "terminal",
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingServerRequests: [
        {
          threadId: "thread-1",
          requestId: "request-1",
          method: "item/tool/requestUserInput",
          params: {
            questions: [
              {
                id: "repo_name",
                header: "Repository",
                question: "Which repository should Codex inspect?",
                isOther: false,
                isSecret: false,
                options: null,
              },
            ],
          },
          receivedAt: new Date().toISOString(),
        },
      ],
      onConfigChange: () => undefined,
      onResolveServerRequest: async () => undefined,
      onSubmitInput: async () => undefined,
    });

    expect(screen.getByText("Input requested")).toBeInTheDocument();
  });

  it("resolves ACP permission requests with the selected option id", async () => {
    const onResolveServerRequest = vi
      .fn<
        (input: { requestId: string | number; method: string; response: unknown }) => Promise<void>
      >()
      .mockResolvedValue(undefined);

    renderThreadView({
      thread: {
        id: "thread-acp-request",
        projectId: "project-1",
        title: "Gemini thread",
        agentKind: "gemini",
        config: {
          model: "gemini-3-flash-preview",
        },
        status: "needs_approval",
        attention: "needs_approval",
        canResumeWithConfig: true,
        archived: false,
        done: false,
        starred: false,
        sessionRef: {
          providerSessionId: "session-1",
          discoveredAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "gemini",
        label: "Gemini",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "gemini-3-flash-preview", label: "Gemini 3 Flash" }],
          efforts: [],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "default", label: "Default" }],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "terminal",
          presentationMode: "terminal",
          presentationModes: ["terminal", "gui"],
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingServerRequests: [
        {
          threadId: "thread-acp-request",
          requestId: "acp-perm-1",
          method: "requestPermission",
          params: {
            toolCall: {
              toolCallId: "tool-1",
              kind: "execute",
              title: "echo hi",
              rawInput: { command: "echo hi" },
            },
            options: [
              { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
              { optionId: "reject_once", name: "Reject", kind: "reject_once" },
            ],
          },
          receivedAt: new Date().toISOString(),
        },
      ],
      onConfigChange: () => undefined,
      onResolveServerRequest,
      onSubmitInput: async () => undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    await waitFor(() => {
      expect(onResolveServerRequest).toHaveBeenCalledWith({
        requestId: "acp-perm-1",
        method: "requestPermission",
        response: { optionId: "allow_once" },
      });
    });
  });

  it("keeps Claude live threads terminal-driven", () => {
    renderThreadView({
      thread: {
        id: "thread-2",
        projectId: "project-1",
        title: "Claude thread",
        agentKind: "claude",
        config: {
          model: "sonnet",
        },
        status: "idle",
        attention: "none",
        canResumeWithConfig: true,
        archived: false,
        done: false,
        starred: false,
        sessionRef: {
          providerSessionId: "session-2",
          discoveredAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "claude",
        label: "Claude Code",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "sonnet", label: "Sonnet" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "default", label: "Default" }],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "terminal",
          presentationMode: "terminal",
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingServerRequests: [],
      onConfigChange: () => undefined,
      onResolveServerRequest: async () => undefined,
      onSubmitInput: async () => undefined,
    });

    expect(
      screen.queryByPlaceholderText("Ask Codex anything about this workspace"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("terminal pane")).toBeInTheDocument();
  });

  it("hides the terminal pane for server-backed GUI presentation", () => {
    renderThreadView({
      thread: {
        id: "thread-gui",
        projectId: "project-1",
        title: "GUI Codex thread",
        agentKind: "codex",
        config: {
          model: "gpt-5.4",
        },
        status: "idle",
        attention: "none",
        canResumeWithConfig: true,
        archived: false,
        done: false,
        starred: false,
        sessionRef: {
          providerSessionId: "session-gui",
          discoveredAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "codex",
        label: "Codex",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingServerRequests: [],
      onConfigChange: () => undefined,
      onResolveServerRequest: async () => undefined,
      onSubmitInput: async () => undefined,
    });

    expect(screen.queryByText("terminal pane")).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Ask Codex anything about this workspace"),
    ).toBeInTheDocument();
  });

  it("uses the ACP composer controls for per-thread GUI presentation", () => {
    useSharedSettings.setState({ collapseTerminalComposer: true });
    const onConfigChange = vi.fn<(config: ThreadConfig) => void>();

    renderThreadView({
      thread: {
        id: "thread-gui-codex",
        projectId: "project-1",
        title: "GUI Codex thread",
        agentKind: "codex",
        config: {
          model: "gpt-5.4",
          effort: "medium",
          approvalPolicy: "never",
          sandboxMode: "danger-full-access",
        },
        status: "idle",
        attention: "none",
        canResumeWithConfig: true,
        archived: false,
        done: false,
        starred: false,
        presentationMode: "gui",
        sessionRef: {
          providerSessionId: "session-gui",
          discoveredAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "codex",
        label: "Codex",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low", "medium"],
          modelEfforts: {},
          fastModels: ["gpt-5.4"],
          modes: ["agent"],
          approvalPolicies: [
            { id: "on-request", label: "On Request" },
            { id: "on-failure", label: "On Failure" },
            { id: "never", label: "Never" },
          ],
          sandboxModes: [
            { id: "read-only", label: "Read Only" },
            { id: "workspace-write", label: "Workspace Write" },
            { id: "danger-full-access", label: "Danger Full Access" },
          ],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "terminal",
          presentationMode: "terminal",
          presentationModes: ["terminal", "gui"],
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingServerRequests: [],
      onConfigChange,
      onResolveServerRequest: async () => undefined,
      onSubmitInput: async () => undefined,
    });

    expect(screen.queryByText("terminal pane")).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Ask Codex anything about this workspace"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("5.4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Medium").length).toBeGreaterThan(0);
    expect(screen.queryByText("Normal")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Fast").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Plan").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Full access").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Collapse composer")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Show composer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "plan",
      }),
    );
  });

  it("shows the pinned todo dock for GUI plan items without duplicating the latest plan row in chat", () => {
    useAppStore.setState({
      runtimeItemIdsByThread: {
        "thread-gui-plan": ["plan-old", "plan-1"],
      },
      runtimeItemsByIdByThread: {
        "thread-gui-plan": {
          "plan-old": {
            id: "plan-old",
            type: "plan",
            state: "completed",
            payload: {
              steps: [{ step: "Old inline todo", status: "completed" }],
            },
            streams: {},
          },
          "plan-1": {
            id: "plan-1",
            type: "plan",
            state: "updated",
            payload: {
              steps: [
                { step: "Build ACP todo dock", status: "in_progress" },
                { step: "Wire ACP todo placement", status: "pending" },
              ],
            },
            streams: {},
          },
        },
      },
    });

    renderThreadView({
      thread: {
        id: "thread-gui-plan",
        projectId: "project-1",
        title: "GUI Copilot thread",
        agentKind: "copilot",
        config: {
          model: "gpt-5.4",
        },
        status: "working",
        attention: "working",
        canResumeWithConfig: true,
        archived: false,
        done: false,
        starred: false,
        presentationMode: "gui",
        sessionRef: {
          providerSessionId: "session-gui-plan",
          discoveredAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "copilot",
        label: "GitHub Copilot",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["high"],
          defaultEffort: "high",
          modelEfforts: {},
          modes: ["agent", "plan"],
          approvalPolicies: [{ id: "default", label: "Default" }],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingServerRequests: [],
      onConfigChange: () => undefined,
      onResolveServerRequest: async () => undefined,
      onSubmitInput: async () => undefined,
    });

    expect(screen.getByLabelText("Thread todo dock")).toHaveAttribute("data-placement", "composer");
    expect(screen.getAllByText("Build ACP todo dock")).toHaveLength(1);
    expect(screen.queryByText("Old inline todo")).not.toBeInTheDocument();
    expect(screen.queryByText("No messages yet")).not.toBeInTheDocument();
  });

  it("moves the pinned todo dock to the right rail and supports collapse", () => {
    useAppStore.setState({
      runtimeItemIdsByThread: {
        "thread-gui-plan": ["plan-1"],
      },
      runtimeItemsByIdByThread: {
        "thread-gui-plan": {
          "plan-1": {
            id: "plan-1",
            type: "plan",
            state: "updated",
            payload: {
              steps: [
                { step: "Build ACP todo dock", status: "in_progress" },
                { step: "Wire ACP todo placement", status: "pending" },
              ],
            },
            streams: {},
          },
        },
      },
    });

    renderThreadView({
      thread: {
        id: "thread-gui-plan",
        projectId: "project-1",
        title: "GUI Codex thread",
        agentKind: "codex",
        config: {
          model: "gpt-5.4",
        },
        status: "idle",
        attention: "none",
        canResumeWithConfig: true,
        archived: false,
        done: false,
        starred: false,
        presentationMode: "gui",
        sessionRef: {
          providerSessionId: "session-gui-plan",
          discoveredAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "codex",
        label: "Codex",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingServerRequests: [],
      onConfigChange: () => undefined,
      onResolveServerRequest: async () => undefined,
      onSubmitInput: async () => undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: "Move todo dock to right panel" }));
    expect(screen.getByLabelText("Thread todo dock")).toHaveAttribute("data-placement", "right");

    fireEvent.click(screen.getByRole("button", { name: "Collapse todo dock" }));
    expect(screen.getByLabelText("Thread todo dock")).toHaveAttribute("data-collapsed", "true");
    expect(screen.queryByText("Wire ACP todo placement")).not.toBeInTheDocument();
  });

  it("keeps todo dock placement and collapse scoped to each thread", () => {
    useAppStore.setState({
      runtimeItemIdsByThread: {
        "thread-gui-plan-a": ["plan-a"],
        "thread-gui-plan-b": ["plan-b"],
      },
      runtimeItemsByIdByThread: {
        "thread-gui-plan-a": {
          "plan-a": {
            id: "plan-a",
            type: "plan",
            state: "updated",
            payload: {
              steps: [
                { step: "Plan A active step", status: "in_progress" },
                { step: "Plan A pending step", status: "pending" },
              ],
            },
            streams: {},
          },
        },
        "thread-gui-plan-b": {
          "plan-b": {
            id: "plan-b",
            type: "plan",
            state: "updated",
            payload: {
              steps: [
                { step: "Plan B active step", status: "in_progress" },
                { step: "Plan B pending step", status: "pending" },
              ],
            },
            streams: {},
          },
        },
      },
    });

    const { rerender } = renderThreadView({
      thread: {
        id: "thread-gui-plan-a",
        projectId: "project-1",
        title: "GUI Codex thread A",
        agentKind: "codex",
        config: {
          model: "gpt-5.4",
        },
        status: "idle",
        attention: "none",
        canResumeWithConfig: true,
        archived: false,
        done: false,
        starred: false,
        presentationMode: "gui",
        sessionRef: {
          providerSessionId: "session-gui-plan-a",
          discoveredAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "codex",
        label: "Codex",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingServerRequests: [],
      onConfigChange: () => undefined,
      onResolveServerRequest: async () => undefined,
      onSubmitInput: async () => undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: "Move todo dock to right panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse todo dock" }));

    expect(screen.getByLabelText("Thread todo dock")).toHaveAttribute("data-placement", "right");
    expect(screen.getByLabelText("Thread todo dock")).toHaveAttribute("data-collapsed", "true");

    rerender(
      <AppProvider>
        <ThreadView
          thread={{
            id: "thread-gui-plan-b",
            projectId: "project-1",
            title: "GUI Codex thread B",
            agentKind: "codex",
            config: {
              model: "gpt-5.4",
            },
            status: "idle",
            attention: "none",
            canResumeWithConfig: true,
            archived: false,
            done: false,
            starred: false,
            presentationMode: "gui",
            sessionRef: {
              providerSessionId: "session-gui-plan-b",
              discoveredAt: new Date().toISOString(),
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }}
          agentStatus={{
            kind: "codex",
            label: "Codex",
            installed: true,
            authState: "authenticated",
            capabilities: {
              models: [{ id: "gpt-5.4", label: "5.4" }],
              efforts: ["low"],
              modelEfforts: {},
              modes: ["agent"],
              approvalPolicies: [{ id: "on-request", label: "On Request" }],
              sandboxModes: [{ id: "read-only", label: "Read Only" }],
              supportsResume: true,
              supportsDirectInput: true,
              liveInputMode: "server",
              presentationMode: "gui",
              settingDefs: [],
            },
          }}
          projectLocation={{
            kind: "windows",
            path: "C:\\repo",
          }}
          pendingServerRequests={[]}
          onConfigChange={() => undefined}
          onResolveServerRequest={async () => undefined}
          onSubmitInput={async () => undefined}
        />
      </AppProvider>,
    );

    expect(screen.getByLabelText("Thread todo dock")).toHaveAttribute("data-placement", "composer");
    expect(screen.getByLabelText("Thread todo dock")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByText("Plan B pending step")).toBeInTheDocument();
  });

  it("shows the runtime debug inspector toggle for GUI ACP threads in production builds", () => {
    renderThreadView({
      thread: {
        id: "thread-gui-debug",
        projectId: "project-1",
        title: "GUI Codex debug thread",
        agentKind: "codex",
        config: {
          model: "gpt-5.4",
        },
        status: "idle",
        attention: "none",
        canResumeWithConfig: true,
        archived: false,
        done: false,
        starred: false,
        presentationMode: "gui",
        sessionRef: {
          providerSessionId: "session-gui-debug",
          discoveredAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "codex",
        label: "Codex",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingServerRequests: [],
      onConfigChange: () => undefined,
      onResolveServerRequest: async () => undefined,
      onSubmitInput: async () => undefined,
    });

    const toggle = screen.getByRole("button", { name: "Show runtime debug panel" });

    expect(toggle).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(screen.getByText("Runtime debug")).toBeInTheDocument();
    expect(screen.getByText("No runtime items yet for this thread.")).toBeInTheDocument();
  });

  it("keeps send disabled while a Codex thread is running", () => {
    renderThreadView({
      thread: {
        id: "thread-3",
        projectId: "project-1",
        title: "Codex thread",
        agentKind: "codex",
        config: {
          model: "gpt-5.4",
        },
        status: "working",
        attention: "none",
        canResumeWithConfig: true,
        archived: false,
        done: false,
        starred: false,
        sessionRef: {
          providerSessionId: "session-3",
          discoveredAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "codex",
        label: "Codex",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "terminal",
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingServerRequests: [],
      onConfigChange: () => undefined,
      onResolveServerRequest: async () => undefined,
      onSubmitInput: async () => undefined,
    });

    const input = screen.getByPlaceholderText("Ask Codex anything about this workspace");
    input.textContent = "test";
    fireEvent.input(input);

    expect(screen.getByLabelText("Send message")).toBeDisabled();
  });

  it("allows queued follow-ups and stop while a GUI ACP thread is running", async () => {
    const onSubmitInput = vi
      .fn<(prompt: string, segments?: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);

    renderThreadView({
      thread: {
        id: "thread-gui-working",
        projectId: "project-1",
        title: "Codex GUI thread",
        agentKind: "codex",
        config: {
          model: "gpt-5.4",
        },
        status: "working",
        attention: "none",
        canResumeWithConfig: true,
        sessionRef: {
          providerSessionId: "session-gui",
          discoveredAt: new Date().toISOString(),
        },
        presentationMode: "gui",
        archived: false,
        done: false,
        starred: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      agentStatus: {
        kind: "codex",
        label: "Codex",
        installed: true,
        authState: "authenticated",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
          settingDefs: [],
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      pendingServerRequests: [],
      onConfigChange: () => undefined,
      onResolveServerRequest: async () => undefined,
      onSubmitInput,
    });

    // With empty input and agent working, stop button replaces send
    expect(screen.getByLabelText("Stop response")).toBeInTheDocument();

    const stopButton = screen.getByLabelText("Stop response");
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(bridge.interruptThread).toHaveBeenCalledWith({ threadId: "thread-gui-working" });
    });
    expect(stopButton.querySelector('[aria-label="Loading"]')).toBeInTheDocument();

    // After entering text, send button appears instead
    const input = screen.getByPlaceholderText("Ask Codex anything about this workspace");
    input.textContent = "test";
    fireEvent.input(input);

    expect(screen.getByLabelText("Send message")).not.toBeDisabled();
  });
});
