import type { ReactNode } from "react";
import type { StatusTone } from "./statusTone";

// --- Icon registry ---

type IconComponent = (props: { tone: StatusTone; className?: string }) => ReactNode;

const ICON_REGISTRY = new Map<string, IconComponent>();

export function registerProviderIcon(kind: string, icon: IconComponent) {
  ICON_REGISTRY.set(kind, icon);
}

export function ProviderIcon(props: { kind: string; tone?: StatusTone; className?: string }) {
  const Icon = ICON_REGISTRY.get(props.kind);
  if (!Icon) return null;
  return (
    <Icon
      tone={props.tone ?? "inactive"}
      {...(props.className ? { className: props.className } : {})}
    />
  );
}

// --- Composer controls registry ---

import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
import type { AgentCapability, ThreadConfig, ThreadPresentationMode } from "@/shared/contracts";

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
