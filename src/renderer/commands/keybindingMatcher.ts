import type { KeybindingEntry } from "@/shared/keybindings";

const MODIFIER_ORDER = ["ctrl", "meta", "alt", "shift"] as const;
export type PlatformName = "darwin" | "win32" | "linux" | NodeJS.Platform;

export function bindingForPlatform(
  binding: KeybindingEntry,
  platform: PlatformName,
): string | undefined {
  if (platform === "darwin") return binding.mac ?? binding.key;
  if (platform === "win32") return binding.windows ?? binding.key;
  return binding.linux ?? binding.key;
}

export function formatKeybinding(raw: string | undefined, platform: PlatformName): string {
  if (!raw) return "";
  const canonical = canonicalizeKeybinding(raw, platform);
  if (!canonical) return raw;
  return canonical
    .split("+")
    .map((part) => {
      if (platform === "darwin") {
        if (part === "meta") return "⌘";
        if (part === "shift") return "⇧";
        if (part === "alt") return "⌥";
        if (part === "ctrl") return "⌃";
      }
      if (part === "meta") return "Meta";
      if (part === "ctrl") return "Ctrl";
      if (part === "alt") return "Alt";
      if (part === "shift") return "Shift";
      if (part.length === 1) return part.toUpperCase();
      return part[0]!.toUpperCase() + part.slice(1);
    })
    .join(platform === "darwin" ? "" : "+");
}

export function eventToKeybinding(event: KeyboardEvent, platform: PlatformName): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.metaKey) parts.push("meta");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");

  const key = normalizeMainKey(event.key);
  if (!key || MODIFIER_ORDER.includes(key as (typeof MODIFIER_ORDER)[number])) return "";
  parts.push(key);
  return canonicalizeParts(parts, platform);
}

export function canonicalizeKeybinding(raw: string, platform: PlatformName): string | undefined {
  const parts = raw
    .split("+")
    .map((part) => normalizeKeyPart(part.trim(), platform))
    .filter((part): part is string => Boolean(part));
  if (parts.length === 0) return undefined;
  return canonicalizeParts(parts, platform);
}

function canonicalizeParts(parts: string[], platform: PlatformName): string {
  const modifiers = new Set<string>();
  const main: string[] = [];
  for (const part of parts) {
    const normalized = normalizeKeyPart(part, platform);
    if (!normalized) continue;
    if (MODIFIER_ORDER.includes(normalized as (typeof MODIFIER_ORDER)[number])) {
      modifiers.add(normalized);
    } else {
      main.push(normalized);
    }
  }

  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), ...main].join("+");
}

function normalizeKeyPart(part: string, platform: PlatformName): string | undefined {
  const lower = part.toLowerCase();
  if (!lower) return undefined;
  if (lower === "cmd" || lower === "command" || lower === "super" || lower === "win") {
    return "meta";
  }
  if (lower === "control") return "ctrl";
  if (lower === "option") return "alt";
  if (lower === "mod") return platform === "darwin" ? "meta" : "ctrl";
  return normalizeMainKey(lower);
}

function normalizeMainKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower === " ") return "space";
  if (lower === "escape") return "esc";
  if (lower === "arrowup") return "up";
  if (lower === "arrowdown") return "down";
  if (lower === "arrowleft") return "left";
  if (lower === "arrowright") return "right";
  return lower;
}
