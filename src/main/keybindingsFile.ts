import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  keybindingsFileSchema,
  serializeDefaultKeybindings,
  type KeybindingsConfig,
} from "@/shared/keybindings";

export function readKeybindingsFile(keybindingsPath: string): KeybindingsConfig {
  if (!existsSync(keybindingsPath)) {
    mkdirSync(dirname(keybindingsPath), { recursive: true });
    writeFileSync(keybindingsPath, serializeDefaultKeybindings(), "utf8");
  }

  const raw = readFileSync(keybindingsPath, "utf8");
  return {
    path: keybindingsPath,
    file: keybindingsFileSchema.parse(JSON.parse(raw)),
  };
}
