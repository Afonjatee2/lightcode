import type { PrState } from "@/shared/contracts";

export type PrStatusTone = "merged" | "draft" | "danger" | "warning" | "success";

export function getPrStatusTone(
  state: PrState | undefined,
  checksStatus: string | undefined,
): PrStatusTone {
  if (state === "merged") return "merged";
  if (state === "draft") return "draft";
  if (checksStatus === "FAILURE" || checksStatus === "ERROR") return "danger";
  if (checksStatus === "PENDING") return "warning";
  return "success";
}

export const PR_TONE_BG_CLASS: Record<PrStatusTone, string> = {
  merged: "bg-purple-400",
  draft: "bg-gray-400",
  danger: "bg-danger",
  warning: "bg-warning",
  success: "bg-success",
};

export const PR_TONE_TEXT_CLASS: Record<PrStatusTone, string> = {
  merged: "text-purple-400",
  draft: "text-gray-400",
  danger: "text-danger",
  warning: "text-warning",
  success: "text-success",
};
