import { describe, expect, it } from "vitest";
import {
  buildPlanDiffViewModel,
  compareMediaPlanVersionsResponseSchema,
  findLatestMediaPlanResponseSchema,
  formatProvenanceCell,
  normalizeCompareMediaPlanVersionsResponse,
  normalizeFindLatestMediaPlanResponse,
  normalizeProposePlanUpdatesResponse,
  normalizeUploadMediaPlanResponse,
  proposePlanUpdatesResponseSchema,
  resolveBasePlanVersionId,
  resolveUploadPlanVersionId,
  uploadMediaPlanResponseSchema,
} from "./planIntelligence";
import {
  planIntelligenceCompareFixture,
  planIntelligenceFindLatestFixture,
  planIntelligenceProposeFixture,
} from "./fixtures/planIntelligenceCompare.fixture";

describe("planIntelligence contracts", () => {
  it("parses the compare fixture", () => {
    const parsed = compareMediaPlanVersionsResponseSchema.safeParse(planIntelligenceCompareFixture);
    expect(parsed.success).toBe(true);
  });

  it("parses find-latest and propose fixtures", () => {
    expect(
      findLatestMediaPlanResponseSchema.safeParse(planIntelligenceFindLatestFixture).success,
    ).toBe(true);
    expect(proposePlanUpdatesResponseSchema.safeParse(planIntelligenceProposeFixture).success).toBe(
      true,
    );
  });

  it("normalizes compare responses at the boundary", () => {
    const normalized = normalizeCompareMediaPlanVersionsResponse(planIntelligenceCompareFixture);
    expect(normalized.diff.fieldChanges).toHaveLength(3);
    expect(normalized.planId).toBe("pv-published-v6");
  });

  it("builds diff rows with provenance and unattributed fields", () => {
    const viewModel = buildPlanDiffViewModel({
      compare: planIntelligenceCompareFixture,
      candidateFilename: "media_plan_august_v2.xlsx",
      baseFilename: "media_plan_august_v6.xlsx",
    });

    expect(viewModel.summary.changed).toBe(3);
    expect(viewModel.summary.added).toBe(1);
    expect(viewModel.summary.removed).toBe(1);
    expect(viewModel.rows.some((row) => row.sourceCell === "Meta!D14")).toBe(true);

    const unattributed = viewModel.rows.find((row) => row.field === "Target Value");
    expect(unattributed?.provenance?.publishedValue).toBe("620");
    expect(unattributed?.before).toBe("620");
  });

  it("formats provenance cells and resolves upload/base ids", () => {
    const provenance = planIntelligenceCompareFixture.diff.fieldChanges[0]!.afterProvenance!;
    expect(formatProvenanceCell(provenance)).toBe("Meta!D14");

    expect(
      resolveUploadPlanVersionId(normalizeUploadMediaPlanResponse({ id: "plan-upload-1" })),
    ).toBe("plan-upload-1");
    expect(
      resolveUploadPlanVersionId(
        normalizeUploadMediaPlanResponse({ imports: [{ id: "plan-upload-2" }] }),
      ),
    ).toBe("plan-upload-2");

    const baseId = resolveBasePlanVersionId({
      candidatePlanId: "pv-revised-v2",
      latest: normalizeFindLatestMediaPlanResponse(planIntelligenceFindLatestFixture),
    });
    expect(baseId).toBe("pv-published-v6");
  });

  it("normalizes propose responses for approval hand-off", () => {
    const proposal = normalizeProposePlanUpdatesResponse(planIntelligenceProposeFixture);
    expect(proposal.proposal.id).toBe("proposal-plan-replace-1");
    expect(proposal.proposal.status).toBe("awaiting_approval");
  });

  it("rejects malformed upload payloads", () => {
    expect(uploadMediaPlanResponseSchema.safeParse({ imports: [] }).success).toBe(false);
  });
});
