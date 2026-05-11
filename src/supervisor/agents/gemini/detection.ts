import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentCapability } from "@/shared/contracts";
import { compactAgentProviderMetadata } from "@/shared/contracts";
import { probeAcpCapabilities } from "../acp";
import {
  batchWslCommandsAsync,
  buildAgentCommand,
  envVarAuthProbe,
  type AuthProbe,
  type DetectionSpec,
} from "../base";

export const defaultGeminiCapabilities: AgentCapability = {
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
  presentationModes: ["terminal", "gui"],
  bypassApprovalPolicy: "yolo",
  settingDefs: [],
};

// WSL-only: Gemini stores a config dir at ~/.gemini after first login —
// treat its presence as authenticated even without GEMINI_API_KEY set.
const configDirAuthProbe: AuthProbe = async (ctx) => {
  if (ctx.location.kind !== "wsl") return undefined;
  const [result] = await batchWslCommandsAsync(ctx.location.distro, [
    "test -d ~/.gemini && echo yes",
  ]);
  return result?.ok && result.stdout.trim() === "yes" ? "authenticated" : "unknown";
};

/**
 * Gemini's CLI writes the active Google account email to
 * `~/.gemini/google_accounts.json` after `gemini auth login`. Shape:
 *   { "active": "user@gmail.com", "old": [ ... ] }
 * Returns the active email when the file is well-formed.
 */
export function parseGeminiGoogleAccountsJson(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as { active?: unknown };
    return typeof parsed.active === "string" && parsed.active.trim().length > 0
      ? parsed.active.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

async function probeGeminiMetadata(ctx: Parameters<NonNullable<DetectionSpec["statusProbe"]>>[0]) {
  if (ctx.location.kind === "wsl") {
    const [apiKeyResult, configDirResult, accountsResult] = await batchWslCommandsAsync(
      ctx.location.distro,
      [
        'printf %s "$GEMINI_API_KEY"',
        "test -d ~/.gemini && echo yes",
        'cat ~/.gemini/google_accounts.json 2>/dev/null || printf ""',
      ],
    );
    const apiKeySet = !!(apiKeyResult?.ok && apiKeyResult.stdout.trim().length > 0);
    const configDirPresent = !!(configDirResult?.ok && configDirResult.stdout.trim() === "yes");
    const activeAccount =
      !apiKeySet && accountsResult?.ok && accountsResult.stdout.length > 0
        ? parseGeminiGoogleAccountsJson(accountsResult.stdout)
        : undefined;
    const providerMetadata = compactAgentProviderMetadata({
      ...(activeAccount ? { authenticatedAs: activeAccount } : {}),
      ...(apiKeySet ? { authMethod: "API key" } : {}),
      ...(!apiKeySet && configDirPresent && !activeAccount ? { authMethod: "Google account" } : {}),
    });
    return providerMetadata ? { providerMetadata } : undefined;
  }

  const apiKeySet =
    typeof process.env.GEMINI_API_KEY === "string" && process.env.GEMINI_API_KEY.trim().length > 0;
  const accountsPath = join(homedir(), ".gemini", "google_accounts.json");
  let activeAccount: string | undefined;
  if (!apiKeySet) {
    try {
      activeAccount = parseGeminiGoogleAccountsJson(readFileSync(accountsPath, "utf8"));
    } catch {
      activeAccount = undefined;
    }
  }
  const configDirPresent = existsSync(join(homedir(), ".gemini"));
  const providerMetadata = compactAgentProviderMetadata({
    ...(activeAccount ? { authenticatedAs: activeAccount } : {}),
    ...(apiKeySet ? { authMethod: "API key" } : {}),
    ...(!apiKeySet && configDirPresent && !activeAccount ? { authMethod: "Google account" } : {}),
  });
  return providerMetadata ? { providerMetadata } : undefined;
}

export const geminiDetectionSpec: DetectionSpec = {
  kind: "gemini",
  label: "Gemini",
  binary: "gemini",
  capabilities: defaultGeminiCapabilities,
  statusProbe: probeGeminiMetadata,
  authProbes: [envVarAuthProbe(["GEMINI_API_KEY"]), configDirAuthProbe],
  async capabilitiesProbe(ctx) {
    if (!ctx.executablePath) return undefined;
    // Bypass Gemini's folder-trust check during the probe so the AgentRegistry
    // doesn't emit "Skipping project agents..." onto stdout, which can collide
    // with JSON-RPC frames and break the ACP parser.
    const trustEnv = { GEMINI_CLI_TRUST_WORKSPACE: "true" };
    const probeCmd =
      ctx.location.kind === "wsl"
        ? buildAgentCommand(ctx.location, "gemini", ["--acp"], ctx.executablePath, trustEnv)
        : buildAgentCommand(ctx.location, ctx.executablePath, ["--acp"]);
    const probeCwd = ctx.location.kind === "wsl" ? "/tmp" : homedir();
    const probeResult = await probeAcpCapabilities(probeCmd.command, probeCmd.args, probeCwd, {
      timeoutMs: 15_000,
      label:
        ctx.location.kind === "wsl"
          ? `gemini:wsl:${ctx.location.distro}`
          : `gemini:${ctx.location.kind}`,
      ...(ctx.location.kind === "wsl" ? {} : { env: trustEnv }),
    });
    if (!probeResult) return undefined;
    return {
      ...(probeResult.models?.length ? { models: probeResult.models } : {}),
      ...(probeResult.efforts?.length ? { efforts: probeResult.efforts } : {}),
      ...(probeResult.defaultEffort ? { defaultEffort: probeResult.defaultEffort } : {}),
      ...(probeResult.modes?.length ? { modes: probeResult.modes } : {}),
      ...(probeResult.approvalPolicies?.length
        ? { approvalPolicies: probeResult.approvalPolicies }
        : {}),
      ...(probeResult.slashCommands?.length ? { slashCommands: probeResult.slashCommands } : {}),
    };
  },
};
