import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus, Project, PromptSegment } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { SwarmView } from "./SwarmView";

describe("SwarmView", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({ projects: [makeProject()] });
    useAgentStatusesStore.setState({
      agentStatuses: [],
      wslAgentStatuses: [],
      windowsLoaded: true,
      wslLoaded: true,
      inFirstLaunchDiscovery: false,
      discoveryScope: undefined,
      discoveredAgents: [],
    });
    useSharedSettings.setState({
      disabledAgents: [],
      disabledBuiltInMcpServers: {},
    });
  });

  it("mounts with a project without entering a store update loop", () => {
    render(<SwarmView />);

    expect(
      screen.getByRole("heading", { name: "Build with a coordinated agent team" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start swarm" })).toBeDisabled();
  });

  it("offers only models enabled in Visible models", async () => {
    setUsableRoster();
    useSharedSettings.setState({ hiddenModels: { codex: ["gpt-hidden"] } });

    render(<SwarmView />);
    fireEvent.click(screen.getAllByRole("button", { name: "Select model" })[0]!);

    expect((await screen.findAllByText("GPT Visible")).length).toBeGreaterThan(0);
    expect(screen.queryByText("GPT Hidden")).not.toBeInTheDocument();
  });

  it("queues picked files as attachment context for the swarm root", async () => {
    setUsableRoster();
    const queueThreadLaunch =
      vi.fn<(threadId: string, prompt: string, segments?: PromptSegment[]) => void>();
    useAppStore.setState({ queueThreadLaunch });
    Object.defineProperty(window, "poracode", {
      configurable: true,
      value: {
        appVersion: "test",
        pickFiles: vi.fn<() => Promise<string[]>>(async () => [
          "/tmp/reference.mov",
          "/tmp/data.xlsx",
        ]),
      },
    });

    render(<SwarmView />);
    fireEvent.click(screen.getByRole("button", { name: "Attach files" }));
    expect(await screen.findByText("reference.mov")).toBeInTheDocument();
    expect(screen.getByText("data.xlsx")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use 1 worker" }));

    fireEvent.change(screen.getByRole("textbox", { name: "Task for the swarm" }), {
      target: { value: "Implement the supplied brief" },
    });
    const startButton = screen.getByRole("button", { name: "Start swarm" });
    await waitFor(() => expect(startButton).toBeEnabled());
    fireEvent.click(startButton);

    await waitFor(() => expect(queueThreadLaunch).toHaveBeenCalledOnce());
    expect(queueThreadLaunch.mock.calls[0]?.[1]).toContain(
      "Decompose the task into 1 bounded work item, one per worker.",
    );
    expect(queueThreadLaunch.mock.calls[0]?.[2]).toEqual([
      {
        kind: "text",
        content: expect.stringContaining("You are the root orchestrator"),
      },
      { kind: "attachment", path: "/tmp/reference.mov" },
      { kind: "attachment", path: "/tmp/data.xlsx" },
    ]);
  });

  it("supports one worker with a dedicated visible reviewer", async () => {
    setUsableRoster();
    const queueThreadLaunch =
      vi.fn<(threadId: string, prompt: string, segments?: PromptSegment[]) => void>();
    useAppStore.setState({ queueThreadLaunch });

    render(<SwarmView />);
    fireEvent.click(screen.getByRole("button", { name: "Use 1 worker" }));
    fireEvent.click(screen.getByRole("button", { name: "Dedicated reviewer" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Task for the swarm" }), {
      target: { value: "Fix the parser" },
    });

    const startButton = screen.getByRole("button", { name: "Start swarm" });
    await waitFor(() => expect(startButton).toBeEnabled());
    fireEvent.click(startButton);

    await waitFor(() => expect(queueThreadLaunch).toHaveBeenCalledOnce());
    const prompt = queueThreadLaunch.mock.calls[0]?.[1] ?? "";
    expect(prompt).toContain("exactly 1 implementation worker thread");
    expect(prompt).toContain("launch exactly one visible reviewer child");
    expect(prompt).toContain("Do not use an ephemeral reviewer");
  });
});

function makeProject(): Project {
  return {
    id: "project-1",
    name: "todo-app",
    location: { kind: "windows", path: "C:\\repo" },
    createdAt: "2026-05-26T00:00:00.000Z",
  };
}

function makeAgentStatus(input: {
  kind: string;
  label: string;
  models: AgentStatus["capabilities"]["models"];
  presentationMode: AgentStatus["capabilities"]["presentationMode"];
}): AgentStatus {
  return {
    kind: input.kind,
    label: input.label,
    installed: true,
    authState: "authenticated",
    capabilities: {
      models: input.models,
      efforts: [],
      modelEfforts: {},
      modes: ["agent"],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: true,
      supportsDirectInput: true,
      liveInputMode: "terminal",
      presentationMode: input.presentationMode,
      settingDefs: [],
    },
  };
}

function setUsableRoster() {
  useAgentStatusesStore.setState({
    agentStatuses: [
      makeAgentStatus({
        kind: "codex",
        label: "Codex",
        models: [
          { id: "gpt-visible", label: "GPT Visible" },
          { id: "gpt-hidden", label: "GPT Hidden" },
        ],
        presentationMode: "gui",
      }),
      makeAgentStatus({
        kind: "qwen",
        label: "Qwen Code",
        models: [{ id: "qwen-visible", label: "Qwen Visible" }],
        presentationMode: "gui",
      }),
      makeAgentStatus({
        kind: "kimi",
        label: "Kimi Code",
        models: [{ id: "kimi-visible", label: "Kimi Visible" }],
        presentationMode: "terminal",
      }),
    ],
  });
}
