import { describe, expect, it, vi } from "vitest";
import type { ComposerControl } from "./ThreadComposer";
import { handleComposerControlShortcut } from "./threadComposerShortcuts";

function shortcutEvent(key: string) {
  return {
    key,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: vi.fn<() => void>(),
  };
}

describe("handleComposerControlShortcut", () => {
  it("toggles Work/Plan with Shift+Tab", () => {
    const onChange = vi.fn<(value: boolean) => void>();
    const event = shortcutEvent("Tab");

    const handled = handleComposerControlShortcut(event, {
      controls: [
        {
          kind: "toggle",
          label: "Work",
          isSelected: false,
          onChange,
        },
      ],
      onOpenModelPicker: () => undefined,
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("cycles effort with Shift+T", () => {
    const onEffortChange = vi.fn<(value: string) => void>();
    const event = shortcutEvent("T");

    handleComposerControlShortcut(event, {
      controls: [
        {
          kind: "effort-context",
          efforts: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
          ],
          effortValue: "medium",
          onEffortChange,
          contextSizes: [],
        },
      ],
      onOpenModelPicker: () => undefined,
    });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onEffortChange).toHaveBeenCalledWith("high");
  });

  it("toggles Fast with Shift+F", () => {
    const onChange = vi.fn<(value: boolean) => void>();
    const event = shortcutEvent("f");

    handleComposerControlShortcut(event, {
      controls: [
        {
          kind: "toggle",
          label: "Fast",
          isSelected: true,
          onChange,
        },
      ],
      onOpenModelPicker: () => undefined,
    });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("cycles menu permissions with Shift+P", () => {
    const onChange = vi.fn<(value: string) => void>();
    const event = shortcutEvent("p");

    handleComposerControlShortcut(event, {
      controls: [
        {
          iconKind: "permission",
          value: "supervised",
          options: [
            { id: "supervised", label: "Supervised" },
            { id: "auto-accept-edits", label: "Auto-accept edits" },
            { id: "full-access", label: "Full access" },
          ],
          onChange,
        },
      ],
      onOpenModelPicker: () => undefined,
    });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("auto-accept-edits");
  });

  it("toggles permission toggles with Shift+P", () => {
    const onChange = vi.fn<(value: boolean) => void>();
    const event = shortcutEvent("p");

    handleComposerControlShortcut(event, {
      controls: [
        {
          kind: "toggle",
          label: "Supervised",
          iconKind: "permission",
          isSelected: false,
          onChange,
        },
      ],
      onOpenModelPicker: () => undefined,
    });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("opens the model picker with Shift+M", () => {
    const onOpenModelPicker = vi.fn<() => void>();
    const event = shortcutEvent("m");

    handleComposerControlShortcut(event, {
      controls: [
        {
          kind: "provider-model",
          providers: [],
          currentAgentKind: "codex",
          currentModel: "gpt-5.4",
          onChange: () => undefined,
        },
      ],
      onOpenModelPicker,
    });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onOpenModelPicker).toHaveBeenCalledOnce();
  });

  it("ignores shortcuts with other modifiers", () => {
    const onOpenModelPicker = vi.fn<() => void>();
    const event = { ...shortcutEvent("m"), metaKey: true };

    const handled = handleComposerControlShortcut(event, {
      controls: [
        {
          kind: "provider-model",
          providers: [],
          currentAgentKind: "codex",
          currentModel: "gpt-5.4",
          onChange: () => undefined,
        },
      ],
      onOpenModelPicker,
    });

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onOpenModelPicker).not.toHaveBeenCalled();
  });

  it("does not consume unhandled shortcut keys", () => {
    const event = shortcutEvent("x");

    const handled = handleComposerControlShortcut(event, {
      controls: [] satisfies ComposerControl[],
      onOpenModelPicker: () => undefined,
    });

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
