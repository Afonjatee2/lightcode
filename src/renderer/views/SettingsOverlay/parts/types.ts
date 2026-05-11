export type SettingsSection =
  | "general"
  | "notifications"
  | "ai"
  | "acpRegistry"
  | "search"
  | "agents"
  | "archived"
  | "about"
  | "dev"
  | `agents:${string}`;
