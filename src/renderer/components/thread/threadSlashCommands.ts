import type { AgentSlashCommand, AgentStatus, ThreadPresentationMode } from "@/shared/contracts";
import {
  getGuiSlashCommands,
  type LocalSlashCommandAction,
} from "@/renderer/components/providers/ProviderIcon";

export type { LocalSlashCommandAction };

const EMPTY_SLASH_COMMANDS: AgentSlashCommand[] = [];

/**
 * Session-scoped commands win over the provider capability fallback so a live
 * thread can narrow or replace the install-time catalog. The renderer treats
 * these as autocomplete suggestions only and never validates typed commands.
 */
export function resolveAvailableSlashCommands(
  threadCommands: readonly AgentSlashCommand[] | undefined,
  capabilityCommands: readonly AgentSlashCommand[] | undefined,
  context?: {
    agentKind?: AgentStatus["kind"] | undefined;
    presentationMode?: ThreadPresentationMode | undefined;
    hasEffort?: boolean | undefined;
    supportsFast?: boolean | undefined;
  },
): readonly AgentSlashCommand[] {
  if (threadCommands) return threadCommands;
  if (context && context.agentKind && context.presentationMode !== "terminal") {
    const registration = getGuiSlashCommands(context.agentKind);
    if (registration) {
      return registration.buildCommands({
        hasEffort: context.hasEffort ?? false,
        supportsFast: context.supportsFast ?? false,
      });
    }
  }
  return capabilityCommands ?? EMPTY_SLASH_COMMANDS;
}

export function resolveLocalSlashCommandAction(
  input: string,
  context: {
    agentKind?: AgentStatus["kind"] | undefined;
    presentationMode?: ThreadPresentationMode | undefined;
  },
): LocalSlashCommandAction | null {
  if (!context.agentKind || context.presentationMode === "terminal") return null;
  const registration = getGuiSlashCommands(context.agentKind);
  return registration ? registration.resolveLocalAction(input) : null;
}

export function filterSlashCommands(
  commands: readonly AgentSlashCommand[],
  query: string | null,
): AgentSlashCommand[] {
  if (query === null) {
    return EMPTY_SLASH_COMMANDS;
  }

  const normalizedQuery = query.toLowerCase();
  return commands.filter(
    (command) =>
      command.id.toLowerCase().startsWith(normalizedQuery) ||
      command.label.toLowerCase().includes(normalizedQuery),
  );
}
