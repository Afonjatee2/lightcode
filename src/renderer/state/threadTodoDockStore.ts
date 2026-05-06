import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createDbStorage } from "./dbStorage";

export type ThreadTodoDockPlacement = "composer" | "right";

interface ThreadTodoDockStore {
  placement: ThreadTodoDockPlacement;
  collapsed: boolean;
  setPlacement: (placement: ThreadTodoDockPlacement) => void;
  setCollapsed: (collapsed: boolean) => void;
}

export const useThreadTodoDockStore = create<ThreadTodoDockStore>()(
  persist(
    (set) => ({
      placement: "composer",
      collapsed: false,
      setPlacement: (placement) =>
        set((state) => (state.placement === placement ? {} : { placement })),
      setCollapsed: (collapsed) =>
        set((state) => (state.collapsed === collapsed ? {} : { collapsed })),
    }),
    {
      name: "lightcode-thread-todo-dock-v1",
      version: 1,
      storage: createDbStorage(),
      partialize: (state) => ({
        placement: state.placement,
        collapsed: state.collapsed,
      }),
    },
  ),
);
