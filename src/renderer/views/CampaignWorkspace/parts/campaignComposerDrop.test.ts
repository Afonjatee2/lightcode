import { describe, expect, it, vi } from "vitest";
import {
  handleComposerAttachmentDrop,
  hasComposerAttachmentDragData,
  resolveComposerAttachmentDropPaths,
} from "./campaignComposerDrop";

describe("campaignComposerDrop", () => {
  it("detects file drag payloads", () => {
    const dataTransfer = {
      types: ["Files"],
      getData: () => "",
      files: [],
    } as unknown as DataTransfer;
    expect(hasComposerAttachmentDragData(dataTransfer)).toBe(true);
  });

  it("resolves composer file drag payloads", () => {
    const dataTransfer = {
      types: ["application/poracode-composer-file"],
      getData: () => JSON.stringify({ path: "/tmp/report.pdf", type: "file" }),
      files: [],
    } as unknown as DataTransfer;
    expect(resolveComposerAttachmentDropPaths(dataTransfer)).toEqual(["/tmp/report.pdf"]);
  });

  it("delegates native file drops to the bridge helper", () => {
    const getDroppedFilePaths = vi
      .fn<(files: File[]) => string[]>()
      .mockReturnValue(["/tmp/notes.docx"]);
    window.poracode = { getDroppedFilePaths } as unknown as typeof window.poracode;

    const dataTransfer = {
      types: ["Files"],
      getData: () => "",
      files: [{ name: "notes.docx" }],
    } as unknown as DataTransfer;

    expect(resolveComposerAttachmentDropPaths(dataTransfer)).toEqual(["/tmp/notes.docx"]);
    expect(getDroppedFilePaths).toHaveBeenCalledWith([{ name: "notes.docx" }]);
  });

  it("attaches dropped paths", () => {
    const onAttachFiles = vi.fn<(paths: string[]) => void>();
    const depthRef = { current: 1 };
    const setDropActive = vi.fn<(active: boolean) => void>();
    const event = {
      preventDefault: vi.fn<() => void>(),
      dataTransfer: {
        types: ["Files"],
        getData: () => "",
        files: [{ name: "brief.pdf" }],
      },
    } as unknown as React.DragEvent<HTMLDivElement>;

    window.poracode = {
      getDroppedFilePaths: () => ["/tmp/brief.pdf"],
    } as unknown as typeof window.poracode;

    handleComposerAttachmentDrop(event, onAttachFiles, depthRef, setDropActive);

    expect(onAttachFiles).toHaveBeenCalledWith(["/tmp/brief.pdf"]);
    expect(depthRef.current).toBe(0);
    expect(setDropActive).toHaveBeenCalledWith(false);
  });
});
