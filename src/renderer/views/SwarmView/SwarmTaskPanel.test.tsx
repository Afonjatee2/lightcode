import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { SwarmTaskPanel } from "./SwarmTaskPanel";

describe("SwarmTaskPanel", () => {
  it("shows arbitrary attached file types and lets the user remove them", async () => {
    const onAttachFiles = vi.fn<() => Promise<void>>(async () => undefined);
    const onRemoveAttachment = vi.fn<(id: string) => void>();

    render(
      <SwarmTaskPanel
        task="Use the supplied references"
        attachments={[
          attachment("video", "/tmp/reference.mov", "reference.mov"),
          attachment("sheet", "/tmp/data.xlsx", "data.xlsx"),
          attachment("archive", "/tmp/assets.zip", "assets.zip"),
        ]}
        canStart
        onTaskChange={vi.fn<(task: string) => void>()}
        onAttachFiles={onAttachFiles}
        onRemoveAttachment={onRemoveAttachment}
        onStart={vi.fn<() => void>()}
      />,
    );

    expect(screen.getByText("reference.mov")).toBeInTheDocument();
    expect(screen.getByText("data.xlsx")).toBeInTheDocument();
    expect(screen.getByText("assets.zip")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Attach files" }));
    await waitFor(() => expect(onAttachFiles).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Remove reference.mov" }));
    expect(onRemoveAttachment).toHaveBeenCalledWith("video");
  });
});

function attachment(id: string, path: string, name: string) {
  return { id, path, name, isImage: false };
}
