import type { AgentSlashCommand } from "@/shared/contracts";

const EMPTY_SLASH_COMMANDS: AgentSlashCommand[] = [];

/**
 * Session-scoped commands win over the provider capability fallback so a live
 * thread can narrow or replace the install-time catalog. The renderer treats
 * these as autocomplete suggestions only and never validates typed commands.
 */
export function resolveAvailableSlashCommands(
  threadCommands: readonly AgentSlashCommand[] | undefined,
  capabilityCommands: readonly AgentSlashCommand[] | undefined,
): readonly AgentSlashCommand[] {
  return threadCommands ?? capabilityCommands ?? EMPTY_SLASH_COMMANDS;
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
