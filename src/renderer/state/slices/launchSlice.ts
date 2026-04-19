import type { PromptSegment, ThreadServerRequestId } from "@/shared/contracts";
import type { PendingThreadServerRequest } from "./types";
import type { SliceCreator } from "./shared";

export interface LaunchSlice {
  pendingServerRequests: PendingThreadServerRequest[];
  pendingThreadLaunches: Record<string, string>;
  pendingLaunchSegments: Record<string, PromptSegment[]>;
  queueThreadLaunch: (threadId: string, prompt: string, segments?: PromptSegment[]) => void;
  consumeThreadLaunch: (threadId: string) => void;
  addThreadServerRequest: (input: {
    threadId: string;
    requestId: ThreadServerRequestId;
    method: string;
    params: unknown;
  }) => void;
  removeThreadServerRequest: (threadId: string, requestId: ThreadServerRequestId) => void;
  clearThreadServerRequests: (threadId: string) => void;
}

export const createLaunchSlice: SliceCreator<LaunchSlice> = (set) => ({
  pendingServerRequests: [],
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
  addThreadServerRequest: (input) =>
    set((state) => {
      const nextRequest: PendingThreadServerRequest = {
        threadId: input.threadId,
        requestId: input.requestId,
        method: input.method,
        params: input.params,
        receivedAt: new Date().toISOString(),
      };
      const pendingServerRequests = [
        ...state.pendingServerRequests.filter(
          (request) => request.threadId !== input.threadId || request.requestId !== input.requestId,
        ),
        nextRequest,
      ];

      return { pendingServerRequests };
    }),
  removeThreadServerRequest: (threadId, requestId) =>
    set((state) => ({
      pendingServerRequests: state.pendingServerRequests.filter(
        (request) => request.threadId !== threadId || request.requestId !== requestId,
      ),
    })),
  clearThreadServerRequests: (threadId) =>
    set((state) => ({
      pendingServerRequests: state.pendingServerRequests.filter(
        (request) => request.threadId !== threadId,
      ),
    })),
});
