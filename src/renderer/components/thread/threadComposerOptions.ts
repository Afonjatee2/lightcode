import type { AgentCapability } from "@/shared/contracts";

/** Return capabilities with hidden models filtered out. */
export function filterHiddenModels(
  capabilities: AgentCapability,
  hiddenIds: readonly string[] | undefined,
): AgentCapability {
  if (!hiddenIds || hiddenIds.length === 0) return capabilities;
  const hidden = new Set(hiddenIds);
  return { ...capabilities, models: capabilities.models.filter((m) => !hidden.has(m.id)) };
}
