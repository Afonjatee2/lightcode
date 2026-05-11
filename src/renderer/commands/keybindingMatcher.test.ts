import { describe, expect, it } from "vitest";
import { bindingForPlatform, canonicalizeKeybinding, eventToKeybinding } from "./keybindingMatcher";

describe("keybindingMatcher", () => {
  it("chooses platform-specific bindings over the shared key", () => {
    const binding = {
      command: "palette.open",
      key: "Ctrl+Shift+P",
      mac: "Meta+Shift+P",
    };

    expect(bindingForPlatform(binding, "darwin")).toBe("Meta+Shift+P");
    expect(bindingForPlatform(binding, "linux")).toBe("Ctrl+Shift+P");
  });

  it("normalizes Mod to the platform command modifier", () => {
    expect(canonicalizeKeybinding("Mod+Shift+P", "darwin")).toBe("meta+shift+p");
    expect(canonicalizeKeybinding("Mod+Shift+P", "linux")).toBe("ctrl+shift+p");
  });

  it("normalizes keyboard events into the same canonical shape", () => {
    const event = new KeyboardEvent("keydown", {
      key: "P",
      metaKey: true,
      shiftKey: true,
    });

    expect(eventToKeybinding(event, "darwin")).toBe("meta+shift+p");
  });
});
