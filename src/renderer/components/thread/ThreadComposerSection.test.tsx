import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useThreadTodoDockStore } from "@/renderer/state/threadTodoDockStore";
import { ThreadComposerSection } from "./ThreadComposerSection";

vi.mock("../../bridge", () => ({
  readBridge: () => ({
    pickFiles: vi.fn<() => Promise<string[] | undefined>>().mockResolvedValue(undefined),
    setPendingSteer: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}));

vi.mock("./ThreadComposer", () => ({
  ThreadComposer: (props: {
    fixedContent?: ReactNode;
    inputContent?: ReactNode;
    onSubmit: () => void;
  }) => (
    <div>
      {props.fixedContent}
      {props.inputContent}
      <button type="button" onClick={props.onSubmit}>
        send
      </button>
    </div>
  ),
}));

const guiThread: Thread = {
  id: "thread-gui-idle",
  projectId: "project-1",
  title: "Codex GUI thread",
  agentKind: "codex",
  config: {
    model: "gpt-5.4",
  },
  status: "idle",
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
};

const codexGuiStatus: AgentStatus = {
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
};

describe("ThreadComposerSection", () => {
  beforeEach(() => {
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
      pendingSteerByThreadId: {},
    });
  });

  it("clears the GUI ACP composer as soon as a direct send starts", async () => {
    let resolveSubmit: (() => void) | undefined;
    const onSubmitInput = vi.fn<(prompt: string, segments?: unknown) => Promise<void>>(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        }),
    );

    render(
      <ThreadComposerSection
        threadId={guiThread.id}
        fallbackThread={guiThread}
        agentStatus={codexGuiStatus}
        projectLocation={{
          kind: "windows",
          path: "C:\\repo",
        }}
        paneCount={1}
        terminalPaneRef={{ current: null }}
        todoDockCollapsed={false}
        todoDockPlacement="composer"
        todoDockState={null}
        goalDockState={null}
        errorDockState={null}
        onGoalDockDismiss={() => undefined}
        onDismissError={() => undefined}
        onConfigChange={() => undefined}
        onResolveServerRequest={async () => undefined}
        onSubmitInput={onSubmitInput}
        onTodoDockCollapsedChange={() => undefined}
        onTodoDockPlacementChange={() => undefined}
      />,
    );

    const input = screen.getByRole("textbox");
    input.appendChild(document.createTextNode("slow send"));
    fireEvent.input(input);
    fireEvent.click(screen.getByText("send"));

    expect(input.textContent).toBe("");
    await waitFor(() => {
      expect(onSubmitInput).toHaveBeenCalledWith("slow send", [
        { kind: "text", content: "slow send" },
      ]);
    });

    await act(async () => {
      resolveSubmit?.();
      await Promise.resolve();
    });
  });

  it("keeps queued runtime approval requests actionable after resolving the first one", async () => {
    let resolveRequest: (() => void) | undefined;
    const onResolveServerRequest = vi.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    useAppStore.setState({
      runtimeRequestsByThread: {
        [guiThread.id]: [
          {
            requestId: "r1",
            threadId: guiThread.id,
            requestType: "command_execution_approval",
            payload: { summary: "Run first command" },
            receivedAt: new Date().toISOString(),
          },
          {
            requestId: "r2",
            threadId: guiThread.id,
            requestType: "command_execution_approval",
            payload: { summary: "Run second command" },
            receivedAt: new Date().toISOString(),
          },
        ],
      },
    });

    render(
      <ThreadComposerSection
        threadId={guiThread.id}
        fallbackThread={guiThread}
        agentStatus={codexGuiStatus}
        projectLocation={{
          kind: "windows",
          path: "C:\\repo",
        }}
        paneCount={1}
        terminalPaneRef={{ current: null }}
        todoDockCollapsed={false}
        todoDockPlacement="composer"
        todoDockState={null}
        goalDockState={null}
        errorDockState={null}
        onGoalDockDismiss={() => undefined}
        onDismissError={() => undefined}
        onConfigChange={() => undefined}
        onResolveServerRequest={onResolveServerRequest}
        onSubmitInput={async () => undefined}
        onTodoDockCollapsedChange={() => undefined}
        onTodoDockPlacementChange={() => undefined}
      />,
    );

    expect(screen.getByText("Run first command")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() => {
      expect(screen.getByText("Run second command")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Allow" })).toBeEnabled();

    await act(async () => {
      resolveRequest?.();
      await Promise.resolve();
    });
  });
});
