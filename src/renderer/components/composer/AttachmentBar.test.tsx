import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttachmentBar } from "./AttachmentBar";
import type { Attachment } from "./useAttachments";

describe("AttachmentBar", () => {
  it("renders image attachments as labeled inset chips by default", () => {
    const onPreviewImage = vi.fn<(attachment: Attachment) => void>();
    const { container } = render(
      <AttachmentBar
        attachments={[
          {
            id: "image-1",
            path: "/tmp/screenshot.png",
            name: "screenshot.png",
            mimeType: "image/png",
            isImage: true,
          },
        ]}
        onPreviewImage={onPreviewImage}
      />,
    );

    expect(container.firstElementChild).toHaveClass(
      "lightcode-attachment-bar",
      "lightcode-attachment-bar--inset",
    );
    expect(screen.getByText("screenshot.png")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button"));
    expect(onPreviewImage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "image-1",
        path: "/tmp/screenshot.png",
      }),
    );
  });

  it("renders flush attachment bars for inline message attachments", () => {
    const { container } = render(
      <AttachmentBar
        attachments={[
          {
            id: "file-1",
            path: "/tmp/notes.md",
            name: "notes.md",
            isImage: false,
          },
        ]}
        layout="flush"
      />,
    );

    expect(container.firstElementChild).toHaveClass("lightcode-attachment-bar");
    expect(container.firstElementChild).not.toHaveClass("lightcode-attachment-bar--inset");
  });
});
