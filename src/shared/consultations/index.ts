/**
 * Stable public boundary for the Phase 4 campaign-consultation domain. The
 * renderer UI and the mention parser import from here so they never reach into
 * supervisor internals. Worker 2 appends parser exports below; do not reorder
 * or remove existing lines.
 */

export * from "./types";
export * from "./stateMachine";
export * from "./permissions";
export * from "./campaignContextProvider";
export * from "./fixtureCampaignContextProvider";
export * from "./result";
export * from "./resolve";
export * from "./parser";
