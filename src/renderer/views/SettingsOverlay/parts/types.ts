export type SettingsSection =
  | "general"
  | "notifications"
  | "ai"
  | "search"
  | "agents"
  | "archived"
  | "about"
  | "dev"
  | `agents:${string}`;
