import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus } from "@/shared/contracts";
import { AppProvider } from "@/renderer/components/ui/provider";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";

const { requestExecutorSpecMock } = vi.hoisted(() => ({
  requestExecutorSpecMock: vi.fn<(input: { task: string }) => Promise<string>>(),
}));

vi.mock("@/renderer/utils/executorSpecGen", () => ({
  requestExecutorSpec: requestExecutorSpecMock,
}));

vi.mock("@/renderer/components/thread/ThreadComposer", () => ({
  ThreadComposer: () => <div data-testid="draft-spec-controls" />,
}));

import { ExperimentSpecDraftDialog } from "./ExperimentSpecDraftDialog";
import { ExperimentDraftTargets } from "./ExperimentDraftTargets";

function draftingAgent(kind: string, models: string[]): AgentStatus {
  return {
    kind,
    label: kind,
    installed: true,
    authState: "authenticated",
    capabilities: {
      models: models.map((model) => ({ id: model, label: model })),
      efforts: ["low", "high"],
      defaultEffort: "high",
      modelEfforts: {},
      fastModels: models.slice(0, 1),
      modes: [],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: false,
      supportsDirectInput: false,
      liveInputMode: "terminal",
      presentationMode: "terminal",
      settingDefs: [],
      supportsOneShot: true,
    },
  };
}

const projectLocation = { kind: "posix" as const, path: "/repo" };

describe("ExperimentSpecDraftDialog", () => {
  beforeEach(() => {
    requestExecutorSpecMock.mockReset();
  });

  it("stays open with guidance when no drafting agent is eligible", () => {
    const onClose = vi.fn<() => void>();
    render(
      <AppProvider>
        <ExperimentSpecDraftDialog
          agents={[]}
          projectLocation={projectLocation}
          onUseSpec={() => undefined}
          onClose={onClose}
        />
      </AppProvider>,
    );

    expect(screen.getByRole("heading", { name: "Draft an executor spec" })).toBeInTheDocument();
    expect(screen.getByText(/No one-shot-capable agent is available/)).toBeInTheDocument();
    // The dialog is still usable surface-wise, but drafting is impossible.
    expect(screen.getByRole("button", { name: "Draft spec" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("drafts a spec from the task and inserts it via onUseSpec", async () => {
    const draftedSpec = "## Goal\nImplement the month selector.\n## Steps\n1. Wire the store.";
    requestExecutorSpecMock.mockResolvedValue(draftedSpec);
    const onUseSpec = vi.fn<(spec: string) => void>();

    render(
      <AppProvider>
        <ExperimentSpecDraftDialog
          agents={[draftingAgent("codex", ["gpt-5.5"])]}
          projectLocation={projectLocation}
          onUseSpec={onUseSpec}
          onClose={() => undefined}
        />
      </AppProvider>,
    );

    fireEvent.change(screen.getByLabelText("Task description"), {
      target: { value: "Fix the Overview page month selector" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draft spec" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Drafted executor spec")).toBeInTheDocument();
    });
    expect(requestExecutorSpecMock).toHaveBeenCalledTimes(1);
    expect(requestExecutorSpecMock).toHaveBeenCalledWith(
      expect.objectContaining({ task: "Fix the Overview page month selector" }),
    );

    // The drafted prompt is editable before insertion…
    fireEvent.change(screen.getByLabelText("Drafted executor spec"), {
      target: { value: `${draftedSpec}\n## Notes\nKeep the URL contract.` },
    });
    // …and "Use this spec" hands the final prompt back to the composer.
    fireEvent.click(screen.getByRole("button", { name: "Use this spec" }));
    expect(onUseSpec).toHaveBeenCalledWith(`${draftedSpec}\n## Notes\nKeep the URL contract.`);
  });

  it("surfaces drafting failures without closing the dialog", async () => {
    requestExecutorSpecMock.mockRejectedValue(new Error("agent offline"));
    const onClose = vi.fn<() => void>();

    render(
      <AppProvider>
        <ExperimentSpecDraftDialog
          agents={[draftingAgent("codex", ["gpt-5.5"])]}
          projectLocation={projectLocation}
          onUseSpec={() => undefined}
          onClose={onClose}
        />
      </AppProvider>,
    );

    fireEvent.change(screen.getByLabelText("Task description"), {
      target: { value: "Fix the Overview page month selector" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draft spec" }));

    await waitFor(() => {
      expect(screen.getByText("agent offline")).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Draft spec" })).toBeEnabled();
  });
});

describe("ExperimentDraftTargets draft spec visibility", () => {
  it("keeps Draft spec visible and enabled when no drafting agent is eligible", () => {
    const onDraftSpec = vi.fn<() => void>();

    render(
      <AppProvider>
        <ExperimentDraftTargets
          candidates={[]}
          eligibleFallbackAgents={[]}
          isSubmitting={false}
          isAddDisabled={false}
          onRemove={() => undefined}
          onCancel={() => undefined}
          onAdd={() => undefined}
          onFallbackChange={() => undefined}
          onDraftSpec={onDraftSpec}
          isDraftSpecDisabled={false}
        />
      </AppProvider>,
    );

    // Agent eligibility is decided inside the dialog; the entry point must
    // remain reachable so the user can read the sign-in guidance. The button
    // sits inside a Tooltip.Trigger (itself role=button), so resolve the real
    // <button> through the label text.
    const draftSpec = screen.getByText("Draft spec").closest("button")!;
    expect(draftSpec).toBeEnabled();
    fireEvent.click(draftSpec);
    expect(onDraftSpec).toHaveBeenCalledTimes(1);
  });
});
