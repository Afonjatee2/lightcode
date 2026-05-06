import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Thread } from "@/shared/contracts";
import { createDbStorage } from "./dbStorage";
import { createDraftSlice } from "./slices/draftSlice";
import { normalizeStoredThreadStatus } from "./slices/helpers";
import { createLaunchSlice } from "./slices/launchSlice";
import { createProjectSlice } from "./slices/projectSlice";
import { createRuntimeEventSlice } from "./slices/runtimeEventSlice";
import type { AppStoreState } from "./slices/shared";
import { createThreadSlice } from "./slices/threadSlice";
import { createViewSlice } from "./slices/viewSlice";

export { makeThreadTitle } from "./slices/helpers";
export type { AppStoreState } from "./slices/shared";
export type { DraftContent, PendingThreadServerRequest, SavedGroupLayout } from "./slices/types";

export const useAppStore = create<AppStoreState>()(
  persist(
    (...a) => ({
      ...createProjectSlice(...a),
      ...createThreadSlice(...a),
      ...createLaunchSlice(...a),
      ...createDraftSlice(...a),
      ...createViewSlice(...a),
      ...createRuntimeEventSlice(...a),
    }),
    {
      name: "lightcode-app-v2",
      version: 4,
      storage: createDbStorage(),
      merge: (persistedState, currentState) => {
        const state =
          (persistedState as (Partial<AppStoreState> & { threads?: Thread[] }) | undefined) ??
          ({} as Partial<AppStoreState>);

        return {
          ...currentState,
          ...state,
          threads: (state.threads ?? currentState.threads).map((t) => ({
            ...normalizeStoredThreadStatus(t),
            done: t.done ?? false,
          })),
        };
      },
      partialize: (state) => ({
        projects: state.projects,
        threads: state.threads,
        view: state.view,
        groupLayouts: state.groupLayouts,
      }),
    },
  ),
);
