export type SettingsSection =
  | "general"
  | "notifications"
  | "ai"
  | "acpRegistry"
  | "agentsGeneral"
  | "search"
  | "agents"
  | "archived"
  | "about"
  | "dev"
  | `agents:${string}`;
