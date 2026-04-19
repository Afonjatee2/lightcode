import type { AgentCapability } from "@/shared/contracts";
import { configFileAuthProbe, type DetectionSpec } from "../base";
import { probeCodexCapabilities, type CodexProbeResult } from "./probe";
import { codexAuthPath } from "./sessionFiles";

export const codexDefaultCapabilities: AgentCapability = {
  models: [],
  efforts: [],
  modelEfforts: {},
  modes: ["agent", "plan"],
  approvalPolicies: [],
  sandboxModes: [],
  supportsResume: true,
  supportsDirectInput: true,
  liveInputMode: "terminal",
  presentationMode: "terminal",
  bypassApprovalPolicy: "full-auto",
  settingDefs: [],
};

export function probeResultToCapabilityPartial(probe: CodexProbeResult): Partial<AgentCapability> {
  return {
    ...(probe.models?.length ? { models: probe.models } : {}),
    ...(probe.efforts?.length ? { efforts: probe.efforts } : {}),
    ...(probe.defaultEffort ? { defaultEffort: probe.defaultEffort } : {}),
    ...(probe.modelEfforts ? { modelEfforts: probe.modelEfforts } : {}),
    ...(probe.approvalPolicies?.length ? { approvalPolicies: probe.approvalPolicies } : {}),
    ...(probe.sandboxModes?.length ? { sandboxModes: probe.sandboxModes } : {}),
  };
}

export const codexDetectionSpec: DetectionSpec = {
  kind: "codex",
  label: "Codex",
  binary: "codex",
  capabilities: codexDefaultCapabilities,
  authProbes: [
    // Auth file lives on the host — skip for WSL projects (matches prior "unknown").
    configFileAuthProbe((loc) => (loc.kind === "wsl" ? undefined : codexAuthPath())),
  ],
  async capabilitiesProbe(ctx) {
    const probe = await probeCodexCapabilities(ctx.location, {
      ...(ctx.location.kind === "wsl" && ctx.executablePath
        ? { wslExecPath: ctx.executablePath }
        : {}),
      timeoutMs: 12_000,
      label:
        ctx.location.kind === "wsl"
          ? `codex:wsl:${ctx.location.distro}`
          : `codex:${ctx.location.kind}`,
    });
    return probe ? probeResultToCapabilityPartial(probe) : undefined;
  },
};
