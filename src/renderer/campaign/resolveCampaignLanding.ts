import type { AppView } from "@/shared/contracts";

/**
 * Decide whether a returning campaign operator should land on the campaign
 * Today home instead of the neutral default surface.
 *
 * Pure decision logic (unit-tested in `resolveCampaignLanding.test.ts`), kept
 * separate from the hydration effect that applies it. Three guards, in order:
 *
 * 1. Never bypass a first-run welcome — if the welcome overlay hasn't been
 *    dismissed yet, we leave the boot flow untouched.
 * 2. Only redirect actual campaign operators — a user with no campaign-purpose
 *    project keeps their existing behaviour.
 * 3. Only override the neutral default (`home`) landing — never clobber a
 *    restored working session such as a thread, draft, or a view the user
 *    already navigated to (including `campaignToday` itself).
 */
export function shouldLandOnCampaignToday(input: {
  welcomeSeen: boolean;
  hasCampaignProject: boolean;
  restoredViewKind: AppView["kind"];
}): boolean {
  if (!input.welcomeSeen) return false;
  if (!input.hasCampaignProject) return false;
  return input.restoredViewKind === "home";
}
