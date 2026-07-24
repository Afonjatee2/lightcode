import type { DragEvent } from "react";

const COMPOSER_FILE_DRAG_TYPE = "application/poracode-composer-file";

export function hasComposerAttachmentDragData(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).some(
    (type) => type === "Files" || type === COMPOSER_FILE_DRAG_TYPE,
  );
}

export function resolveComposerAttachmentDropPaths(dataTransfer: DataTransfer): string[] {
  const payload = dataTransfer.getData(COMPOSER_FILE_DRAG_TYPE);
  if (payload) {
    try {
      const parsed = JSON.parse(payload) as { path?: unknown; type?: unknown };
      return typeof parsed.path === "string" && parsed.type === "file" ? [parsed.path] : [];
    } catch {
      return [];
    }
  }
  return window.poracode.getDroppedFilePaths(Array.from(dataTransfer.files));
}

export function handleComposerAttachmentDragEnter(
  event: DragEvent<HTMLDivElement>,
  onAttachFiles: ((paths: string[]) => void) | undefined,
  depthRef: { current: number },
  setDropActive: (active: boolean) => void,
): void {
  if (!onAttachFiles || !hasComposerAttachmentDragData(event.dataTransfer)) return;
  event.preventDefault();
  depthRef.current += 1;
  event.dataTransfer.dropEffect = "copy";
  setDropActive(true);
}

export function handleComposerAttachmentDragOver(
  event: DragEvent<HTMLDivElement>,
  onAttachFiles: ((paths: string[]) => void) | undefined,
): void {
  if (!onAttachFiles || !hasComposerAttachmentDragData(event.dataTransfer)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

export function handleComposerAttachmentDragLeave(
  event: DragEvent<HTMLDivElement>,
  onAttachFiles: ((paths: string[]) => void) | undefined,
  depthRef: { current: number },
  setDropActive: (active: boolean) => void,
): void {
  if (!onAttachFiles || !hasComposerAttachmentDragData(event.dataTransfer)) return;
  depthRef.current = Math.max(0, depthRef.current - 1);
  if (depthRef.current === 0) {
    setDropActive(false);
  }
}

export function handleComposerAttachmentDrop(
  event: DragEvent<HTMLDivElement>,
  onAttachFiles: ((paths: string[]) => void) | undefined,
  depthRef: { current: number },
  setDropActive: (active: boolean) => void,
): void {
  if (!onAttachFiles || !hasComposerAttachmentDragData(event.dataTransfer)) return;
  event.preventDefault();
  depthRef.current = 0;
  setDropActive(false);
  const paths = resolveComposerAttachmentDropPaths(event.dataTransfer);
  if (paths.length > 0) {
    onAttachFiles(paths);
  }
}
