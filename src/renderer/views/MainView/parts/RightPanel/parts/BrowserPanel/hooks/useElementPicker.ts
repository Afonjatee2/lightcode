import { useCallback } from "react";
import { toast } from "@heroui/react";
import { useShallow } from "zustand/shallow";
import { isDraftPaneId, parseDraftProjectId } from "@/shared/paneId";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useBrowserAttachInbox } from "@/renderer/state/browserAttachInbox";
import {
  useBrowserPanelStore,
  type PendingPickerAttachment,
} from "@/renderer/state/browserPanelStore";

export interface PickerThreadTarget {
  threadId: string;
  title: string;
}

interface PickerOutcome {
  ok: boolean;
  cancelled: boolean;
  error?: string;
  needsThreadChoice?: boolean;
}

const PICKER_TEMP_THREAD_PREFIX = "picker-";

function draftTargetId(projectId: string): string {
  return `draft:${projectId}`;
}

function findActiveWebviewRect(tabId: string): DOMRect | null {
  const direct = document.querySelector<HTMLElement>(`webview[data-tab-id="${tabId}"]`);
  if (direct) {
    const r = direct.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r;
  }
  for (const wv of document.querySelectorAll<HTMLElement>("webview")) {
    if (wv.getAttribute("data-tab-id") !== tabId) continue;
    const r = wv.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r;
  }
  for (const wv of document.querySelectorAll<HTMLElement>("webview")) {
    const r = wv.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r;
  }
  return null;
}

function anchorFromSelectedRect(
  tabId: string,
  selected: { x: number; y: number; width: number; height: number },
): { x: number; y: number } | null {
  const wvRect = findActiveWebviewRect(tabId);
  if (!wvRect) return null;
  return {
    x: wvRect.left + selected.x,
    y: wvRect.top + selected.y + selected.height,
  };
}

function resolveTargetThreadIds(): string[] {
  const state = useAppStore.getState();
  if (state.view.kind === "draft") return [draftTargetId(state.view.projectId)];
  if (state.view.kind !== "thread") return [];
  return [...state.view.panes];
}

export function useElementPicker() {
  const activeTabId = useBrowserPanelStore((s) => s.activeTabId);
  const pickerActive = useBrowserPanelStore((s) => s.pickerActive);
  const setPickerActive = useBrowserPanelStore((s) => s.setPickerActive);
  const pendingPickerAttachment = useBrowserPanelStore((s) => s.pendingPickerAttachment);
  const setPendingPickerAttachment = useBrowserPanelStore((s) => s.setPendingPickerAttachment);
  const enqueueAttach = useBrowserAttachInbox((s) => s.enqueue);
  const targetThreadIds = useAppStore(
    useShallow((state) => {
      if (state.view.kind === "draft") return [draftTargetId(state.view.projectId)];
      if (state.view.kind !== "thread") return [];
      return [...state.view.panes];
    }),
  );
  const threads = useAppStore((s) => s.threads);
  const projects = useAppStore((s) => s.projects);
  const threadTargets: PickerThreadTarget[] = targetThreadIds.map((paneId) => {
    if (isDraftPaneId(paneId)) {
      const projectId = parseDraftProjectId(paneId);
      const projectName = projects.find((p) => p.id === projectId)?.name;
      return {
        threadId: paneId,
        title: projectName ? `New thread — ${projectName}` : "New thread",
      };
    }
    return {
      threadId: paneId,
      title: threads.find((thread) => thread.id === paneId)?.title ?? "Thread",
    };
  });

  const cancelPicker = useCallback(async (): Promise<PickerOutcome> => {
    try {
      await readBridge().browserCancelPicker();
    } catch {}
    setPickerActive(false);
    return { ok: true, cancelled: true };
  }, [setPickerActive]);

  const startPicker = useCallback(async (): Promise<PickerOutcome> => {
    if (pickerActive) {
      return await cancelPicker();
    }
    if (!activeTabId) {
      toast.danger("No active browser tab");
      return { ok: false, cancelled: false, error: "No active browser tab" };
    }
    const targetIds = resolveTargetThreadIds();
    if (targetIds.length === 0) {
      toast.danger("Open a thread first to attach to it.");
      return { ok: false, cancelled: false, error: "Open a thread first to attach to it" };
    }
    setPendingPickerAttachment(null);
    setPickerActive(true);
    try {
      const tempThreadId = PICKER_TEMP_THREAD_PREFIX + crypto.randomUUID();
      const result = await readBridge().browserStartPicker({
        threadId: tempThreadId,
        tabId: activeTabId,
      });
      if (!result.ok) {
        toast.danger(result.error ?? "Picker failed");
        return { ok: false, cancelled: false, error: result.error ?? "Picker failed" };
      }
      if (result.cancelled) {
        return { ok: true, cancelled: true };
      }
      if (
        !(result.attachmentPath && result.attachmentName && result.selector && result.sourceUrl)
      ) {
        toast.danger("Picker returned no attachment");
        return { ok: false, cancelled: false, error: "Picker returned no attachment" };
      }
      const anchor = result.rect ? anchorFromSelectedRect(activeTabId, result.rect) : null;
      const attachment: PendingPickerAttachment = {
        attachmentPath: result.attachmentPath,
        attachmentName: result.attachmentName,
        mimeType: result.mimeType ?? "image/png",
        selector: result.selector,
        sourceUrl: result.sourceUrl,
        ...(anchor ? { anchorX: anchor.x, anchorY: anchor.y } : {}),
      };
      if (targetIds.length === 1) {
        enqueueAttach({ threadId: targetIds[0]!, ...attachment });
        toast.success("Attached browser selection.");
        return { ok: true, cancelled: false };
      }
      setPendingPickerAttachment(attachment);
      return { ok: true, cancelled: false, needsThreadChoice: true };
    } finally {
      setPickerActive(false);
    }
  }, [
    activeTabId,
    cancelPicker,
    enqueueAttach,
    pickerActive,
    setPendingPickerAttachment,
    setPickerActive,
  ]);

  const chooseTargetForPendingPick = useCallback(
    (threadId: string) => {
      const pending = useBrowserPanelStore.getState().pendingPickerAttachment;
      if (!pending) return;
      setPendingPickerAttachment(null);
      enqueueAttach({ threadId, ...pending });
      toast.success("Attached browser selection.");
    },
    [enqueueAttach, setPendingPickerAttachment],
  );

  const cancelPendingPick = useCallback(() => {
    setPendingPickerAttachment(null);
  }, [setPendingPickerAttachment]);

  return {
    pickerActive,
    startPicker,
    threadTargets,
    pendingPickerAttachment,
    chooseTargetForPendingPick,
    cancelPendingPick,
  };
}
