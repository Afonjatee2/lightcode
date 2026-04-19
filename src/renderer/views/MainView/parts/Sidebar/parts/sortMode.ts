import { ArrowDownUp, CalendarClock, GripVertical } from "lucide-react";

export type ThreadSortMode = "updated" | "created" | "manual";

export const sortModeOrder: ThreadSortMode[] = ["updated", "created", "manual"];

export const sortModeIcon: Record<ThreadSortMode, typeof ArrowDownUp> = {
  updated: ArrowDownUp,
  created: CalendarClock,
  manual: GripVertical,
};

export const sortModeLabel: Record<ThreadSortMode, string> = {
  updated: "Sort by last updated",
  created: "Sort by created",
  manual: "Manual order",
};
