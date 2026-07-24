const MEDIA_PLAN_EXTENSIONS = new Set([".xlsx", ".xls", ".xlsm", ".csv"]);

export function isMediaPlanFilename(filename: string): boolean {
  const lower = filename.trim().toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return MEDIA_PLAN_EXTENSIONS.has(lower.slice(dot));
}

export function extractAttachmentPathsFromMessage(message: string): string[] {
  const match = message.match(/Attached files:\s*(.+)$/m);
  if (!match?.[1]) return [];
  return match[1]
    .trim()
    .split(/\s+/)
    .filter((path) => path.length > 0);
}

export function mediaPlanAttachmentsFromMessage(
  message: string,
): Array<{ path: string; fileName: string }> {
  return extractAttachmentPathsFromMessage(message)
    .filter((path) => isMediaPlanFilename(path))
    .map((path) => ({
      path,
      fileName: path.split("/").pop() ?? path,
    }));
}
