import type { AgentCapability } from "../../../shared/contracts";

type EffortCapability = Pick<AgentCapability, "efforts" | "modelEfforts" | "defaultEffort"> & {
  modelDefaultEfforts?: Record<string, string | undefined>;
};

export function getAvailableEfforts(capabilities: EffortCapability, model: string): string[] {
  const modelEfforts = capabilities.modelEfforts[model];
  return modelEfforts?.length ? modelEfforts : capabilities.efforts;
}

export function resolveEffortSelection(
  capabilities: EffortCapability,
  model: string,
  preferredCandidates: ReadonlyArray<string | undefined>,
): string {
  const availableEfforts = getAvailableEfforts(capabilities, model);
  if (availableEfforts.length === 0) {
    return "";
  }

  for (const candidate of preferredCandidates) {
    if (candidate && availableEfforts.includes(candidate)) {
      return candidate;
    }
  }

  const modelDefault = capabilities.modelDefaultEfforts?.[model];
  if (modelDefault && availableEfforts.includes(modelDefault)) {
    return modelDefault;
  }

  const globalDefault = capabilities.defaultEffort;
  if (globalDefault && availableEfforts.includes(globalDefault)) {
    return globalDefault;
  }

  return availableEfforts[0] ?? "";
}
