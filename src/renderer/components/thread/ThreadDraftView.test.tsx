import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus, Project } from "@/shared/contracts";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";

const { composerSpy } = vi.hoisted(() => ({
  composerSpy: vi.fn<(props: unknown) => void>(),
}));

vi.mock("./ThreadComposer", () => ({
  ThreadComposer: (props: {
    controls: unknown[];
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
  }) => {
    composerSpy(props);
    return (
      <div>
        <button type="button" onClick={() => props.onPromptChange("hello world")}>
          set-prompt
        </button>
        <button type="button" onClick={props.onSubmit}>
          submit
        </button>
      </div>
    );
  },
}));

import { ThreadDraftView } from "./ThreadDraftView";

const project: Project = {
  id: "project-1",
  name: "Repo",
  location: {
    kind: "windows",
    path: "C:\\repo",
  },
  createdAt: "2026-03-28T00:00:00.000Z",
};

const codexStatus: AgentStatus = {
  kind: "codex",
  label: "Codex",
  installed: true,
  authState: "authenticated",
  capabilities: {
    models: [
      { id: "gpt-5.4", label: "5.4" },
      { id: "gpt-5.4-mini", label: "5.4 Mini" },
    ],
    efforts: ["low", "medium", "high", "xhigh"],
    defaultEffort: "high",
    modelEfforts: {},
    modes: ["agent", "plan"],
    approvalPolicies: [
      { id: "on-request", label: "On Request" },
      { id: "never", label: "Full Access" },
      { id: "untrusted", label: "Untrusted" },
    ],
    sandboxModes: [
      { id: "workspace-write", label: "Workspace Write" },
      { id: "read-only", label: "Read Only" },
      { id: "danger-full-access", label: "Full Access" },
    ],
    supportsResume: true,
    supportsDirectInput: true,
    liveInputMode: "server",
    presentationMode: "terminal",
    settingDefs: [],
  },
};

const dualModeCodexStatus: AgentStatus = {
  ...codexStatus,
  capabilities: {
    ...codexStatus.capabilities,
    presentationModes: ["terminal", "gui"],
  },
};

const geminiStatus: AgentStatus = {
  kind: "gemini",
  label: "Gemini",
  installed: true,
  authState: "authenticated",
  capabilities: {
    models: [
      { id: "auto", label: "Auto" },
      { id: "gemini-2.5-flash", label: "2.5 Flash" },
    ],
    efforts: [],
    modelEfforts: {},
    modes: ["agent", "plan"],
    approvalPolicies: [
      { id: "default", label: "Default" },
      { id: "auto_edit", label: "Auto Edit" },
      { id: "never", label: "Full Access" },
    ],
    sandboxModes: [],
    supportsResume: true,
    supportsDirectInput: true,
    liveInputMode: "terminal",
    presentationMode: "terminal",
    settingDefs: [],
  },
};

const claudeStatus: AgentStatus = {
  kind: "claude",
  label: "Claude",
  installed: true,
  authState: "authenticated",
  capabilities: {
    models: [
      { id: "claude-sonnet-4-7", label: "Sonnet 4.7" },
      { id: "claude-opus-4-7", label: "Opus 4.7" },
    ],
    efforts: [],
    modelEfforts: {},
    modes: ["agent", "plan"],
    approvalPolicies: [
      { id: "default", label: "Default" },
      { id: "auto", label: "Auto mode" },
    ],
    sandboxModes: [],
    supportsResume: true,
    supportsDirectInput: true,
    liveInputMode: "terminal",
    presentationMode: "terminal",
    bypassApprovalPolicy: "auto",
    settingDefs: [],
  },
};

const cursorStatus: AgentStatus = {
  kind: "cursor",
  label: "Cursor",
  installed: true,
  authState: "authenticated",
  capabilities: {
    models: [
      { id: "composer-2", label: "Composer 2" },
      { id: "gpt-5.5", label: "GPT-5.5" },
    ],
    efforts: ["high"],
    modelEfforts: { "composer-2": [], "gpt-5.5": ["high"] },
    contextSizes: [
      { id: "272k", label: "272K" },
      { id: "1m", label: "1M" },
    ],
    modelContextSizes: {
      "gpt-5.5": ["272k", "1m"],
    },
    fastModels: ["composer-2", "gpt-5.5"],
    thinkingModels: ["gpt-5.5"],
    modes: ["agent", "plan"],
    approvalPolicies: [{ id: "default", label: "Default" }],
    sandboxModes: [],
    supportsResume: true,
    supportsDirectInput: true,
    liveInputMode: "terminal",
    presentationMode: "terminal",
    presentationModes: ["terminal", "gui"],
    settingDefs: [],
  },
};

describe("ThreadDraftView", () => {
  beforeEach(() => {
    composerSpy.mockClear();
    useSharedSettings.setState({
      providerConfigs: {},
      hiddenModels: {},
      disabledAgents: [],
      lastPresentationModeByAgent: {},
      sharedSettingsHydrated: true,
    });
  });

  it("switches to the first installed agent when statuses resolve after mount", async () => {
    const onStart = vi.fn<(input: unknown) => void>();
    const { rerender } = render(
      <ThreadDraftView project={project} agentStatuses={[]} onStart={onStart} />,
    );

    expect(screen.getByText("No supported agents detected")).toBeInTheDocument();

    rerender(
      <ThreadDraftView project={project} agentStatuses={[geminiStatus]} onStart={onStart} />,
    );

    await waitFor(() => {
      const props = composerSpy.mock.lastCall?.[0] as {
        controls: Array<{
          kind?: string;
          currentAgentKind?: string;
          currentModel?: string;
          value?: string;
        }>;
      };
      const providerModel = props.controls.find((c) => c.kind === "provider-model");
      expect(providerModel?.currentAgentKind).toBe("gemini");
      expect(providerModel?.currentModel).toBe("auto");
      expect(props.controls.some((control) => control.value === "never")).toBe(true);
    });
  });

  it("shows the detecting state while agents are still loading", () => {
    const onStart = vi.fn<(input: unknown) => void>();
    render(
      <ThreadDraftView project={project} agentStatuses={[]} isDetectingAgents onStart={onStart} />,
    );

    // While detection is in flight we suppress the "no agents installed"
    // message so the renderer doesn't flash it before the cache or detection
    // events hydrate the store.
    expect(screen.getByText(/detecting agents/i)).toBeInTheDocument();
    expect(screen.queryByText("No supported agents detected")).not.toBeInTheDocument();
  });

  it("submits codex defaults on first launch", async () => {
    const onStart = vi.fn<(input: unknown) => void>();

    render(
      <ThreadDraftView project={project} agentStatuses={[dualModeCodexStatus]} onStart={onStart} />,
    );

    await waitFor(() => {
      const props = composerSpy.mock.lastCall?.[0] as {
        controls: Array<{
          kind?: string;
          currentAgentKind?: string;
          currentModel?: string;
          effortValue?: string;
          value?: string;
          label?: string;
          isSelected?: boolean;
        }>;
      };
      const providerModel = props.controls.find((c) => c.kind === "provider-model");
      expect(providerModel?.currentAgentKind).toBe("codex");
      expect(providerModel?.currentModel).toBe("gpt-5.4");
      const effortContext = props.controls.find((c) => c.kind === "effort-context");
      expect(effortContext?.effortValue).toBe("high");
      expect(props.controls.some((control) => control.value === "full-access")).toBe(true);
    });

    fireEvent.click(screen.getByText("set-prompt"));
    fireEvent.click(screen.getByText("submit"));

    expect(onStart).toHaveBeenCalledWith({
      agentKind: "codex",
      config: {
        model: "gpt-5.4",
        effort: "high",
        mode: "agent",
        approvalPolicy: "never",
        sandboxMode: "danger-full-access",
      },
      presentationMode: "gui",
      prompt: "hello world",
    });
  });

  it("renders Chat first and selects it by default for dual-mode agents", async () => {
    const onStart = vi.fn<(input: unknown) => void>();

    render(
      <ThreadDraftView project={project} agentStatuses={[dualModeCodexStatus]} onStart={onStart} />,
    );

    await waitFor(() => {
      const tabs = screen.getAllByRole("tab");
      expect(tabs.map((tab) => tab.textContent?.replace(/\s+/g, " ").trim())).toEqual([
        "Chat",
        "CLI",
      ]);
      expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    });
  });

  it("keeps Chat as the default when a dual-mode agent resolves after mount", async () => {
    const onStart = vi.fn<(input: unknown) => void>();
    const { rerender } = render(
      <ThreadDraftView project={project} agentStatuses={[]} onStart={onStart} />,
    );

    rerender(
      <ThreadDraftView project={project} agentStatuses={[dualModeCodexStatus]} onStart={onStart} />,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    });
  });

  it("respects a saved CLI choice for dual-mode agents", async () => {
    const onStart = vi.fn<(input: unknown) => void>();

    act(() => {
      useSharedSettings.setState({
        lastPresentationModeByAgent: { codex: "terminal" },
      });
    });

    render(
      <ThreadDraftView project={project} agentStatuses={[dualModeCodexStatus]} onStart={onStart} />,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "CLI" })).toHaveAttribute("aria-selected", "true");
    });
  });

  it("applies a saved codex effort after shared settings load", async () => {
    const onStart = vi.fn<(input: unknown) => void>();
    useSharedSettings.setState({ sharedSettingsHydrated: false, providerConfigs: {} });

    render(<ThreadDraftView project={project} agentStatuses={[codexStatus]} onStart={onStart} />);

    await waitFor(() => {
      const props = composerSpy.mock.lastCall?.[0] as {
        controls: Array<{ kind?: string; effortValue?: string; currentModel?: string }>;
      };
      const effortContext = props.controls.find((c) => c.kind === "effort-context");
      expect(effortContext?.effortValue).toBe("high");
    });

    act(() => {
      useSharedSettings.setState({
        providerConfigs: {
          codex: {
            model: "gpt-5.4",
            effort: "medium",
            mode: "agent",
            approvalPolicy: "never",
            sandboxMode: "danger-full-access",
          },
        },
        sharedSettingsHydrated: true,
      });
    });

    await waitFor(() => {
      const props = composerSpy.mock.lastCall?.[0] as {
        controls: Array<{ kind?: string; effortValue?: string; currentModel?: string }>;
      };
      const providerModel = props.controls.find((c) => c.kind === "provider-model");
      const effortContext = props.controls.find((c) => c.kind === "effort-context");
      expect(providerModel?.currentModel).toBe("gpt-5.4");
      expect(effortContext?.effortValue).toBe("medium");
    });
  });

  it("keeps simultaneously open draft configs independent while saving defaults for later drafts", async () => {
    render(
      <>
        <ThreadDraftView
          project={project}
          agentStatuses={[dualModeCodexStatus]}
          onStart={vi.fn<(input: unknown) => void>()}
        />
        <ThreadDraftView
          project={project}
          agentStatuses={[dualModeCodexStatus]}
          onStart={vi.fn<(input: unknown) => void>()}
        />
      </>,
    );

    await waitFor(() => {
      const recentCalls = composerSpy.mock.calls.slice(-2) as Array<
        [
          {
            controls: Array<{
              label?: string;
              onChange?: (selected: boolean) => void;
            }>;
          },
        ]
      >;
      expect(recentCalls).toHaveLength(2);
      expect(recentCalls.every(([props]) => props.controls.some((c) => c.label === "Work"))).toBe(
        true,
      );
    });

    const firstDraftProps = composerSpy.mock.calls.at(-2)?.[0] as {
      controls: Array<{
        label?: string;
        onChange?: (selected: boolean) => void;
      }>;
    };
    const firstModeToggle = firstDraftProps.controls.find((control) => control.label === "Work");

    composerSpy.mockClear();
    act(() => {
      firstModeToggle?.onChange?.(true);
    });

    await waitFor(() => {
      expect(composerSpy).toHaveBeenCalled();
      const lastProps = composerSpy.mock.lastCall?.[0] as {
        controls: Array<{ label?: string }>;
      };
      expect(lastProps.controls.some((control) => control.label === "Plan")).toBe(true);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(composerSpy.mock.calls).toHaveLength(1);
    expect(useSharedSettings.getState().providerConfigs.codex?.mode).toBe("plan");
  });

  it("does not show effort/context control for Cursor models without those capabilities", async () => {
    const onStart = vi.fn<(input: unknown) => void>();

    render(<ThreadDraftView project={project} agentStatuses={[cursorStatus]} onStart={onStart} />);

    await waitFor(() => {
      const props = composerSpy.mock.lastCall?.[0] as {
        controls: Array<{
          kind?: string;
          currentModel?: string;
          label?: string;
        }>;
      };
      const providerModel = props.controls.find((c) => c.kind === "provider-model");
      expect(providerModel?.currentModel).toBe("composer-2");
      expect(props.controls.some((control) => control.kind === "effort-context")).toBe(false);
      expect(props.controls.some((control) => control.label === "Fast")).toBe(true);
    });
  });

  it("normalizes saved Cursor effort variants into base model plus effort", async () => {
    const onStart = vi.fn<(input: unknown) => void>();

    act(() => {
      useSharedSettings.setState({
        providerConfigs: {
          cursor: {
            model: "gpt-5.5-high",
            effort: "",
            mode: "agent",
            approvalPolicy: "default",
          },
        },
      });
    });

    render(<ThreadDraftView project={project} agentStatuses={[cursorStatus]} onStart={onStart} />);

    await waitFor(() => {
      const props = composerSpy.mock.lastCall?.[0] as {
        controls: Array<{
          kind?: string;
          currentModel?: string;
          effortValue?: string;
        }>;
      };
      const providerModel = props.controls.find((c) => c.kind === "provider-model");
      const effortContext = props.controls.find((c) => c.kind === "effort-context");
      expect(providerModel?.currentModel).toBe("gpt-5.5");
      expect(effortContext?.effortValue).toBe("high");
    });
  });

  it("switches provider and selected model in one coherent composer state", async () => {
    const onStart = vi.fn<(input: unknown) => void>();

    render(
      <ThreadDraftView
        project={project}
        agentStatuses={[codexStatus, claudeStatus]}
        onStart={onStart}
      />,
    );

    await waitFor(() => {
      const props = composerSpy.mock.lastCall?.[0] as {
        controls: Array<{
          kind?: string;
          currentAgentKind?: string;
          currentModel?: string;
          onChange?: (next: { agentKind: string; model: string }) => void;
        }>;
      };
      const providerModel = props.controls.find((c) => c.kind === "provider-model");
      expect(providerModel?.currentAgentKind).toBe("codex");
      expect(providerModel?.currentModel).toBe("gpt-5.4");
    });

    const initialProps = composerSpy.mock.lastCall?.[0] as {
      controls: Array<{
        kind?: string;
        currentAgentKind?: string;
        currentModel?: string;
        onChange?: (next: { agentKind: string; model: string }) => void;
      }>;
    };
    const providerModel = initialProps.controls.find((c) => c.kind === "provider-model");

    composerSpy.mockClear();
    act(() => {
      providerModel?.onChange?.({ agentKind: "claude", model: "claude-opus-4-7" });
    });

    await waitFor(() => {
      const props = composerSpy.mock.lastCall?.[0] as {
        controls: Array<{
          kind?: string;
          currentAgentKind?: string;
          currentModel?: string;
          value?: string;
        }>;
      };
      const nextProviderModel = props.controls.find((c) => c.kind === "provider-model");
      expect(nextProviderModel?.currentAgentKind).toBe("claude");
      expect(nextProviderModel?.currentModel).toBe("claude-opus-4-7");
      expect(props.controls.some((control) => control.value === "auto")).toBe(true);
    });

    const claudeRenderModels = (
      composerSpy.mock.calls as Array<
        [
          {
            controls: Array<{
              kind?: string;
              currentAgentKind?: string;
              currentModel?: string;
            }>;
          },
        ]
      >
    )
      .map(([props]) => props.controls.find((c) => c.kind === "provider-model"))
      .filter(
        (control): control is { kind?: string; currentAgentKind?: string; currentModel?: string } =>
          control?.currentAgentKind === "claude",
      )
      .map((control) => control.currentModel);

    expect(claudeRenderModels.length).toBeGreaterThan(0);
    expect(claudeRenderModels).toEqual(claudeRenderModels.map(() => "claude-opus-4-7"));
  });

  it("keeps a local plan-mode selection while deferred persistence catches up", async () => {
    render(
      <ThreadDraftView
        project={project}
        agentStatuses={[dualModeCodexStatus]}
        onStart={vi.fn<(input: unknown) => void>()}
      />,
    );

    await waitFor(() => {
      const props = composerSpy.mock.lastCall?.[0] as {
        controls: Array<{
          kind?: string;
          label?: string;
          onChange?: (selected: boolean) => void;
        }>;
      };
      expect(props.controls.some((control) => control.label === "Work")).toBe(true);
    });

    const initialProps = composerSpy.mock.lastCall?.[0] as {
      controls: Array<{
        kind?: string;
        label?: string;
        onChange?: (selected: boolean) => void;
      }>;
    };
    const modeToggle = initialProps.controls.find((control) => control.label === "Work");

    composerSpy.mockClear();
    act(() => {
      modeToggle?.onChange?.(true);
    });

    await waitFor(() => {
      const props = composerSpy.mock.lastCall?.[0] as {
        controls: Array<{ label?: string }>;
      };
      expect(props.controls.some((control) => control.label === "Plan")).toBe(true);
      expect(props.controls.some((control) => control.label === "Work")).toBe(false);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const settledProps = composerSpy.mock.lastCall?.[0] as {
      controls: Array<{ label?: string }>;
    };
    expect(settledProps.controls.some((control) => control.label === "Plan")).toBe(true);
    expect(settledProps.controls.some((control) => control.label === "Work")).toBe(false);
  });
});
