import { parseDraftProjectId } from "@/shared/paneId";
import { useAppStore } from "@/renderer/state/appStore";

export function getCurrentProjectId(): string | undefined {
  const s = useAppStore.getState();
  const v = s.view;
  if (v.kind === "draft") return v.projectId;
  if (v.kind === "thread") {
    const firstPaneId = v.panes[0];
    if (!firstPaneId) return undefined;
    const draftProjectId = parseDraftProjectId(firstPaneId);
    if (draftProjectId) return draftProjectId;
    return s.threads.find((t) => t.id === firstPaneId)?.projectId;
  }
  return undefined;
}
