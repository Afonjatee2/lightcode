export type SettingsSection =
  | "general"
  | "ai"
  | "search"
  | "agents"
  | "archived"
  | "about"
  | "dev"
  | `agents:${string}`;
