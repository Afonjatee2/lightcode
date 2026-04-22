export type SettingsSection =
  | "general"
  | "ai"
  | "agents"
  | "archived"
  | "about"
  | "dev"
  | `agents:${string}`;
