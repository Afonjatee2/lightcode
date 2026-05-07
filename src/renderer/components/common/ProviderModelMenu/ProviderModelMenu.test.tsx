import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { ProviderModelMenu, type ProviderModelMenuProvider } from "./ProviderModelMenu";

function makeProvider(modelCount: number): ProviderModelMenuProvider {
  return makeNamedProvider("codex", "Codex", modelCount);
}

function makeNamedProvider(
  kind: string,
  label: string,
  modelCount: number,
): ProviderModelMenuProvider {
  return {
    kind,
    label,
    capabilities: {
      models: Array.from({ length: modelCount }, (_, index) => ({
        id: `model-${index + 1}`,
        label: `Model ${index + 1}`,
      })),
      efforts: [],
      modelEfforts: {},
      modes: ["agent"],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: true,
      supportsDirectInput: true,
      liveInputMode: "terminal",
      presentationMode: "terminal",
      settingDefs: [],
    },
  };
}

describe("ProviderModelMenu", () => {
  beforeEach(() => {
    useSharedSettings.setState({
      favoriteModels: [],
      recentModels: [],
    });
  });

  it("hides the list scrollbar for long model lists", async () => {
    render(
      <ProviderModelMenu
        providers={[makeProvider(500)]}
        currentAgentKind="codex"
        currentModel="model-1"
        onChange={vi.fn<(next: { agentKind: string; model: string }) => void>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select model" }));

    const listbox = await screen.findByRole("listbox", { name: "Models" });
    expect(listbox).toHaveClass("no-scrollbar");
    expect(screen.queryByText("Model 500")).not.toBeInTheDocument();

    fireEvent.scroll(listbox, { target: { scrollTop: 500 * 28 } });

    expect(await screen.findByText("Model 500")).toBeInTheDocument();
  });

  it("keeps the current provider header rendered while scrolling deep into a long section", async () => {
    render(
      <ProviderModelMenu
        providers={[
          makeNamedProvider("codex", "Codex Long", 500),
          makeNamedProvider("claude", "Claude Short", 3),
        ]}
        currentAgentKind="codex"
        currentModel="model-1"
        onChange={vi.fn<(next: { agentKind: string; model: string }) => void>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select model" }));

    const listbox = await screen.findByRole("listbox", { name: "Models" });
    fireEvent.scroll(listbox, { target: { scrollTop: 220 * 28 } });

    expect(await screen.findByText("Codex Long")).toBeInTheDocument();
  });

  it("filters long model lists by search", async () => {
    render(
      <ProviderModelMenu
        providers={[makeProvider(500)]}
        currentAgentKind="codex"
        currentModel="model-1"
        onChange={vi.fn<(next: { agentKind: string; model: string }) => void>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select model" }));
    fireEvent.change(await screen.findByPlaceholderText("Search models..."), {
      target: { value: "model 500" },
    });

    expect(await screen.findByText("Model 500")).toBeInTheDocument();
    expect(screen.queryByText("Model 499")).not.toBeInTheDocument();
  });

  it("window-renders model lists instead of switching render paths by size", async () => {
    render(
      <ProviderModelMenu
        providers={[makeProvider(3)]}
        currentAgentKind="codex"
        currentModel="model-1"
        onChange={vi.fn<(next: { agentKind: string; model: string }) => void>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select model" }));

    const listbox = await screen.findByRole("listbox", { name: "Models" });
    expect(listbox).toHaveClass("no-scrollbar");
    expect(screen.getByText("Model 3")).toBeInTheDocument();
  });

  it("resets the window when a long list shrinks so rows do not render blank", async () => {
    const { rerender } = render(
      <ProviderModelMenu
        providers={[makeProvider(500)]}
        currentAgentKind="codex"
        currentModel="model-1"
        onChange={vi.fn<(next: { agentKind: string; model: string }) => void>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select model" }));

    const listbox = await screen.findByRole("listbox", { name: "Models" });
    fireEvent.scroll(listbox, { target: { scrollTop: 500 * 28 } });

    rerender(
      <ProviderModelMenu
        providers={[makeProvider(3)]}
        currentAgentKind="codex"
        currentModel="model-1"
        onChange={vi.fn<(next: { agentKind: string; model: string }) => void>()}
      />,
    );

    const rerenderedListbox = await screen.findByRole("listbox", { name: "Models" });
    expect(within(rerenderedListbox).getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("aggregates favorites into a sticky section when multiple providers are visible", async () => {
    render(
      <ProviderModelMenu
        providers={[
          makeNamedProvider("codex", "Codex", 3),
          makeNamedProvider("claude", "Claude", 3),
        ]}
        currentAgentKind="codex"
        currentModel="model-1"
        onChange={vi.fn<(next: { agentKind: string; model: string }) => void>()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Select model" });
    fireEvent.click(trigger);

    const addButtons = await screen.findAllByRole("button", { name: "Add to favorites" });
    fireEvent.click(addButtons[1]!);

    expect(screen.queryByText("Favorites")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove from favorites" })).toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(trigger);

    expect(await screen.findByText("Favorites")).toBeInTheDocument();
  });

  it("does not duplicate favorites into a separate section when only one provider is visible", async () => {
    useSharedSettings.setState({
      favoriteModels: [{ agentKind: "codex", modelId: "model-2" }],
      recentModels: [],
    });

    render(
      <ProviderModelMenu
        providers={[makeProvider(3)]}
        currentAgentKind="codex"
        currentModel="model-1"
        onChange={vi.fn<(next: { agentKind: string; model: string }) => void>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select model" }));

    const listbox = await screen.findByRole("listbox", { name: "Models" });
    expect(within(listbox).queryByText("Favorites")).not.toBeInTheDocument();
    const optionLabels = within(listbox)
      .getAllByRole("option")
      .map((o) => o.textContent?.trim());
    expect(optionLabels[0]).toContain("Model 2");
  });

  it("hoists the selected favorite to the top of the single-provider list when reopened", async () => {
    useSharedSettings.setState({
      favoriteModels: [{ agentKind: "codex", modelId: "model-500" }],
      recentModels: [],
    });

    render(
      <ProviderModelMenu
        providers={[makeProvider(500)]}
        currentAgentKind="codex"
        currentModel="model-500"
        onChange={vi.fn<(next: { agentKind: string; model: string }) => void>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select model" }));

    const listbox = await screen.findByRole("listbox", { name: "Models" });
    expect(within(listbox).queryByText("Favorites")).not.toBeInTheDocument();
    expect(await within(listbox).findByText("Model 500")).toBeInTheDocument();
    await waitFor(() => expect(listbox.scrollTop).toBe(0));
  });

  it("keeps the scrollbar hidden for short lists too", async () => {
    render(
      <ProviderModelMenu
        providers={[makeProvider(3)]}
        currentAgentKind="codex"
        currentModel="model-1"
        onChange={vi.fn<(next: { agentKind: string; model: string }) => void>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select model" }));

    expect(await screen.findByRole("listbox", { name: "Models" })).toHaveClass("no-scrollbar");
  });

  it("shows the selected model sub-provider in the trigger", () => {
    render(
      <ProviderModelMenu
        providers={[
          {
            kind: "opencode",
            label: "OpenCode",
            capabilities: {
              models: [{ id: "opencode/big-pickle", label: "Big Pickle" }],
              subProviders: [{ id: "opencode", label: "OpenCode" }],
              efforts: [],
              modelEfforts: {},
              modes: ["agent"],
              approvalPolicies: [],
              sandboxModes: [],
              supportsResume: true,
              supportsDirectInput: true,
              liveInputMode: "terminal",
              presentationMode: "terminal",
              settingDefs: [],
            },
          },
        ]}
        currentAgentKind="opencode"
        currentModel="opencode/big-pickle"
        onChange={vi.fn<(next: { agentKind: string; model: string }) => void>()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Select model" });
    expect(within(trigger).getByText("Big Pickle")).toBeInTheDocument();
    expect(within(trigger).getByText("OpenCode")).toBeInTheDocument();
  });
});
