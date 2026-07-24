import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { CampaignThreadComposer } from "./CampaignThreadComposer";

const mocks = vi.hoisted(() => ({
  submitConsultation:
    vi.fn<
      (input: {
        projectId: string;
        parentThreadId: string;
        campaignGroupId: string;
        message: string;
      }) => Promise<{ ok: true; consultation: { id: string } } | { ok: false; message: string }>
    >(),
  toastWarning: vi.fn<(message: string) => void>(),
  friendlyError: vi.fn<(error: unknown) => string>(() => "Safe consultation error"),
}));

vi.mock("@/renderer/actions/consultationActions", () => ({
  submitConsultation: mocks.submitConsultation,
}));

vi.mock("@heroui/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@heroui/react")>();
  return {
    ...actual,
    toast: {
      ...actual.toast,
      warning: mocks.toastWarning,
    },
  };
});

vi.mock("@/shared/messages", () => ({
  friendlyError: mocks.friendlyError,
}));

describe("CampaignThreadComposer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submitConsultation.mockResolvedValue({
      ok: true,
      consultation: { id: "consultation-1" },
    });
  });

  it("dispatches @mention input to submitConsultation", async () => {
    render(
      <CampaignThreadComposer
        projectId="project-1"
        parentThreadId="thread-1"
        campaignGroupId="cg-1"
        defaultProvider="claude"
      />,
    );

    const composer = screen.getByRole("textbox", { name: /message composer/i });
    fireEvent.change(composer, { target: { value: "@codex verify spend" } });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(mocks.submitConsultation).toHaveBeenCalledTimes(1));
    expect(mocks.submitConsultation).toHaveBeenCalledWith({
      projectId: "project-1",
      parentThreadId: "thread-1",
      campaignGroupId: "cg-1",
      message: "@codex verify spend",
    });
    expect(composer).toHaveValue("");
  });

  it("wraps plain text with the default provider before submitting", async () => {
    render(
      <CampaignThreadComposer
        projectId="project-1"
        parentThreadId="thread-1"
        campaignGroupId="cg-1"
        defaultProvider="codex"
      />,
    );

    const composer = screen.getByRole("textbox", { name: /message composer/i });
    fireEvent.change(composer, { target: { value: "Summarise pacing" } });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(mocks.submitConsultation).toHaveBeenCalledTimes(1));
    expect(mocks.submitConsultation).toHaveBeenCalledWith({
      projectId: "project-1",
      parentThreadId: "thread-1",
      campaignGroupId: "cg-1",
      message: "@codex Summarise pacing",
    });
  });

  it("keeps send disabled for empty input", () => {
    render(
      <CampaignThreadComposer
        projectId="project-1"
        parentThreadId="thread-1"
        campaignGroupId="cg-1"
        defaultProvider="claude"
      />,
    );

    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });

  it("disables the composer when no parent thread is available", () => {
    render(
      <CampaignThreadComposer
        projectId="project-1"
        parentThreadId={undefined}
        campaignGroupId="cg-1"
        defaultProvider="claude"
      />,
    );

    expect(screen.getByRole("textbox", { name: /message composer/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });

  it("surfaces parser errors without submitting", async () => {
    render(
      <CampaignThreadComposer
        projectId="project-1"
        parentThreadId="thread-1"
        campaignGroupId="cg-1"
        defaultProvider="claude"
      />,
    );

    const composer = screen.getByRole("textbox", { name: /message composer/i });
    fireEvent.change(composer, { target: { value: "@codex" } });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(mocks.toastWarning).toHaveBeenCalled());
    expect(mocks.submitConsultation).not.toHaveBeenCalled();
    expect(composer).toHaveValue("@codex");
  });
});
