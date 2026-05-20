export type SettingsSection =
  | "general"
  | "notifications"
  | "ai"
  | "acpRegistry"
  | "agentsGeneral"
  | "search"
  | "agents"
  | "browser"
  | "archived"
  | "about"
  | "dev"
  | `agents:${string}`;
