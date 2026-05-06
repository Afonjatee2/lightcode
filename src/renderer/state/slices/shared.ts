import type { StateCreator } from "zustand";
import type { DraftSlice } from "./draftSlice";
import type { LaunchSlice } from "./launchSlice";
import type { ProjectSlice } from "./projectSlice";
import type { RuntimeEventSlice } from "./runtimeEventSlice";
import type { ThreadSlice } from "./threadSlice";
import type { ViewSlice } from "./viewSlice";

export type AppStoreState = ProjectSlice &
  ThreadSlice &
  LaunchSlice &
  DraftSlice &
  ViewSlice &
  RuntimeEventSlice;

export type SliceCreator<T> = StateCreator<AppStoreState, [], [], T>;
