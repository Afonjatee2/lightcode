import type { CSSProperties, ReactNode } from "react";
import type { StatusTone } from "./statusTone";

// --- Icon registry ---

type IconComponent = (props: { tone: StatusTone; className?: string }) => ReactNode;

const ICON_REGISTRY = new Map<string, IconComponent>();

export function registerProviderIcon(kind: string, icon: IconComponent) {
  ICON_REGISTRY.set(kind, icon);
}

function externalIconStyle(src: string): CSSProperties {
  const cssUrl = `url(${JSON.stringify(src)})`;
  return {
    WebkitMaskImage: cssUrl,
    maskImage: cssUrl,
  };
}

function DoneCheckOverlay() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="lightcode-provider-icon__done-check text-success"
    >
      <path
        d="M5 13l4 4L19 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExternalProviderIcon(props: { src: string; tone: StatusTone; className?: string }) {
  const style = externalIconStyle(props.src);
  return (
    <span
      className={`lightcode-provider-icon lightcode-provider-icon--external lightcode-provider-icon--${props.tone}${props.className ? ` ${props.className}` : ""}`}
    >
      <span
        className={`lightcode-provider-icon__mask${props.tone === "done" ? " opacity-40" : ""}`}
        style={style}
      />
      {props.tone === "working" ? (
        <span
          className="lightcode-provider-icon__mask lightcode-provider-icon__mask-scan"
          style={style}
        />
      ) : null}
      {props.tone === "done" ? <DoneCheckOverlay /> : null}
    </span>
  );
}

function fallbackInitial(label: string | undefined): string {
  const raw = label?.replace(/^acp-generic:/, "").trim() ?? "";
  return (raw.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
}

function GenericProviderIcon(props: { label?: string; tone: StatusTone; className?: string }) {
  return (
    <span
      className={`lightcode-provider-icon lightcode-provider-icon--${props.tone}${props.className ? ` ${props.className}` : ""}`}
    >
      <span
        className={`lightcode-provider-icon__generic${props.tone === "done" ? " opacity-40" : ""}`}
      >
        {fallbackInitial(props.label)}
      </span>
      {props.tone === "done" ? <DoneCheckOverlay /> : null}
    </span>
  );
}

export function ProviderIcon(props: {
  kind: string;
  tone?: StatusTone | undefined;
  className?: string | undefined;
  icon?: string | undefined;
  fallbackLabel?: string | undefined;
}) {
  const Icon = ICON_REGISTRY.get(props.kind);
  const tone = props.tone ?? "inactive";
  if (!Icon) {
    if (props.icon) {
      return (
        <ExternalProviderIcon
          src={props.icon}
          tone={tone}
          {...(props.className ? { className: props.className } : {})}
        />
      );
    }
    return (
      <GenericProviderIcon
        label={props.fallbackLabel ?? props.kind}
        tone={tone}
        {...(props.className ? { className: props.className } : {})}
      />
    );
  }
  return <Icon tone={tone} {...(props.className ? { className: props.className } : {})} />;
}

// --- Provider label registry ---
//
// Each provider plugin registers its long-form display label here. Consumers
// like the first-launch discovery screen enumerate the registry to render an
// up-to-date list of supported agents — no central hardcoded list to update
// when a new provider is added.

const LABEL_REGISTRY = new Map<string, string>();

export function registerProviderLabel(kind: string, label: string) {
  LABEL_REGISTRY.set(kind, label);
}

export function getProviderLabel(kind: string): string | undefined {
  return LABEL_REGISTRY.get(kind);
}

export function getRegisteredProviders(): { kind: string; label: string }[] {
  return Array.from(LABEL_REGISTRY, ([kind, label]) => ({ kind, label }));
}

// --- Composer controls registry ---

import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
import type {
  AgentCapability,
  AgentSlashCommand,
  ThreadConfig,
  ThreadPresentationMode,
} from "@/shared/contracts";

export interface ComposerControlsInput {
  capabilities: AgentCapability;
  config: ThreadConfig;
  isDisabled: boolean;
  onConfigChange: (patch: Partial<ThreadConfig>) => void;
  /**
   * Active presentation mode for this thread. Adapters can branch on it to
   * surface controls only available in the structured/chat path (e.g. Codex
   * plan toggle in `gui` mode where the ACP control channel exposes it).
   * Optional — built-in providers that don't care can ignore it.
   */
  presentationMode?: ThreadPresentationMode;
}

type ComposerControlsFactory = (input: ComposerControlsInput) => ComposerControl[];

/**
 * Adapters can register either a single factory (when controls don't differ
 * by surface) or a surface-keyed object that splits controls by presentation
 * mode. The dispatcher concatenates `shared` first, then the active surface's
 * factory, so a provider with both pieces gets `[...shared, ...gui]` in GUI
 * mode and `[...shared, ...terminal]` in terminal mode.
 *
 * When `presentationMode` is unknown (e.g. the "Continue in another provider"
 * dialog, which is surface-agnostic), only `shared` runs — that's the set of
 * controls a provider claims apply universally.
 */
export type ComposerControlsRegistration =
  | ComposerControlsFactory
  | {
      shared?: ComposerControlsFactory;
      gui?: ComposerControlsFactory;
      terminal?: ComposerControlsFactory;
    };

const COMPOSER_CONTROLS_REGISTRY = new Map<string, ComposerControlsRegistration>();

export function registerComposerControls(kind: string, registration: ComposerControlsRegistration) {
  COMPOSER_CONTROLS_REGISTRY.set(kind, registration);
}

export function getComposerControls(kind: string): ComposerControlsFactory | undefined {
  const registration = COMPOSER_CONTROLS_REGISTRY.get(kind);
  if (!registration) return undefined;
  if (typeof registration === "function") return registration;
  return (input) => {
    const out: ComposerControl[] = [];
    if (registration.shared) out.push(...registration.shared(input));
    if (input.presentationMode === "gui" && registration.gui) {
      out.push(...registration.gui(input));
    } else if (input.presentationMode === "terminal" && registration.terminal) {
      out.push(...registration.terminal(input));
    }
    return out;
  };
}

// --- GUI slash-command registry ---
//
// Some providers expose a GUI-only slash-command palette (open the model
// picker, toggle Fast, switch plan/agent). Adapters register a builder so
// the composer can offer these autocomplete entries and route the matching
// `/command` typed in the input to a local action without dispatching to
// the agent process.

export interface GuiSlashCommandContext {
  hasEffort: boolean;
  supportsFast: boolean;
}

export type LocalSlashCommandAction =
  | { kind: "set-mode"; mode: "agent" | "plan" }
  | { kind: "open-control"; target: "model" | "effort" }
  | { kind: "toggle-fast" };

export interface GuiSlashCommandRegistration {
  buildCommands: (context: GuiSlashCommandContext) => readonly AgentSlashCommand[];
  resolveLocalAction: (typedCommand: string) => LocalSlashCommandAction | null;
}

const GUI_SLASH_COMMAND_REGISTRY = new Map<string, GuiSlashCommandRegistration>();

export function registerGuiSlashCommands(kind: string, registration: GuiSlashCommandRegistration) {
  GUI_SLASH_COMMAND_REGISTRY.set(kind, registration);
}

export function getGuiSlashCommands(kind: string): GuiSlashCommandRegistration | undefined {
  return GUI_SLASH_COMMAND_REGISTRY.get(kind);
}

// --- Config normalizer registry ---
//
// Adapters whose supported config values vary by presentation surface (e.g.
// Codex plan mode is ACP-only) register a normalizer that returns a patch
// dropping unsupported values when the active presentation mode changes.

export interface ConfigNormalizerInput {
  capabilities: AgentCapability;
  config: ThreadConfig;
  presentationMode: ThreadPresentationMode;
}

type ConfigNormalizer = (input: ConfigNormalizerInput) => Partial<ThreadConfig>;

const CONFIG_NORMALIZER_REGISTRY = new Map<string, ConfigNormalizer>();

export function registerConfigNormalizer(kind: string, normalizer: ConfigNormalizer) {
  CONFIG_NORMALIZER_REGISTRY.set(kind, normalizer);
}

export function getConfigNormalizer(kind: string): ConfigNormalizer | undefined {
  return CONFIG_NORMALIZER_REGISTRY.get(kind);
}

// --- Commit generation defaults registry ---

export interface CommitGenDefaults {
  label?: string;
  hint?: string;
  model: string;
  effort: string;
}

const COMMIT_GEN_REGISTRY = new Map<string, CommitGenDefaults>();

export function registerCommitGenDefaults(kind: string, defaults: CommitGenDefaults) {
  COMMIT_GEN_REGISTRY.set(kind, defaults);
}

export function getCommitGenDefaults(kind: string): CommitGenDefaults | undefined {
  return COMMIT_GEN_REGISTRY.get(kind);
}

export function getCommitGenDefaultsHint(): string | undefined {
  const entries = [...COMMIT_GEN_REGISTRY.values()]
    .flatMap((defaults) =>
      defaults.hint && defaults.label ? [`${defaults.label} -> ${defaults.hint}`] : [],
    )
    .sort()
    .join(", ");

  return entries ? `Defaults: ${entries}` : undefined;
}

// --- Title generation defaults registry ---

export interface TitleGenDefaults {
  label?: string;
  hint?: string;
  model: string;
  effort: string;
}

const TITLE_GEN_REGISTRY = new Map<string, TitleGenDefaults>();

export function registerTitleGenDefaults(kind: string, defaults: TitleGenDefaults) {
  TITLE_GEN_REGISTRY.set(kind, defaults);
}

export function getTitleGenDefaults(kind: string): TitleGenDefaults | undefined {
  return TITLE_GEN_REGISTRY.get(kind);
}

export function getTitleGenDefaultsHint(): string | undefined {
  const entries = [...TITLE_GEN_REGISTRY.values()]
    .flatMap((defaults) =>
      defaults.hint && defaults.label ? [`${defaults.label} -> ${defaults.hint}`] : [],
    )
    .sort()
    .join(", ");

  return entries ? `Defaults: ${entries}` : undefined;
}

// --- Conflict resolver defaults registry ---

export interface ConflictResolverDefaults {
  label?: string;
  hint?: string;
  model: string;
  effort: string;
}

const CONFLICT_RESOLVER_REGISTRY = new Map<string, ConflictResolverDefaults>();

export function registerConflictResolverDefaults(kind: string, defaults: ConflictResolverDefaults) {
  CONFLICT_RESOLVER_REGISTRY.set(kind, defaults);
}

export function getConflictResolverDefaults(kind: string): ConflictResolverDefaults | undefined {
  return CONFLICT_RESOLVER_REGISTRY.get(kind);
}

export function getConflictResolverDefaultsHint(): string | undefined {
  const entries = [...CONFLICT_RESOLVER_REGISTRY.values()]
    .flatMap((defaults) =>
      defaults.hint && defaults.label ? [`${defaults.label} -> ${defaults.hint}`] : [],
    )
    .sort()
    .join(", ");

  return entries ? `Defaults: ${entries}` : undefined;
}

export function resolveConflictResolverConfig(
  agent:
    | {
        kind: string;
        capabilities: {
          models: { id: string }[];
          efforts: string[];
          modelEfforts: Record<string, string[]>;
          defaultEffort?: string | undefined;
        };
      }
    | undefined,
  model: string,
  effort: string,
): { model: string; effort: string; availableEfforts: string[] } {
  if (!agent) return { model: "", effort: "", availableEfforts: [] };

  const defaults = getConflictResolverDefaults(agent.kind);
  const nextModel = agent.capabilities.models.some((m) => m.id === model)
    ? model
    : defaults?.model && agent.capabilities.models.some((m) => m.id === defaults.model)
      ? defaults.model
      : (agent.capabilities.models[0]?.id ?? "");

  const modelEfforts = agent.capabilities.modelEfforts[nextModel];
  const availableEfforts = modelEfforts?.length ? modelEfforts : agent.capabilities.efforts;
  if (availableEfforts.length === 0) return { model: nextModel, effort: "", availableEfforts };

  if (availableEfforts.includes(effort)) return { model: nextModel, effort, availableEfforts };

  const fallback = [defaults?.effort, agent.capabilities.defaultEffort, availableEfforts[0]].find(
    (c) => c && availableEfforts.includes(c!),
  );
  return { model: nextModel, effort: fallback ?? "", availableEfforts };
}
