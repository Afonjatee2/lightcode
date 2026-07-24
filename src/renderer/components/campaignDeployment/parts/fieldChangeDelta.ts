import type { ProposalFieldChange } from "../actionProposalViewModel";

export type FieldChangeDelta = {
  label: string;
  direction: "up" | "down" | "neutral";
};

export function deriveFieldChangeDelta(change: ProposalFieldChange): FieldChangeDelta | null {
  const { currentValue, proposedValue } = change;
  if (currentValue === null || proposedValue === null) return null;

  if (typeof currentValue === "number" && typeof proposedValue === "number") {
    if (proposedValue === currentValue) return null;
    return {
      label: `${proposedValue > currentValue ? "+" : ""}${(proposedValue - currentValue).toLocaleString()}`,
      direction: proposedValue > currentValue ? "up" : "down",
    };
  }

  if (typeof currentValue === "string" && typeof proposedValue === "string") {
    if (currentValue === proposedValue) return null;
    return { label: proposedValue, direction: "neutral" };
  }

  return null;
}
