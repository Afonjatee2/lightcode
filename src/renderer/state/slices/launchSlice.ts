import type { PromptSegment } from "@/shared/contracts";
import type { SliceCreator } from "./shared";

export interface LaunchSlice {
  pendingThreadLaunches: Record<string, string>;
  pendingLaunchSegments: Record<string, PromptSegment[]>;
  queueThreadLaunch: (threadId: string, prompt: string, segments?: PromptSegment[]) => void;
  consumeThreadLaunch: (threadId: string) => void;
}

export const createLaunchSlice: SliceCreator<LaunchSlice> = (set) => ({
  pendingThreadLaunches: {},
  pendingLaunchSegments: {},
  queueThreadLaunch: (threadId, prompt, segments) =>
    set((state) => ({
      pendingThreadLaunches: {
        ...state.pendingThreadLaunches,
        [threadId]: prompt,
      },
      ...(segments
        ? {
            pendingLaunchSegments: {
              ...state.pendingLaunchSegments,
              [threadId]: segments,
            },
          }
        : {}),
    })),
  consumeThreadLaunch: (threadId) =>
    set((state) => {
      if (!(threadId in state.pendingThreadLaunches)) {
        return {};
      }

      const { [threadId]: _removed, ...pendingThreadLaunches } = state.pendingThreadLaunches;
      const { [threadId]: _removedSeg, ...pendingLaunchSegments } = state.pendingLaunchSegments;
      return { pendingThreadLaunches, pendingLaunchSegments };
    }),
});
