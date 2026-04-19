import type { DraftContent } from "./types";
import type { SliceCreator } from "./shared";

export interface DraftSlice {
  draftContents: Record<string, DraftContent>;
  saveDraftContent: (projectId: string, content: DraftContent) => void;
  clearDraftContent: (projectId: string) => void;
}

export const createDraftSlice: SliceCreator<DraftSlice> = (set) => ({
  draftContents: {},
  saveDraftContent: (projectId, content) =>
    set((state) => ({
      draftContents: { ...state.draftContents, [projectId]: content },
    })),
  clearDraftContent: (projectId) =>
    set((state) => {
      if (!(projectId in state.draftContents)) return {};
      const { [projectId]: _, ...rest } = state.draftContents;
      return { draftContents: rest };
    }),
});
