import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { SubmitDecisionResult } from "@/renderer/services/campaignDecisions/recordCampaignDecision";
import { RecordDecisionModal } from "./RecordDecisionModal";

function setup(overrides: Partial<Parameters<typeof RecordDecisionModal>[0]> = {}) {
  const submit =
    overrides.submit ??
    vi.fn<() => Promise<SubmitDecisionResult>>(() => Promise.resolve({ ok: true, decision: null }));
  const onRecorded = overrides.onRecorded ?? vi.fn<() => void>();
  const onClose = overrides.onClose ?? vi.fn<() => void>();
  render(
    <RecordDecisionModal
      isOpen
      onClose={onClose}
      campaignGroupId="group-1"
      channels={[]}
      ready
      submit={submit}
      onRecorded={onRecorded}
      {...overrides}
    />,
  );
  return { submit, onRecorded, onClose };
}

describe("RecordDecisionModal", () => {
  it("dispatches a correctly shaped record via submit, then refreshes and closes", async () => {
    const { submit, onRecorded, onClose } = setup();

    fireEvent.change(screen.getByLabelText("Decision statement"), {
      target: { value: "Keep TikTok running ahead of pace" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith({
      campaignGroupId: "group-1",
      title: "Keep TikTok running ahead of pace",
      effect: { mode: "annotate" },
    });
    // Context/decision refresh after a successful submit, then the modal closes.
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks submit and shows a validation error when the statement is empty", () => {
    const { submit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText("Enter what you decided.")).toBeTruthy();
  });

  it("surfaces a backend error verbatim without closing", async () => {
    const backendMessage = 'Control Centre API error 403: {"message":"operator role required"}';
    const onClose = vi.fn<() => void>();
    const { submit } = setup({
      onClose,
      submit: vi.fn<() => Promise<SubmitDecisionResult>>(() =>
        Promise.resolve({ ok: false, message: backendMessage }),
      ),
    });

    fireEvent.change(screen.getByLabelText("Decision statement"), {
      target: { value: "Do the thing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(backendMessage)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
