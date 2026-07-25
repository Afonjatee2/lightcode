import { msg } from "@lingui/core/macro";

export type ControlCentreUnavailableReason = "not-configured" | "disabled" | "connection-failed";

export function controlCentreUnavailableMessage(
  reason: Exclude<ControlCentreUnavailableReason, "connection-failed">,
): ReturnType<typeof msg> {
  if (reason === "disabled") {
    return msg`The Control Centre MCP server is disabled. Enable it in MCP settings.`;
  }
  return msg`No MCP server named "control-centre" is configured. Add one in MCP settings.`;
}

export const controlCentreManualWorkspaceSuffix = msg`You can still create a campaign workspace manually, but live campaign context will not load until Control Centre is connected.`;
