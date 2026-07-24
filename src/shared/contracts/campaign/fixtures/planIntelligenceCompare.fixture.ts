import type { CompareMediaPlanVersionsResponse } from "../planIntelligence";

/** Realistic compare payload mirroring Control Centre Phase 7 plan intelligence. */
export const planIntelligenceCompareFixture: CompareMediaPlanVersionsResponse = {
  planId: "pv-published-v6",
  candidatePlanId: "pv-revised-v2",
  diff: {
    baseResourceId: "pv-published-v6",
    candidateResourceId: "pv-revised-v2",
    addedLines: [
      {
        lineKey: "TikTok|LAL 1%",
        kind: "added",
        line: {
          lineKey: "TikTok|LAL 1%",
          platform: "TikTok",
          channel: { value: "LAL 1%" },
          budget: {
            value: 45,
            provenance: {
              resourceId: "pv-revised-v2",
              filename: "media_plan_august_v2.xlsx",
              source: "uploaded_file",
              cell: { sheet: "Social", cell: "D31" },
              parserConfidence: 0.95,
              warnings: [],
            },
          },
        },
      },
    ],
    removedLines: [
      {
        lineKey: "Snapchat|Broad NI",
        kind: "removed",
        line: {
          lineKey: "Snapchat|Broad NI",
          platform: "Snapchat",
          channel: { value: "Broad NI" },
          budget: {
            value: 30,
            provenance: {
              resourceId: "pv-published-v6",
              filename: "media_plan_august_v6.xlsx",
              source: "cc_upload",
              cell: { sheet: "Social", cell: "C18" },
              parserConfidence: 0.88,
              warnings: ["could be an intentional cut"],
            },
          },
        },
      },
    ],
    fieldChanges: [
      {
        field: "budget",
        kind: "budget",
        scope: "line",
        lineKey: "Meta|FTTP Interest",
        before: 120,
        after: 150,
        beforeProvenance: {
          resourceId: "pv-published-v6",
          filename: "media_plan_august_v6.xlsx",
          source: "cc_upload",
          cell: { sheet: "Meta", cell: "D14" },
          parserConfidence: 0.98,
          warnings: [],
        },
        afterProvenance: {
          resourceId: "pv-revised-v2",
          filename: "media_plan_august_v2.xlsx",
          source: "uploaded_file",
          cell: { sheet: "Meta", cell: "D14" },
          parserConfidence: 0.98,
          warnings: [],
        },
        lowConfidence: false,
      },
      {
        field: "startDate",
        kind: "date",
        scope: "line",
        lineKey: "Video|Bumper NI",
        before: "2026-07-30",
        after: "2026-08-02",
        beforeProvenance: {
          resourceId: "pv-published-v6",
          filename: "media_plan_august_v6.xlsx",
          source: "cc_upload",
          cell: { sheet: "Video", cell: "F9" },
          parserConfidence: 0.74,
          warnings: ['date "2/8" ambiguous — assumed d/M'],
        },
        afterProvenance: {
          resourceId: "pv-revised-v2",
          filename: "media_plan_august_v2.xlsx",
          source: "uploaded_file",
          cell: { sheet: "Video", cell: "F9" },
          parserConfidence: 0.74,
          warnings: ['date "2/8" ambiguous — assumed d/M'],
        },
        lowConfidence: true,
      },
      {
        field: "targetValue",
        kind: "kpi",
        scope: "plan",
        lineKey: null,
        before: 620,
        after: 700,
        beforeProvenance: null,
        afterProvenance: {
          resourceId: "pv-revised-v2",
          filename: "media_plan_august_v2.xlsx",
          source: "uploaded_file",
          cell: { sheet: "Targets", cell: "B4" },
          parserConfidence: 0.99,
          warnings: [],
        },
        lowConfidence: false,
      },
    ],
    unchangedFields: ["clientName", "jobNumber", "endDate"],
    matchedLineCount: 18,
    parserWarnings: [
      {
        level: "warn",
        message: 'Date cell "2/8" is locale-ambiguous',
        sheet: "Video",
        rowIndex: 9,
      },
    ],
    lowConfidenceValues: [
      {
        field: "startDate",
        lineKey: "Video|Bumper NI",
        value: "2026-08-02",
        confidence: 0.74,
        provenance: {
          resourceId: "pv-revised-v2",
          filename: "media_plan_august_v2.xlsx",
          source: "uploaded_file",
          cell: { sheet: "Video", cell: "F9" },
          parserConfidence: 0.74,
          warnings: ['date "2/8" ambiguous — assumed d/M'],
        },
      },
    ],
    identical: false,
    fingerprintBefore: "a1b2c3d4",
    fingerprintAfter: "e5f6a7b8",
  },
};

export const planIntelligenceFindLatestFixture = {
  decision: {
    chosen: {
      resourceId: "pv-revised-v2",
      filename: "media_plan_august_v2.xlsx",
      source: "uploaded_file",
      score: 0.91,
      rank: 1,
      reasons: ["Explicit version marker v2"],
      tieBreakers: [],
    },
    ranking: [
      {
        resourceId: "pv-revised-v2",
        filename: "media_plan_august_v2.xlsx",
        source: "uploaded_file",
        score: 0.91,
        rank: 1,
        reasons: ["Explicit version marker v2"],
        tieBreakers: [],
      },
      {
        resourceId: "pv-published-v6",
        filename: "media_plan_august_v6.xlsx",
        source: "cc_upload",
        score: 0.82,
        rank: 2,
        reasons: ["Published plan currently in effect"],
        tieBreakers: [],
      },
    ],
    confidence: "high" as const,
    ambiguous: false,
    rationale: "v2 upload ranks above the published v6 base on explicit version markers.",
  },
};

export const planIntelligenceProposeFixture = {
  proposal: {
    id: "proposal-plan-replace-1",
    campaignGroupId: "group-1",
    actionType: "plan.replace",
    status: "awaiting_approval",
    title: "Replace published plan with media_plan_august_v2.xlsx",
    summary: "9 field changes, 3 added lines, 2 removed lines",
    basePlanVersionId: "pv-published-v6",
  },
};
