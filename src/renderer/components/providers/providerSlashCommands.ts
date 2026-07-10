import type { AgentSlashCommand } from "@/shared/contracts";
import { lookupProviderRegistration } from "./providerRegistry";

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

const guiSlashCommandRegistry = new Map<string, GuiSlashCommandRegistration>();

export function registerGuiSlashCommands(kind: string, registration: GuiSlashCommandRegistration) {
  guiSlashCommandRegistry.set(kind, registration);
}

export function getGuiSlashCommands(kind: string): GuiSlashCommandRegistration | undefined {
  return lookupProviderRegistration(guiSlashCommandRegistry, kind);
}
