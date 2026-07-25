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
  submitThreadInput:
    vi.fn<(threadId: string, prompt: string, segments?: unknown[]) => Promise<void>>(),
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
  pickFiles: vi.fn<() => Promise<string[] | null>>(),
  toastWarning: vi.fn<(message: string) => void>(),
  friendlyError: vi.fn<(error: unknown) => string>(() => "Safe consultation error"),
  addFiles: vi.fn<(paths: string[]) => void>(),
  removeAttachment: vi.fn<(id: string) => void>(),
  clearAll: vi.fn<() => void>(),
  addClipboardImage: vi.fn<(file: File, threadId: string) => Promise<void>>(),
  attachments: [] as Array<{
    id: string;
    path: string;
    name: string;
    isImage: boolean;
    mimeType?: string;
  }>,
}));

vi.mock("@/renderer/actions/consultationActions", () => ({
  submitConsultation: mocks.submitConsultation,
}));

vi.mock("@/renderer/actions/threadRuntimeActions", () => ({
  submitThreadInput: mocks.submitThreadInput,
}));

vi.mock("@/renderer/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/renderer/bridge")>();
  return {
    ...actual,
    isRemoteSession: () => false,
    readBridge: () => ({
      copyCampaignConsultationAttachments: mocks.copyCampaignConsultationAttachments,
      pickFiles: mocks.pickFiles,
    }),
  };
});

vi.mock("@/renderer/components/composer/useAttachments", () => ({
  useAttachments: () => ({
    attachments: mocks.attachments,
    addFiles: mocks.addFiles,
    removeAttachment: mocks.removeAttachment,
    clearAll: mocks.clearAll,
    addClipboardImage: mocks.addClipboardImage,
    addPicked:
      vi.fn<
        (input: {
          path: string;
          name: string;
          mimeType: string;
          selector: string;
          sourceUrl: string;
        }) => void
      >(),
    toSegments: () =>
      mocks.attachments.map((attachment) => ({
        kind: "attachment" as const,
        path: attachment.path,
        ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
      })),
    restore: vi.fn<(attachments: unknown[]) => void>(),
  }),
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
    mocks.attachments = [];
    mocks.submitThreadInput.mockResolvedValue(undefined);
    mocks.submitConsultation.mockResolvedValue({
      ok: true,
      consultation: { id: "consultation-1" },
    });
    mocks.copyCampaignConsultationAttachments.mockResolvedValue({ copies: [] });
    mocks.pickFiles.mockResolvedValue(null);
    mocks.addClipboardImage.mockResolvedValue(undefined);
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
    expect(mocks.clearAll).toHaveBeenCalled();
  });

  it("dispatches plain text to submitThreadInput on the active thread", async () => {
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

    await waitFor(() => expect(mocks.submitThreadInput).toHaveBeenCalledTimes(1));
    expect(mocks.submitThreadInput).toHaveBeenCalledWith("thread-1", "Summarise pacing", [
      { kind: "text", content: "Summarise pacing" },
    ]);
    expect(mocks.submitConsultation).not.toHaveBeenCalled();
    expect(composer).toHaveValue("");
    expect(mocks.clearAll).toHaveBeenCalled();
  });

  it("dispatches @verify mentions to submitConsultation", async () => {
    render(
      <CampaignThreadComposer
        projectId="project-1"
        parentThreadId="thread-1"
        campaignGroupId="cg-1"
        defaultProvider="claude"
      />,
    );

    const composer = screen.getByRole("textbox", { name: /message composer/i });
    fireEvent.change(composer, { target: { value: "@verify check the KPI evidence" } });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(mocks.submitConsultation).toHaveBeenCalledTimes(1));
    expect(mocks.submitConsultation).toHaveBeenCalledWith({
      projectId: "project-1",
      parentThreadId: "thread-1",
      campaignGroupId: "cg-1",
      message: "@verify check the KPI evidence",
    });
    expect(mocks.submitThreadInput).not.toHaveBeenCalled();
    expect(composer).toHaveValue("");
    expect(mocks.clearAll).toHaveBeenCalled();
  });

  it("copies attachments into the workspace and references them in consultation messages", async () => {
    mocks.attachments = [
      {
        id: "att-1",
        path: "/tmp/plan-v3.xlsx",
        name: "plan-v3.xlsx",
        isImage: false,
      },
    ];
    mocks.copyCampaignConsultationAttachments.mockResolvedValue({
      copies: [
        {
          relativePath: "./attachments/plan-v3.xlsx",
          fileName: "plan-v3.xlsx",
          sizeBytes: 42,
          largeFile: false,
        },
      ],
    });

    render(
      <CampaignThreadComposer
        projectId="project-1"
        parentThreadId="thread-1"
        campaignGroupId="cg-1"
        defaultProvider="codex"
      />,
    );

    const composer = screen.getByRole("textbox", { name: /message composer/i });
    fireEvent.change(composer, { target: { value: "@codex Review the plan" } });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(mocks.submitConsultation).toHaveBeenCalledTimes(1));
    expect(mocks.copyCampaignConsultationAttachments).toHaveBeenCalledWith({
      projectId: "project-1",
      sourcePaths: ["/tmp/plan-v3.xlsx"],
    });
    expect(mocks.submitConsultation).toHaveBeenCalledWith({
      projectId: "project-1",
      parentThreadId: "thread-1",
      campaignGroupId: "cg-1",
      message: "@codex Review the plan\n\nAttached files: ./attachments/plan-v3.xlsx",
    });
    expect(mocks.submitThreadInput).not.toHaveBeenCalled();
  });

  it("sends plain-text attachments through submitThreadInput segments", async () => {
    mocks.attachments = [
      {
        id: "att-1",
        path: "/tmp/plan-v3.xlsx",
        name: "plan-v3.xlsx",
        isImage: false,
      },
    ];

    render(
      <CampaignThreadComposer
        projectId="project-1"
        parentThreadId="thread-1"
        campaignGroupId="cg-1"
        defaultProvider="codex"
      />,
    );

    const composer = screen.getByRole("textbox", { name: /message composer/i });
    fireEvent.change(composer, { target: { value: "Review the plan" } });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(mocks.submitThreadInput).toHaveBeenCalledTimes(1));
    expect(mocks.copyCampaignConsultationAttachments).not.toHaveBeenCalled();
    expect(mocks.submitThreadInput).toHaveBeenCalledWith("thread-1", "Review the plan", [
      { kind: "attachment", path: "/tmp/plan-v3.xlsx" },
      { kind: "text", content: "Review the plan" },
    ]);
  });

  it("adds picked files through the attachment hook", async () => {
    mocks.pickFiles.mockResolvedValue(["/tmp/brief.pdf"]);

    render(
      <CampaignThreadComposer
        projectId="project-1"
        parentThreadId="thread-1"
        campaignGroupId="cg-1"
        defaultProvider="claude"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add attachment or capability/i }));
    fireEvent.click(screen.getByText("File"));

    await waitFor(() => expect(mocks.addFiles).toHaveBeenCalledWith(["/tmp/brief.pdf"]));
  });

  it("removes attachment chips before send", () => {
    mocks.attachments = [
      {
        id: "att-1",
        path: "/tmp/brief.pdf",
        name: "brief.pdf",
        isImage: false,
      },
    ];

    render(
      <CampaignThreadComposer
        projectId="project-1"
        parentThreadId="thread-1"
        campaignGroupId="cg-1"
        defaultProvider="claude"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /remove brief\.pdf/i }));
    expect(mocks.removeAttachment).toHaveBeenCalledWith("att-1");
  });

  it("handles drag-drop by adding files through the attachment hook", () => {
    window.poracode = {
      getDroppedFilePaths: () => ["/tmp/report.docx"],
    } as unknown as typeof window.poracode;

    const { container } = render(
      <CampaignThreadComposer
        projectId="project-1"
        parentThreadId="thread-1"
        campaignGroupId="cg-1"
        defaultProvider="claude"
      />,
    );

    fireEvent.dragEnter(container.firstChild as Element, {
      dataTransfer: {
        types: ["Files"],
        getData: () => "",
        files: [{ name: "report.docx" }],
      },
    });
    fireEvent.drop(container.firstChild as Element, {
      dataTransfer: {
        types: ["Files"],
        getData: () => "",
        files: [{ name: "report.docx" }],
      },
    });

    expect(mocks.addFiles).toHaveBeenCalledWith(["/tmp/report.docx"]);
  });

  it("keeps send disabled for empty input without attachments", () => {
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

  it("enables send when attachments are present without text", () => {
    mocks.attachments = [
      {
        id: "att-1",
        path: "/tmp/plan-v3.xlsx",
        name: "plan-v3.xlsx",
        isImage: false,
      },
    ];

    render(
      <CampaignThreadComposer
        projectId="project-1"
        parentThreadId="thread-1"
        campaignGroupId="cg-1"
        defaultProvider="claude"
      />,
    );

    expect(screen.getByRole("button", { name: /send message/i })).not.toBeDisabled();
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

  it("warns when a copied consultation attachment exceeds 100 MB", async () => {
    mocks.attachments = [
      {
        id: "att-1",
        path: "/tmp/huge.zip",
        name: "huge.zip",
        isImage: false,
      },
    ];
    mocks.copyCampaignConsultationAttachments.mockResolvedValue({
      copies: [
        {
          relativePath: "./attachments/huge.zip",
          fileName: "huge.zip",
          sizeBytes: 101 * 1024 * 1024,
          largeFile: true,
        },
      ],
    });

    render(
      <CampaignThreadComposer
        projectId="project-1"
        parentThreadId="thread-1"
        campaignGroupId="cg-1"
        defaultProvider="codex"
      />,
    );

    const composer = screen.getByRole("textbox", { name: /message composer/i });
    fireEvent.change(composer, { target: { value: "@codex review this archive" } });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(mocks.toastWarning).toHaveBeenCalled());
    expect(mocks.submitConsultation).toHaveBeenCalled();
    expect(mocks.submitThreadInput).not.toHaveBeenCalled();
  });
});
