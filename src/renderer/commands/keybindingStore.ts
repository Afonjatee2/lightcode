import { create } from "zustand";
import type { KeybindingsConfig, KeybindingEntry } from "@/shared/keybindings";
import { DEFAULT_KEYBINDINGS } from "@/shared/keybindings";
import { readBridge } from "@/renderer/bridge";

interface KeybindingState {
  path: string | null;
  keybindings: KeybindingEntry[];
  loaded: boolean;
  load: () => Promise<void>;
}

export const useKeybindingStore = create<KeybindingState>((set) => ({
  path: null,
  keybindings: DEFAULT_KEYBINDINGS.keybindings,
  loaded: false,
  load: async () => {
    const bridge = readBridge() as { getKeybindings?: () => Promise<KeybindingsConfig> };
    if (typeof bridge.getKeybindings !== "function") {
      set({
        path: "",
        keybindings: DEFAULT_KEYBINDINGS.keybindings,
        loaded: true,
      });
      return;
    }

    const config = await bridge.getKeybindings();
    set({
      path: config.path,
      keybindings: config.file.keybindings,
      loaded: true,
    });
  },
}));
