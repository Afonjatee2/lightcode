import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentCapability, ProjectLocation } from "@/shared/contracts";
import { configFileAuthProbe, readAgentCommandOutput, type DetectionSpec } from "../base";

export const opencodeDefaultCapabilities: AgentCapability = {
  models: [],
  efforts: [],
  modelEfforts: {},
  modes: [],
  approvalPolicies: [],
  sandboxModes: [],
  supportsResume: true,
  supportsDirectInput: true,
  liveInputMode: "terminal",
  presentationMode: "terminal",
  bypassApprovalPolicy: "yolo",
  settingDefs: [],
};

/**
 * OpenCode stores its credentials in `~/.local/share/opencode/auth.json`
 * after `opencode auth login`. Existence is good enough as an "authenticated"
 * signal — the host can't validate the token without spending a request.
 */
function opencodeNativeAuthPath(): string {
  return join(homedir(), ".local", "share", "opencode", "auth.json");
}

// `opencode models` prints one `provider/model` per line; we surface every
// line as an opaque model id (UI doesn't parse them).
async function probeOpenCodeModels(
  location: ProjectLocation,
  executablePath: string,
): Promise<string[] | undefined> {
  const result = await readAgentCommandOutput(location, executablePath, ["models"], {
    timeoutMs: 8_000,
  });
  if (!result.ok || !result.stdout) return undefined;
  const lines = result.stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && /\//.test(line));
  return lines.length > 0 ? lines : undefined;
}

export const opencodeDetectionSpec: DetectionSpec = {
  kind: "opencode",
  label: "OpenCode",
  binary: "opencode",
  capabilities: opencodeDefaultCapabilities,
  authProbes: [
    // Auth file lives on the host; for WSL projects we report "unknown"
    // (`undefined` skips the probe) because the WSL distro has its own
    // copy under `$HOME/.local/share/opencode/auth.json`.
    configFileAuthProbe((loc) => (loc.kind === "wsl" ? undefined : opencodeNativeAuthPath())),
  ],
  async capabilitiesProbe(ctx) {
    if (!ctx.executablePath) return undefined;
    const models = await probeOpenCodeModels(ctx.location, ctx.executablePath);
    if (!models) return undefined;
    return {
      models: models.map((id) => ({ id, label: id })),
    };
  },
};
