import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCampaignMessageWithAttachments,
  copyCampaignComposerAttachments,
} from "./campaignComposerAttachments";

const mocks = vi.hoisted(() => ({
  copyCampaignConsultationAttachments: vi.fn<
    (input: { projectId: string; sourcePaths: string[] }) => Promise<{
      copies: Array<{
        relativePath: string;
        fileName: string;
        sizeBytes: number;
        largeFile: boolean;
      }>;
    }>
  >(),
}));

vi.mock("@/renderer/i18n/i18n", () => ({
  i18n: {
    _: (message: { id?: string; message?: string; values?: Record<string, unknown> }) => {
      if (message.values?.["0"]) {
        return `Attached files: ${message.values["0"]}`;
      }
      return message.message ?? message.id ?? "";
    },
  },
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    copyCampaignConsultationAttachments: mocks.copyCampaignConsultationAttachments,
  }),
}));

describe("campaignComposerAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends relative attachment paths to a non-empty message", () => {
    expect(
      buildCampaignMessageWithAttachments("Check pacing", ["./attachments/plan-v3.xlsx"]),
    ).toBe("Check pacing\n\nAttached files: ./attachments/plan-v3.xlsx");
  });

  it("returns only the attachment line when the message is empty", () => {
    expect(buildCampaignMessageWithAttachments("", ["./attachments/plan-v3.xlsx"])).toBe(
      "Attached files: ./attachments/plan-v3.xlsx",
    );
  });

  it("returns the original message when there are no attachments", () => {
    expect(buildCampaignMessageWithAttachments("Hello", [])).toBe("Hello");
  });

  it("copies attachments through the bridge IPC", async () => {
    mocks.copyCampaignConsultationAttachments.mockResolvedValue({
      copies: [
        {
          relativePath: "./attachments/plan-v3.xlsx",
          fileName: "plan-v3.xlsx",
          sizeBytes: 12,
          largeFile: false,
        },
      ],
    });

    const copies = await copyCampaignComposerAttachments({
      projectId: "project-1",
      attachments: [
        {
          id: "att-1",
          path: "/tmp/plan-v3.xlsx",
          name: "plan-v3.xlsx",
          isImage: false,
        },
      ],
    });

    expect(mocks.copyCampaignConsultationAttachments).toHaveBeenCalledWith({
      projectId: "project-1",
      sourcePaths: ["/tmp/plan-v3.xlsx"],
    });
    expect(copies).toHaveLength(1);
  });

  it("skips the IPC call when there are no attachments", async () => {
    await expect(
      copyCampaignComposerAttachments({ projectId: "project-1", attachments: [] }),
    ).resolves.toEqual([]);
    expect(mocks.copyCampaignConsultationAttachments).not.toHaveBeenCalled();
  });
});
