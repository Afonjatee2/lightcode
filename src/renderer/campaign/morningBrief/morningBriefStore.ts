import { create } from "zustand";
import type { MorningBrief } from "./briefGenerator";

export interface MorningBriefState {
  latestBrief: MorningBrief | null;
  dismissedAt: string | null;
  setLatestBrief: (brief: MorningBrief) => void;
  dismissBrief: () => void;
  resetDismissed: () => void;
}

export const useMorningBriefStore = create<MorningBriefState>((set, get) => ({
  latestBrief: null,
  dismissedAt: null,
  setLatestBrief: (brief) => {
    if (get().latestBrief?.generatedAt === brief.generatedAt) return;
    set({ latestBrief: brief });
  },
  dismissBrief: () => set({ dismissedAt: new Date().toISOString() }),
  resetDismissed: () => set({ dismissedAt: null }),
}));
