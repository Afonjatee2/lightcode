import { homedir } from "node:os";
import { join } from "node:path";
import { stripAnsi } from "@/shared/ansi";
import {
  type AgentSlashCommand,
  compactAgentProviderMetadata,
  type AgentCapability,
  type AgentConnectedProvider,
  type ProjectLocation,
} from "@/shared/contracts";
import { configFileAuthProbe, readAgentCommandOutput, type DetectionSpec } from "../base";
import { buildContextSizeCapabilities } from "../contextWindowLabel";

// Canonical ordering for the union effort list. Anything OpenCode reports
// outside this set gets appended after these in discovery order so we never
// silently hide a variant. `none` is OpenCode's "skip reasoning" variant on
// GPT-class models — kept first so it sorts ahead of the actual effort
// gradient.
const CANONICAL_EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

// Per-model default — preferred when the model exposes it, falling back to
// the highest-precedence available variant. Mirrors how Claude defaults to
// `high`; OpenCode defaults to `medium` because several Zen models (GPT-5.5,
// Sonnet) make `medium` their lowest paid-effort tier.
const OPENCODE_PREFERRED_DEFAULT_EFFORT = "medium";

export const opencodeDefaultCapabilities: AgentCapability = {
  models: [],
  efforts: [],
  modelEfforts: {},
  // OpenCode exposes two built-in agents: `build` (default) and `plan`. The
  // SDK accepts an `agent` field on `prompt_async`; the renderer's Plan toggle
  // flips `ThreadConfig.mode` and the SDK session translates "plan" → agent.
  modes: ["agent", "plan"],
  approvalPolicies: [
    { id: "default", label: "Default" },
    { id: "yolo", label: "Bypass Permissions" },
  ],
  sandboxModes: [],
  supportsResume: true,
  supportsDirectInput: true,
  liveInputMode: "terminal",
  presentationMode: "terminal",
  // GUI presentation routes through `OpencodeSdkSession` (long-lived
  // `opencode serve` + SDK SSE stream); terminal stays the default and uses
  // the same SDK helper for one-shot session-id allocation.
  presentationModes: ["terminal", "gui"],
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

// `opencode models --verbose` interleaves `provider/model` headers with
// pretty-printed JSON for each model. We split on header lines (column-0,
// non-`{}`, matching the `provider/model` shape) and parse each block to pull
// out the `variants` keys — those are the OpenCode "model variant" names that
// `--variant` (CLI) and `prompt_async.variant` (SDK) accept and that we
// surface as effort options in the composer.
const OPENCODE_MODEL_HEADER_RE = /^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_.-]*$/i;

interface OpenCodeProbedModel {
  id: string;
  variants: string[];
  contextLimit?: number;
}

interface OpenCodeCommandLike {
  name?: string;
  description?: string;
  hints?: string[];
  source?: string;
  template?: string;
}

export function mapOpenCodeSlashCommands(
  commands: readonly OpenCodeCommandLike[],
): AgentSlashCommand[] {
  return commands.flatMap((command) => {
    const id = command.name?.trim();
    if (!id) return [];
    const description = command.description?.trim();
    const argumentHint = command.hints
      ?.map((hint) => hint.trim())
      .filter(Boolean)
      .join(" ");
    return [
      {
        id,
        label: description ? `${id} — ${description}` : id,
        ...(description ? { description } : {}),
        ...(argumentHint ? { argumentHint } : {}),
      },
    ];
  });
}

export function parseOpenCodeVerboseModels(stdout: string): OpenCodeProbedModel[] {
  const lines = stdout.split(/\r?\n/g);
  const entries: { id: string; jsonLines: string[] }[] = [];
  let currentId: string | undefined;
  let buf: string[] = [];
  for (const line of lines) {
    if (OPENCODE_MODEL_HEADER_RE.test(line)) {
      if (currentId) entries.push({ id: currentId, jsonLines: buf });
      currentId = line;
      buf = [];
    } else if (currentId) {
      buf.push(line);
    }
  }
  if (currentId) entries.push({ id: currentId, jsonLines: buf });

  return entries.map(({ id, jsonLines }) => {
    const json = jsonLines.join("\n").trim();
    if (!json) return { id, variants: [] };
    try {
      const obj = JSON.parse(json) as {
        variants?: Record<string, unknown>;
        limit?: { context?: unknown };
      };
      const variants =
        obj.variants && typeof obj.variants === "object" ? Object.keys(obj.variants) : [];
      const rawContext = obj.limit?.context;
      const contextLimit =
        typeof rawContext === "number" && Number.isFinite(rawContext) && rawContext > 0
          ? Math.trunc(rawContext)
          : undefined;
      return {
        id,
        variants,
        ...(contextLimit !== undefined ? { contextLimit } : {}),
      };
    } catch {
      return { id, variants: [] };
    }
  });
}

async function probeOpenCodeModels(
  location: ProjectLocation,
  executablePath: string,
): Promise<OpenCodeProbedModel[] | undefined> {
  const result = await readAgentCommandOutput(location, executablePath, ["models", "--verbose"], {
    // Verbose mode prints a JSON object per model — slower than the bare
    // `models` listing but still bounded by OpenCode's local cache.
    timeoutMs: 15_000,
  });
  if (!result.ok || !result.stdout) return undefined;
  const parsed = parseOpenCodeVerboseModels(result.stdout);
  return parsed.length > 0 ? parsed : undefined;
}

const OPENCODE_TITLE_TOKEN_OVERRIDES: Record<string, string> = {
  api: "API",
  aws: "AWS",
  chatgpt: "ChatGPT",
  claude: "Claude",
  codestral: "Codestral",
  copilot: "Copilot",
  deepseek: "DeepSeek",
  devstral: "Devstral",
  gemini: "Gemini",
  github: "GitHub",
  glm: "GLM",
  gpt: "GPT",
  grok: "Grok",
  groq: "Groq",
  haiku: "Haiku",
  kimi: "Kimi",
  llama: "Llama",
  llm: "LLM",
  max: "Max",
  mini: "Mini",
  mistral: "Mistral",
  ollama: "Ollama",
  openai: "OpenAI",
  opencode: "OpenCode",
  openrouter: "OpenRouter",
  opus: "Opus",
  oss: "OSS",
  pro: "Pro",
  qwen: "Qwen",
  sonnet: "Sonnet",
  xai: "xAI",
};

function titleizeOpenCodeToken(token: string): string {
  const lower = token.toLowerCase();
  const override = OPENCODE_TITLE_TOKEN_OVERRIDES[lower];
  if (override) return override;
  if (/^o\d/.test(lower)) return lower;
  if (/^[a-z]\d/.test(lower)) return lower.charAt(0).toUpperCase() + lower.slice(1);
  const size = /^(\d+)([bkmt])$/i.exec(token);
  if (size) {
    const [, amount, unit] = size;
    return `${amount}${unit!.toUpperCase()}`;
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}

function titleizeOpenCodeName(name: string): string {
  const rawParts = name.split(/[-_\s]+/g).filter(Boolean);
  const parts: string[] = [];

  for (let i = 0; i < rawParts.length; i += 1) {
    const part = rawParts[i]!;
    const next = rawParts[i + 1];
    if (/^\d{1,2}$/.test(part) && next && /^\d{1,2}$/.test(next)) {
      parts.push(`${part}.${next}`);
      i += 1;
      continue;
    }
    parts.push(titleizeOpenCodeToken(part));
  }

  return parts.join(" ");
}

function openCodeModelNamePart(id: string): string {
  const slash = id.indexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id;
}

function openCodeModelSubProvider(id: string): string | undefined {
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(0, slash) : undefined;
}

function formatOpenCodeCredentialType(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "api") return "API";
  if (trimmed === "oauth") return "OAuth";
  return trimmed;
}

export function parseOpenCodeProvidersList(output: string): AgentConnectedProvider[] {
  const providers: AgentConnectedProvider[] = [];
  for (const rawLine of stripAnsi(output).split(/\r?\n/g)) {
    const line = rawLine.trim();
    const bullet = /^[●•]\s+(.+)$/.exec(line);
    if (!bullet) continue;
    const text = bullet[1]!.trim();
    const match = /^(.*?)\s+(api|oauth)$/i.exec(text);
    const label = (match?.[1] ?? text).trim();
    providers.push({
      label: label === "GitHub Copilot" ? "Copilot" : label,
      ...(formatOpenCodeCredentialType(match?.[2])
        ? { detail: formatOpenCodeCredentialType(match?.[2]) }
        : {}),
    });
  }
  return providers;
}

async function probeOpenCodeStatus(ctx: Parameters<NonNullable<DetectionSpec["statusProbe"]>>[0]) {
  if (!ctx.executablePath) return undefined;
  const result = await readAgentCommandOutput(ctx.location, ctx.executablePath, [
    "providers",
    "list",
  ]);
  const text = `${result.stdout}\n${result.stderr}`.trim();
  const connectedProviders = parseOpenCodeProvidersList(text);
  const credentialsCountMatch = /(\d+)\s+credentials\b/i.exec(text);
  const credentialsCount = credentialsCountMatch ? Number(credentialsCountMatch[1]) : undefined;
  const providerMetadata = compactAgentProviderMetadata({
    ...(connectedProviders.length > 0 ? { connectedProviders } : {}),
  });

  return {
    ...(connectedProviders.length > 0 || (credentialsCount ?? 0) > 0
      ? { authState: "authenticated" as const }
      : /0\s+credentials\b/i.test(text)
        ? { authState: "missing" as const }
        : {}),
    ...(providerMetadata ? { providerMetadata } : {}),
  };
}

export function humanizeOpenCodeModelId(id: string): string {
  return titleizeOpenCodeName(openCodeModelNamePart(id));
}

export function humanizeOpenCodeSubProviderId(id: string): string {
  if (id === "github-copilot") return "Copilot";
  return titleizeOpenCodeName(id);
}

export const opencodeDetectionSpec: DetectionSpec = {
  kind: "opencode",
  label: "OpenCode",
  binary: "opencode",
  loginCommand: "opencode auth login",
  capabilities: opencodeDefaultCapabilities,
  statusProbe: probeOpenCodeStatus,
  authProbes: [
    // Auth file lives on the host; for WSL projects we report "unknown"
    // (`undefined` skips the probe) because the WSL distro has its own
    // copy under `$HOME/.local/share/opencode/auth.json`.
    configFileAuthProbe((loc) => (loc.kind === "wsl" ? undefined : opencodeNativeAuthPath())),
  ],
  async capabilitiesProbe(ctx) {
    if (!ctx.executablePath) return undefined;
    const probed = await probeOpenCodeModels(ctx.location, ctx.executablePath);
    if (!probed) return undefined;
    const modelIds = probed.map((m) => m.id);
    const subProviderIds = [...new Set(modelIds.map(openCodeModelSubProvider).filter(isString))];

    // Per-model variant lists feed the composer effort picker via
    // `getAvailableEfforts(capabilities, model)` — empty arrays mean "no
    // effort selector for this model", which is the right default for free
    // models like `opencode/big-pickle` whose `variants: {}` we already saw.
    const modelEfforts: Record<string, string[]> = {};
    const seenEfforts = new Set<string>();
    for (const m of probed) {
      modelEfforts[m.id] = m.variants;
      for (const v of m.variants) seenEfforts.add(v);
    }
    const ordered: string[] = [];
    for (const e of CANONICAL_EFFORT_ORDER) {
      if (seenEfforts.has(e)) {
        ordered.push(e);
        seenEfforts.delete(e);
      }
    }
    // Append any non-canonical variant names OpenCode reported, preserving
    // discovery order — keeps us forward-compatible with new variants.
    for (const e of seenEfforts) ordered.push(e);

    // Map each model to its registry-reported context limit so the renderer's
    // context-usage dock can show "X / Y tokens" before any message has flowed
    // through `context.updated`. OpenCode's `models --verbose` emits a Model
    // object whose `limit.context` is the upstream context window in tokens.
    const modelTokens = new Map<string, number>();
    for (const m of probed) {
      if (m.contextLimit !== undefined) modelTokens.set(m.id, m.contextLimit);
    }

    return {
      models: modelIds.map((id) => ({ id, label: humanizeOpenCodeModelId(id) })),
      subProviders: subProviderIds.map((id) => ({
        id,
        label: humanizeOpenCodeSubProviderId(id),
      })),
      efforts: ordered,
      modelEfforts,
      ...(ordered.includes(OPENCODE_PREFERRED_DEFAULT_EFFORT)
        ? { defaultEffort: OPENCODE_PREFERRED_DEFAULT_EFFORT }
        : ordered.length > 0
          ? { defaultEffort: ordered[0] }
          : {}),
      ...buildContextSizeCapabilities(modelTokens),
    };
  },
};
