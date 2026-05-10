import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus, Project, Thread } from "@/shared/contracts";
import { AppProvider } from "@/renderer/components/ui/provider";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { ThreadDraftComposerArea } from "./ThreadDraftComposerArea";
import { ThreadView } from "./ThreadView";

const { bridge } = vi.hoisted(() => ({
  bridge: {
    searchProjectFiles: vi
      .fn<() => Promise<{ entries: []; totalIndexed: number }>>()
      .mockResolvedValue({ entries: [], totalIndexed: 0 }),
    dbGetThreadRuntimeItems: vi.fn<() => Promise<[]>>().mockResolvedValue([]),
    pickFiles: vi.fn<() => Promise<string[] | undefined>>().mockResolvedValue(undefined),
    writeTerminal: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));

vi.mock("../../bridge", () => ({
  readBridge: () => bridge,
  isDevApp: () => false,
}));

vi.mock("./TerminalPane", () => ({
  TerminalPane: () => <div>terminal pane</div>,
}));

function mockSelection(node: Node, offset: number) {
  const selection = {
    isCollapsed: true,
    anchorNode: node,
    anchorOffset: offset,
    focusNode: node,
    focusOffset: offset,
    rangeCount: 1,
    getRangeAt: () => {
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, offset);
      return range;
    },
    removeAllRanges: vi.fn<() => void>(),
    addRange: vi.fn<(range: Range) => void>(),
  };
  vi.stubGlobal("getSelection", () => selection);
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "ACP chat",
    agentKind: "gemini",
    config: { model: "gemini-2.5-pro" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: true,
    archived: false,
    done: false,
    starred: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    presentationMode: "gui",
    ...overrides,
  };
}

function makeAgentStatus(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    kind: "gemini",
    label: "Gemini",
    installed: true,
    authState: "authenticated",
    capabilities: {
      models: [{ id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }],
      efforts: [],
      modelEfforts: {},
      modes: ["agent"],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: true,
      supportsDirectInput: true,
      liveInputMode: "server",
      presentationMode: "gui",
      presentationModes: ["gui"],
      settingDefs: [],
      slashCommands: [{ id: "help", label: "help — Show help", description: "Show help" }],
    },
    ...overrides,
  };
}

const draftProject: Project = {
  id: "project-1",
  name: "Lightcode",
  location: { kind: "posix", path: "/tmp/lightcode" },
  createdAt: new Date().toISOString(),
};

function renderThread(thread: Thread, agentStatus: AgentStatus) {
  render(
    <AppProvider>
      <ThreadView
        thread={thread}
        agentStatus={agentStatus}
        projectLocation={{ kind: "posix", path: "/tmp/lightcode" }}
        pendingServerRequests={[]}
        onConfigChange={() => {}}
        onResolveServerRequest={async () => {}}
        onSubmitInput={async () => {}}
      />
    </AppProvider>,
  );
}

function renderDraftComposer(
  selectedAgent: AgentStatus,
  onStart = vi.fn<(input: unknown) => void>(),
) {
  render(
    <AppProvider>
      <ThreadDraftComposerArea
        project={draftProject}
        selectedAgent={selectedAgent}
        controls={[]}
        config={{ model: selectedAgent.capabilities.models[0]?.id ?? "gemini-2.5-pro" }}
        compact={false}
        paneCount={1}
        gitBranch={undefined}
        worktreeMode={false}
        supportsModePicker={false}
        presentationMode="terminal"
        onWorktreeModeChange={() => {}}
        onSwitchBranch={() => {}}
        onRememberPresentationMode={() => {}}
        onStart={onStart}
      />
    </AppProvider>,
  );
  return onStart;
}

function typeSlashQuery(editor: HTMLElement, query: string) {
  const textNode = document.createTextNode(query);
  editor.innerHTML = "";
  editor.appendChild(textNode);
  mockSelection(textNode, query.length);
  fireEvent.input(editor);
}

describe("ThreadSlashCommands", () => {
  const scrollIntoView = vi.fn<(options?: ScrollIntoViewOptions) => void>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    useAppStore.getState().clearDraftContent(draftProject.id);
    useSharedSettings.setState({ collapseTerminalComposer: false });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
  });

  it("renders thread-scoped ACP slash commands in the composer panel", () => {
    renderThread(
      makeThread({
        slashCommands: [
          {
            id: "review",
            label: "review — Review the diff",
            description: "Review the diff",
          },
          {
            id: "plan",
            label: "plan — Draft a plan",
            description: "Draft a plan",
          },
        ],
      }),
      makeAgentStatus(),
    );

    const editor = screen.getByRole("textbox");
    typeSlashQuery(editor, "/re");

    expect(screen.getByText("Commands")).toBeInTheDocument();
    expect(screen.getByText("/review")).toBeInTheDocument();
    expect(screen.queryByText("/help")).not.toBeInTheDocument();
  });

  it("supports keyboard navigation, scrolling, and insertion", () => {
    renderThread(
      makeThread({
        slashCommands: [
          {
            id: "plan",
            label: "plan — Draft a plan",
            description: "Draft a plan",
          },
          {
            id: "review",
            label: "review — Review the diff",
            description: "Review the diff",
          },
        ],
      }),
      makeAgentStatus(),
    );

    const editor = screen.getByRole("textbox");
    typeSlashQuery(editor, "/");

    scrollIntoView.mockClear();
    fireEvent.keyDown(editor, { key: "ArrowDown" });

    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(scrollIntoView).toHaveBeenCalled();

    fireEvent.keyDown(editor, { key: "Enter" });

    expect(screen.queryByText("Commands")).not.toBeInTheDocument();
    expect(editor.textContent).toBe("/review ");
  });

  it("renders thread-scoped slash commands in the terminal composer", () => {
    const baseCapabilities = makeAgentStatus().capabilities;
    renderThread(
      makeThread({
        presentationMode: "terminal",
        slashCommands: [
          {
            id: "review",
            label: "review — Review the diff",
            description: "Review the diff",
          },
        ],
      }),
      makeAgentStatus({
        capabilities: {
          ...baseCapabilities,
          liveInputMode: "terminal",
          presentationMode: "terminal",
          presentationModes: ["terminal"],
          slashCommands: [{ id: "help", label: "help — Show help", description: "Show help" }],
        },
      }),
    );

    const editor = screen.getByRole("textbox");
    typeSlashQuery(editor, "/re");

    expect(screen.getByText("Commands")).toBeInTheDocument();
    expect(screen.getByText("/review")).toBeInTheDocument();
    expect(screen.queryByText("/help")).not.toBeInTheDocument();
  });

  it("falls back to capability slash commands in the terminal composer", () => {
    const baseCapabilities = makeAgentStatus().capabilities;
    renderThread(
      makeThread({ presentationMode: "terminal" }),
      makeAgentStatus({
        capabilities: {
          ...baseCapabilities,
          liveInputMode: "terminal",
          presentationMode: "terminal",
          presentationModes: ["terminal"],
          slashCommands: [{ id: "help", label: "help — Show help", description: "Show help" }],
        },
      }),
    );

    const editor = screen.getByRole("textbox");
    typeSlashQuery(editor, "/he");

    expect(screen.getByText("Commands")).toBeInTheDocument();
    expect(screen.getByText("/help")).toBeInTheDocument();
  });

  it("selects draft slash commands without submitting the draft", () => {
    const baseCapabilities = makeAgentStatus().capabilities;
    const onStart = renderDraftComposer(
      makeAgentStatus({
        capabilities: {
          ...baseCapabilities,
          liveInputMode: "terminal",
          presentationMode: "terminal",
          presentationModes: ["terminal"],
          slashCommands: [
            {
              id: "plan",
              label: "plan — Draft a plan",
              description: "Draft a plan",
            },
            {
              id: "review",
              label: "review — Review the diff",
              description: "Review the diff",
            },
          ],
        },
      }),
    );

    const editor = screen.getByRole("textbox");
    typeSlashQuery(editor, "/");

    expect(screen.getByText("Commands")).toBeInTheDocument();

    scrollIntoView.mockClear();
    fireEvent.keyDown(editor, { key: "ArrowDown" });

    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(scrollIntoView).toHaveBeenCalled();

    fireEvent.keyDown(editor, { key: "Enter" });

    expect(onStart).not.toHaveBeenCalled();
    expect(screen.queryByText("Commands")).not.toBeInTheDocument();
    expect(editor.textContent).toBe("/review ");
  });
});
