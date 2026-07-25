import { msg } from "@lingui/core/macro";

export type ControlCentreUnavailableReason = "not-configured" | "disabled" | "connection-failed";

export function controlCentreUnavailableMessage(
  reason: Exclude<ControlCentreUnavailableReason, "connection-failed">,
): ReturnType<typeof msg> {
  if (reason === "disabled") {
    return msg`Control Centre is disabled. Turn it on in settings.`;
  }
  return msg`Control Centre is not connected. Add a Control Centre connection in settings.`;
}

export const controlCentreManualWorkspaceSuffix = msg`You can still create a campaign workspace manually, but live campaign context will not load until Control Centre is connected.`;
