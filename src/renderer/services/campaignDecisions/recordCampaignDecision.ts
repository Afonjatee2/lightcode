import { msg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";
import type { McpToolCallResult } from "@/shared/contracts";
import {
  controlCentreCampaignDecisionDetailSchema,
  type ControlCentreCampaignDecisionDetail,
  type RecordCampaignDecisionArgs,
} from "@/shared/contracts/campaign/controlCentreCampaignDecision";

/** Invokes one Control Centre MCP tool. Injected so the submit path is testable. */
export type CallControlCentreTool = (toolName: string, args: unknown) => Promise<McpToolCallResult>;

export type SubmitDecisionResult =
  | { ok: true; decision: ControlCentreCampaignDecisionDetail | null }
  | { ok: false; message: string };

/**
 * Dispatches `record_campaign_decision` with the given (already validated)
 * arguments and normalises the result.
 *
 * This records operator intent only. It never approves proposals, changes
 * budgets, or writes to an ad platform — there is no apply/execute path here.
 *
 * Backend validation errors are surfaced VERBATIM: a `tool-error` carries the
 * server's own message (e.g. `Control Centre API error 400: {...}`) straight
 * through, never swallowed or reworded.
 */
export async function submitCampaignDecision(
  callTool: CallControlCentreTool,
  args: RecordCampaignDecisionArgs,
): Promise<SubmitDecisionResult> {
  const result = await callTool("record_campaign_decision", args);

  if (result.status === "auth-required") {
    return {
      ok: false,
      message: i18n._(msg`Control Centre needs authorization. Reconnect it in MCP settings.`),
    };
  }
  if (result.status === "unavailable") {
    return { ok: false, message: result.error.message };
  }
  if (result.status === "tool-error") {
    // Verbatim backend message — the server is the authority on validity.
    return { ok: false, message: result.message };
  }
  if (typeof result.content === "string") {
    return {
      ok: false,
      message: i18n._(
        msg`Control Centre returned a response that was too large or malformed. Try again.`,
      ),
    };
  }

  // The decision was recorded. Parse the returned detail if we can, but a
  // shape we don't recognise doesn't undo the write — the panel refetches
  // decisions regardless.
  const parsed = controlCentreCampaignDecisionDetailSchema.safeParse(result.content);
  return { ok: true, decision: parsed.success ? parsed.data : null };
}
