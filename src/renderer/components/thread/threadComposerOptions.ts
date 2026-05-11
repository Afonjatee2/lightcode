import type { AgentCapability, ThreadPresentationMode } from "@/shared/contracts";

export function capabilitiesForPresentation(
  capabilities: AgentCapability,
  presentationMode: ThreadPresentationMode,
): AgentCapability {
  const override = capabilities.presentationCapabilities?.[presentationMode];
  if (!override) return capabilities;

  const {
    defaultEffort: _defaultEffort,
    contextSizes: _contextSizes,
    modelContextSizes: _modelContextSizes,
    defaultContextSize: _defaultContextSize,
    fastModels: _fastModels,
    thinkingModels: _thinkingModels,
    subProviders: _subProviders,
    modelSubProvider: _modelSubProvider,
    ...rest
  } = capabilities;

  return {
    ...rest,
    ...override,
    models: override.models ?? [],
    efforts: override.efforts ?? [],
    modelEfforts: override.modelEfforts ?? {},
    modes: override.modes ?? capabilities.modes,
    approvalPolicies: override.approvalPolicies ?? capabilities.approvalPolicies,
    sandboxModes: override.sandboxModes ?? capabilities.sandboxModes,
    supportsResume: override.supportsResume ?? capabilities.supportsResume,
    supportsDirectInput: override.supportsDirectInput ?? capabilities.supportsDirectInput,
    liveInputMode: override.liveInputMode ?? capabilities.liveInputMode,
    presentationMode: override.presentationMode ?? capabilities.presentationMode,
    settingDefs: override.settingDefs ?? capabilities.settingDefs,
    presentationCapabilities: capabilities.presentationCapabilities,
  };
}

/** Return capabilities with hidden models filtered out. */
export function filterHiddenModels(
  capabilities: AgentCapability,
  hiddenIds: readonly string[] | undefined,
): AgentCapability {
  if (!hiddenIds || hiddenIds.length === 0) return capabilities;
  const hidden = new Set(hiddenIds);
  return { ...capabilities, models: capabilities.models.filter((m) => !hidden.has(m.id)) };
}
