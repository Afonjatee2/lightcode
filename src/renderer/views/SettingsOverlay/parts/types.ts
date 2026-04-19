export type SettingsSection =
  | "general"
  | "ai"
  | "agents"
  | "archived"
  | "about"
  | `agents:${string}`;
