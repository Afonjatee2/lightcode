import { msg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";
import type { RecordCampaignDecisionArgs } from "@/shared/contracts/campaign/controlCentreCampaignDecision";
import { readBridge } from "@/renderer/bridge";
import { useProject } from "@/renderer/state/useThread";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { resolveControlCentreServer } from "./useControlCentreTool";
import {
  submitCampaignDecision,
  type SubmitDecisionResult,
} from "@/renderer/services/campaignDecisions/recordCampaignDecision";

export interface RecordCampaignDecision {
  /** True once a Control Centre server is resolvable for this project. */
  ready: boolean;
  submit: (args: RecordCampaignDecisionArgs) => Promise<SubmitDecisionResult>;
}

/**
 * Returns a `submit` that records a campaign decision through the same
 * renderer → supervisor `callMcpTool` transport the context/plan-intelligence
 * flows use — no new transport. The server owns the `record_campaign_decision`
 * tool surface (it lives in the `plan_revision` profile); if the active
 * profile doesn't expose it, the resulting `tool-error` message is surfaced
 * verbatim rather than pre-empted by any client-side gating.
 */
export function useRecordCampaignDecision(projectId: string | undefined): RecordCampaignDecision {
  const project = useProject(projectId);
  const userMcpServers = useSharedSettings((s) => s.mcpServers);
  const server = resolveControlCentreServer(project, userMcpServers);

  return {
    ready: Boolean(server),
    submit: (args) => {
      if (!server) {
        return Promise.resolve({
          ok: false,
          message: i18n._(msg`No Control Centre MCP server is configured for this project.`),
        });
      }
      return submitCampaignDecision(
        (toolName, toolArgs) =>
          readBridge().callMcpTool({
            server,
            ...(project?.location ? { projectLocation: project.location } : {}),
            toolName,
            args: toolArgs,
          }),
        args,
      );
    },
  };
}
