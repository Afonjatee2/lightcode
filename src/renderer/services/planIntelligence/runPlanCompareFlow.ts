import type { McpServer, ProjectLocation } from "@/shared/contracts";
import {
  buildPlanDiffViewModel,
  normalizeCompareMediaPlanVersionsResponse,
  normalizeFindLatestMediaPlanResponse,
  normalizeProposePlanUpdatesResponse,
  normalizeUploadMediaPlanResponse,
  resolveBasePlanVersionId,
  resolveUploadPlanVersionId,
  type PlanDiffViewModel,
  type ProposePlanUpdatesResponse,
} from "@/shared/contracts/campaign/planIntelligence";
import { callPlanIntelligenceMcpTool } from "./planIntelligenceClient";

export type PlanCompareFlowResult = {
  candidatePlanId: string;
  basePlanId: string;
  diffViewModel: PlanDiffViewModel;
  proposal: ProposePlanUpdatesResponse | null;
};

export class PlanIntelligenceFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanIntelligenceFlowError";
  }
}

function extractToolErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

type FlowContext = {
  server: McpServer;
  projectLocation?: ProjectLocation;
  campaignGroupId: string;
  jobNumber?: string | null;
};

async function uploadCandidatePlan(context: FlowContext, filePath: string): Promise<string> {
  try {
    const uploadRaw = await callPlanIntelligenceMcpTool({
      server: context.server,
      ...(context.projectLocation ? { projectLocation: context.projectLocation } : {}),
      toolName: "upload_media_plan",
      args: { filePath },
    });
    return resolveUploadPlanVersionId(normalizeUploadMediaPlanResponse(uploadRaw));
  } catch (error: unknown) {
    throw new PlanIntelligenceFlowError(extractToolErrorMessage(error));
  }
}

async function resolveBasePlanId(
  context: FlowContext,
  candidatePlanId: string,
): Promise<{ basePlanId: string; baseFilename: string | null }> {
  try {
    const latestRaw = await callPlanIntelligenceMcpTool({
      server: context.server,
      ...(context.projectLocation ? { projectLocation: context.projectLocation } : {}),
      toolName: "find_latest_media_plan",
      args: {
        campaignGroupId: context.campaignGroupId,
        ...(context.jobNumber ? { jobNumber: context.jobNumber } : {}),
        limit: 20,
      },
    });
    const latest = normalizeFindLatestMediaPlanResponse(latestRaw);
    const basePlanId = resolveBasePlanVersionId({ candidatePlanId, latest });
    if (!basePlanId) {
      throw new PlanIntelligenceFlowError(
        "No published plan was found to compare against. Upload a base plan first.",
      );
    }
    const baseFilename =
      latest.decision?.ranking.find((entry) => entry.resourceId === basePlanId)?.filename ?? null;
    return { basePlanId, baseFilename };
  } catch (error: unknown) {
    if (error instanceof PlanIntelligenceFlowError) throw error;
    throw new PlanIntelligenceFlowError(extractToolErrorMessage(error));
  }
}

async function comparePlanVersions(
  context: FlowContext,
  basePlanId: string,
  candidatePlanId: string,
  candidateFilename: string,
  baseFilename: string | null,
): Promise<PlanDiffViewModel> {
  try {
    const compareRaw = await callPlanIntelligenceMcpTool({
      server: context.server,
      ...(context.projectLocation ? { projectLocation: context.projectLocation } : {}),
      toolName: "compare_media_plan_versions",
      args: {
        planId: basePlanId,
        candidatePlanId,
      },
    });
    const compare = normalizeCompareMediaPlanVersionsResponse(compareRaw);
    return buildPlanDiffViewModel({
      compare,
      candidateFilename,
      baseFilename,
    });
  } catch (error: unknown) {
    throw new PlanIntelligenceFlowError(extractToolErrorMessage(error));
  }
}

export async function proposePlanUpdates(input: {
  context: FlowContext;
  candidatePlanId: string;
  basePlanId: string;
  allowLowConfidence?: boolean;
}): Promise<ProposePlanUpdatesResponse> {
  try {
    const proposeRaw = await callPlanIntelligenceMcpTool({
      server: input.context.server,
      ...(input.context.projectLocation ? { projectLocation: input.context.projectLocation } : {}),
      toolName: "propose_plan_updates",
      args: {
        candidatePlanId: input.candidatePlanId,
        basePlanVersionId: input.basePlanId,
        ...(input.allowLowConfidence ? { allowLowConfidence: true } : {}),
      },
    });
    return normalizeProposePlanUpdatesResponse(proposeRaw);
  } catch (error: unknown) {
    throw new PlanIntelligenceFlowError(extractToolErrorMessage(error));
  }
}

export async function runPlanCompareFlow(input: {
  server: McpServer;
  projectLocation?: ProjectLocation;
  campaignGroupId: string;
  jobNumber?: string | null;
  filePath: string;
  filename: string;
  createProposal?: boolean;
  allowLowConfidence?: boolean;
}): Promise<PlanCompareFlowResult> {
  const context: FlowContext = {
    server: input.server,
    ...(input.projectLocation ? { projectLocation: input.projectLocation } : {}),
    campaignGroupId: input.campaignGroupId,
    ...(input.jobNumber ? { jobNumber: input.jobNumber } : {}),
  };

  const candidatePlanId = await uploadCandidatePlan(context, input.filePath);
  const { basePlanId, baseFilename } = await resolveBasePlanId(context, candidatePlanId);
  const diffViewModel = await comparePlanVersions(
    context,
    basePlanId,
    candidatePlanId,
    input.filename,
    baseFilename,
  );

  let proposal: ProposePlanUpdatesResponse | null = null;
  if (input.createProposal) {
    proposal = await proposePlanUpdates({
      context,
      candidatePlanId,
      basePlanId,
      ...(input.allowLowConfidence ? { allowLowConfidence: true } : {}),
    });
  }

  return {
    candidatePlanId,
    basePlanId,
    diffViewModel,
    proposal,
  };
}
