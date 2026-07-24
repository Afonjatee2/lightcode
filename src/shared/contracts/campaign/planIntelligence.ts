import { z } from "zod";

/** Best-available cell reference inside a source workbook. */
export const planCellRefSchema = z.object({
  sheet: z.string().nullable().optional(),
  cell: z.string().nullable().optional(),
  range: z.string().nullable().optional(),
  rowIndex: z.number().nullable().optional(),
  columnIndex: z.number().nullable().optional(),
});

/** Cell-level provenance for a single parsed value. */
export const planProvenanceSchema = z.object({
  resourceId: z.string(),
  filename: z.string(),
  source: z.string(),
  cell: planCellRefSchema,
  parserConfidence: z.number(),
  warnings: z.array(z.string()),
});

export const planFieldChangeSchema = z.object({
  field: z.string(),
  kind: z.string(),
  scope: z.enum(["plan", "line"]),
  lineKey: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  beforeProvenance: planProvenanceSchema.nullable(),
  afterProvenance: planProvenanceSchema.nullable(),
  lowConfidence: z.boolean(),
});

export const planLineChangeSchema = z.object({
  lineKey: z.string(),
  kind: z.enum(["added", "removed"]),
  line: z
    .object({
      lineKey: z.string(),
      channel: z
        .object({
          value: z.union([z.string(), z.null()]).optional(),
          provenance: planProvenanceSchema.optional(),
        })
        .passthrough()
        .optional(),
      platform: z.string().nullable().optional(),
      objective: z
        .object({
          value: z.union([z.string(), z.null()]).optional(),
          provenance: planProvenanceSchema.optional(),
        })
        .passthrough()
        .optional(),
      budget: z
        .object({
          value: z.union([z.number(), z.null()]).optional(),
          provenance: planProvenanceSchema.optional(),
        })
        .passthrough()
        .nullable()
        .optional(),
    })
    .passthrough(),
});

export const planLowConfidenceValueSchema = z.object({
  field: z.string(),
  lineKey: z.string().nullable(),
  value: z.unknown(),
  confidence: z.number(),
  provenance: planProvenanceSchema,
});

export const planDiffSchema = z.object({
  baseResourceId: z.string(),
  candidateResourceId: z.string(),
  addedLines: z.array(planLineChangeSchema),
  removedLines: z.array(planLineChangeSchema),
  fieldChanges: z.array(planFieldChangeSchema),
  unchangedFields: z.array(z.string()),
  matchedLineCount: z.number(),
  parserWarnings: z.array(
    z.object({
      level: z.enum(["info", "warn", "error"]),
      message: z.string(),
      sheet: z.string().optional(),
      rowIndex: z.number().optional(),
    }),
  ),
  lowConfidenceValues: z.array(planLowConfidenceValueSchema),
  identical: z.boolean(),
  fingerprintBefore: z.string(),
  fingerprintAfter: z.string(),
});

export const rankedPlanRevisionSchema = z.object({
  resourceId: z.string(),
  filename: z.string(),
  source: z.string(),
  score: z.number(),
  rank: z.number(),
  reasons: z.array(z.string()),
  tieBreakers: z.array(z.string()),
});

export const latestPlanRevisionDecisionSchema = z.object({
  chosen: rankedPlanRevisionSchema,
  ranking: z.array(rankedPlanRevisionSchema),
  confidence: z.enum(["high", "medium", "low"]),
  ambiguous: z.boolean(),
  rationale: z.string(),
});

export const findLatestMediaPlanResponseSchema = z.object({
  decision: latestPlanRevisionDecisionSchema.nullable(),
});

export const compareMediaPlanVersionsResponseSchema = z.object({
  planId: z.string(),
  candidatePlanId: z.string().nullable(),
  diff: planDiffSchema,
});

export const planActionProposalRecordSchema = z.object({
  id: z.string(),
  campaignGroupId: z.string(),
  actionType: z.string(),
  status: z.string(),
  title: z.string(),
  summary: z.string().nullable().optional(),
  basePlanVersionId: z.string().nullable().optional(),
});

export const proposePlanUpdatesResponseSchema = z.object({
  proposal: planActionProposalRecordSchema,
});

export const uploadMediaPlanResponseSchema = z.union([
  z.object({ id: z.string() }),
  z.object({ imports: z.array(z.object({ id: z.string() })).min(1) }),
]);

export type PlanProvenance = z.infer<typeof planProvenanceSchema>;
export type PlanFieldChange = z.infer<typeof planFieldChangeSchema>;
export type PlanLineChange = z.infer<typeof planLineChangeSchema>;
export type PlanDiff = z.infer<typeof planDiffSchema>;
export type CompareMediaPlanVersionsResponse = z.infer<
  typeof compareMediaPlanVersionsResponseSchema
>;
export type FindLatestMediaPlanResponse = z.infer<typeof findLatestMediaPlanResponseSchema>;
export type ProposePlanUpdatesResponse = z.infer<typeof proposePlanUpdatesResponseSchema>;
export type UploadMediaPlanResponse = z.infer<typeof uploadMediaPlanResponseSchema>;

export type PlanDiffRowKind = "changed" | "added" | "removed";

export type PlanDiffProvenanceViewModel = {
  cellLabel: string | null;
  publishedValue: string;
  revisedValue: string;
  matchedBy: string | null;
  confidenceNote: string | null;
  parserConfidence: number | null;
};

export type PlanDiffRowViewModel = {
  id: string;
  kind: PlanDiffRowKind;
  lineItem: string;
  lineItemDetail: string | null;
  field: string;
  before: string;
  after: string;
  sourceCell: string | null;
  parserConfidence: number | null;
  lowConfidence: boolean;
  provenance: PlanDiffProvenanceViewModel | null;
};

export type PlanDiffSummaryViewModel = {
  changed: number;
  added: number;
  removed: number;
  unchanged: number;
  lowConfidence: number;
};

export type PlanDiffViewModel = {
  basePlanId: string;
  candidatePlanId: string;
  baseLabel: string;
  candidateLabel: string;
  summary: PlanDiffSummaryViewModel;
  rows: PlanDiffRowViewModel[];
  identical: boolean;
  parserWarningCount: number;
};

function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim() === "" ? "—" : value;
  if (typeof value === "boolean") return value ? "true" : "false";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function provenancedLineLabel(line: PlanLineChange["line"]): string {
  const channel =
    line.channel && typeof line.channel === "object" && "value" in line.channel
      ? line.channel.value
      : null;
  const objective =
    line.objective && typeof line.objective === "object" && "value" in line.objective
      ? line.objective.value
      : null;
  const platform = line.platform ?? null;
  const parts = [platform, channel, objective].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : line.lineKey;
}

function provenancedLineDetail(line: PlanLineChange["line"]): string | null {
  const placement =
    "placement" in line &&
    line.placement &&
    typeof line.placement === "object" &&
    "value" in line.placement
      ? line.placement.value
      : null;
  return typeof placement === "string" && placement.trim() !== "" ? placement : null;
}

export function formatProvenanceCell(provenance: PlanProvenance | null | undefined): string | null {
  if (!provenance) return null;
  const sheet = provenance.cell.sheet?.trim();
  const cell = provenance.cell.cell?.trim();
  if (sheet && cell) return `${sheet}!${cell}`;
  if (sheet) return sheet;
  if (cell) return cell;
  return null;
}

export function formatProvenanceLocation(
  provenance: PlanProvenance | null | undefined,
): string | null {
  if (!provenance) return null;
  const cell = formatProvenanceCell(provenance);
  const parts = [provenance.filename, cell].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function humanizeFieldName(field: string): string {
  return field
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function lineItemLabel(lineKey: string | null): string {
  if (!lineKey) return "Plan";
  const [platform, ...rest] = lineKey.split("|");
  if (rest.length === 0) return platform ?? lineKey;
  return [platform, rest.join(" · ")].filter(Boolean).join(" · ");
}

export function buildPlanDiffViewModel(input: {
  compare: CompareMediaPlanVersionsResponse;
  candidateFilename: string;
  baseFilename?: string | null;
}): PlanDiffViewModel {
  const { diff } = input.compare;
  const rows: PlanDiffRowViewModel[] = [];

  for (const change of diff.fieldChanges) {
    const provenance = change.afterProvenance ?? change.beforeProvenance;
    rows.push({
      id: `field:${change.scope}:${change.lineKey ?? "plan"}:${change.field}`,
      kind: "changed",
      lineItem: lineItemLabel(change.lineKey),
      lineItemDetail: change.scope === "line" ? change.lineKey : null,
      field: humanizeFieldName(change.field),
      before: formatDiffValue(change.before),
      after: formatDiffValue(change.after),
      sourceCell: formatProvenanceCell(provenance),
      parserConfidence: provenance?.parserConfidence ?? null,
      lowConfidence: change.lowConfidence,
      provenance: provenance
        ? {
            cellLabel: formatProvenanceLocation(provenance),
            publishedValue: formatDiffValue(change.before),
            revisedValue: formatDiffValue(change.after),
            matchedBy: change.lineKey ? `Row key: ${change.lineKey}` : null,
            confidenceNote: provenance.warnings.length > 0 ? provenance.warnings.join(" · ") : null,
            parserConfidence: provenance.parserConfidence,
          }
        : null,
    });
  }

  for (const added of diff.addedLines) {
    const provenance =
      added.line.budget && "provenance" in added.line.budget
        ? added.line.budget.provenance
        : added.line.channel && "provenance" in added.line.channel
          ? added.line.channel.provenance
          : null;
    rows.push({
      id: `added:${added.lineKey}`,
      kind: "added",
      lineItem: provenancedLineLabel(added.line),
      lineItemDetail: provenancedLineDetail(added.line),
      field: "Line",
      before: "—",
      after: "Added",
      sourceCell: formatProvenanceCell(provenance ?? null),
      parserConfidence: provenance?.parserConfidence ?? null,
      lowConfidence: false,
      provenance: provenance
        ? {
            cellLabel: formatProvenanceLocation(provenance),
            publishedValue: "—",
            revisedValue: "Added",
            matchedBy: "New row — no key in published plan",
            confidenceNote: provenance.warnings.length > 0 ? provenance.warnings.join(" · ") : null,
            parserConfidence: provenance.parserConfidence,
          }
        : null,
    });
  }

  for (const removed of diff.removedLines) {
    const provenance =
      removed.line.budget && "provenance" in removed.line.budget
        ? removed.line.budget.provenance
        : removed.line.channel && "provenance" in removed.line.channel
          ? removed.line.channel.provenance
          : null;
    rows.push({
      id: `removed:${removed.lineKey}`,
      kind: "removed",
      lineItem: provenancedLineLabel(removed.line),
      lineItemDetail: provenancedLineDetail(removed.line),
      field: "Line",
      before: "Present",
      after: "Removed",
      sourceCell: formatProvenanceCell(provenance ?? null),
      parserConfidence: provenance?.parserConfidence ?? null,
      lowConfidence: false,
      provenance: provenance
        ? {
            cellLabel: formatProvenanceLocation(provenance),
            publishedValue: "Present",
            revisedValue: "Removed",
            matchedBy: "Row present in published plan, absent in revision",
            confidenceNote: provenance.warnings.length > 0 ? provenance.warnings.join(" · ") : null,
            parserConfidence: provenance.parserConfidence,
          }
        : null,
    });
  }

  return {
    basePlanId: input.compare.planId,
    candidatePlanId: input.compare.candidatePlanId ?? diff.candidateResourceId,
    baseLabel: input.baseFilename ?? "Published plan",
    candidateLabel: input.candidateFilename,
    summary: {
      changed: diff.fieldChanges.length,
      added: diff.addedLines.length,
      removed: diff.removedLines.length,
      unchanged: diff.unchangedFields.length,
      lowConfidence: diff.lowConfidenceValues.length,
    },
    rows,
    identical: diff.identical,
    parserWarningCount: diff.parserWarnings.length,
  };
}

export function resolveUploadPlanVersionId(response: UploadMediaPlanResponse): string {
  if ("id" in response) return response.id;
  const first = response.imports[0];
  if (!first) throw new Error("upload_media_plan returned no plan versions");
  return first.id;
}

export function resolveBasePlanVersionId(input: {
  candidatePlanId: string;
  latest: FindLatestMediaPlanResponse;
}): string | null {
  const ranking = input.latest.decision?.ranking ?? [];
  const alternate = ranking
    .slice()
    .sort((left, right) => left.rank - right.rank)
    .find((entry) => entry.resourceId !== input.candidatePlanId);
  return alternate?.resourceId ?? null;
}

export function normalizeCompareMediaPlanVersionsResponse(
  raw: unknown,
): CompareMediaPlanVersionsResponse {
  return compareMediaPlanVersionsResponseSchema.parse(raw);
}

export function normalizeFindLatestMediaPlanResponse(raw: unknown): FindLatestMediaPlanResponse {
  return findLatestMediaPlanResponseSchema.parse(raw);
}

export function normalizeProposePlanUpdatesResponse(raw: unknown): ProposePlanUpdatesResponse {
  return proposePlanUpdatesResponseSchema.parse(raw);
}

export function normalizeUploadMediaPlanResponse(raw: unknown): UploadMediaPlanResponse {
  return uploadMediaPlanResponseSchema.parse(raw);
}
