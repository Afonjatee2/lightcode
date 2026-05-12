import { describe, expect, it, vi } from "vitest";
import type { ComposerControl } from "./ThreadComposer";
import { handleComposerControlShortcut } from "./threadComposerShortcuts";

type ShortcutModifiers = Partial<{
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}>;

function shortcutEvent(key: string, modifiers: ShortcutModifiers = {}) {
  return {
    key,
    shiftKey: false,
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    ...modifiers,
    preventDefault: vi.fn<() => void>(),
  };
}

describe("handleComposerControlShortcut", () => {
  it("toggles Work/Plan with Shift+Tab", () => {
    const onChange = vi.fn<(value: boolean) => void>();
    const event = shortcutEvent("Tab", { shiftKey: true, ctrlKey: false });

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

  it("cycles effort with Ctrl+T", () => {
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

  it("toggles Fast with Ctrl+F", () => {
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

  it("cycles menu permissions with Ctrl+P", () => {
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

  it("toggles permission toggles with Ctrl+P", () => {
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

  it("opens the model picker with Ctrl+M", () => {
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

  it("supports Meta as the platform command modifier", () => {
    const onOpenModelPicker = vi.fn<() => void>();
    const event = shortcutEvent("m", { ctrlKey: false, metaKey: true });

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

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onOpenModelPicker).toHaveBeenCalledOnce();
  });

  it("does not consume Shift+letter typing", () => {
    const onOpenModelPicker = vi.fn<() => void>();
    const event = shortcutEvent("m", { shiftKey: true, ctrlKey: false });

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
