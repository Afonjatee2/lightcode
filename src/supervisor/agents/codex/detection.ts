import { compactAgentProviderMetadata, type AgentCapability } from "@/shared/contracts";
import {
  configFileAuthProbe,
  readAgentCommandOutput,
  type DetectionSpec,
  type StatusProbeResult,
} from "../base";
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
  presentationModes: ["terminal", "gui"],
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
    ...(probe.slashCommands?.length ? { slashCommands: probe.slashCommands } : {}),
    // All Codex models accept the `service_tier="fast"` config knob (per
    // openai/codex config schema), so every probed model can opt into Fast.
    ...(probe.models?.length ? { fastModels: probe.models.map((m) => m.id) } : {}),
  };
}

export function parseCodexLoginStatusOutput(output: string): StatusProbeResult | undefined {
  const trimmed = output.trim();
  if (!trimmed) return undefined;

  const authMethodMatch = /logged in using\s+(.+)$/im.exec(trimmed);
  if (authMethodMatch) {
    const providerMetadata = compactAgentProviderMetadata({
      authMethod: authMethodMatch[1]?.trim(),
    });
    return {
      authState: "authenticated",
      ...(providerMetadata ? { providerMetadata } : {}),
    };
  }

  if (/not\s+logged\s+in|login required|sign in/i.test(trimmed)) {
    return { authState: "unknown" };
  }

  return undefined;
}

async function probeCodexStatus(ctx: Parameters<NonNullable<DetectionSpec["statusProbe"]>>[0]) {
  if (!ctx.executablePath) return undefined;
  const result = await readAgentCommandOutput(ctx.location, ctx.executablePath, [
    "login",
    "status",
  ]);
  const parsed = parseCodexLoginStatusOutput(`${result.stdout}\n${result.stderr}`);
  if (parsed) return parsed;
  return result.ok ? { authState: "authenticated" as const } : { authState: "unknown" as const };
}

export const codexDetectionSpec: DetectionSpec = {
  kind: "codex",
  label: "Codex",
  binary: "codex",
  capabilities: codexDefaultCapabilities,
  statusProbe: probeCodexStatus,
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
