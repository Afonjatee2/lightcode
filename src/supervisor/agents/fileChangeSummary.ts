import type { FileChangePayload } from "@/shared/contracts";

type DiffSummary = NonNullable<FileChangePayload["diffSummary"]>;

export function readDiffSummary(...sources: unknown[]): DiffSummary | undefined {
  for (const source of sources) {
    const summary = readDiffSummaryInner(source);
    if (summary) return summary;
  }
  return undefined;
}

function readDiffSummaryInner(source: unknown): DiffSummary | undefined {
  if (!source || typeof source !== "object") return undefined;
  const record = source as Record<string, unknown>;
  return (
    readDiffSummaryRecord(record.diffSummary) ??
    readDiffSummaryRecord(record.diff_summary) ??
    readDiffSummaryRecord(record)
  );
}

function readDiffSummaryRecord(source: unknown): DiffSummary | undefined {
  if (!source || typeof source !== "object") return undefined;
  const record = source as Record<string, unknown>;
  const added = readCount(record.added ?? record.additions);
  const removed = readCount(record.removed ?? record.deletions);
  return added !== undefined && removed !== undefined ? { added, removed } : undefined;
}

function readCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}
