import { useCallback, useEffect, useRef, useState } from "react";
import { Minimize2 } from "lucide-react";
import { isMac, readBridge } from "@/renderer/bridge";
import { useBrowserPanelStore } from "@/renderer/state/browserPanelStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import {
  macosTrafficLightGutterClass,
  overlayHeaderStyle,
  panelHeaderIconButtonClass,
} from "@/renderer/components/layout/sidebarChrome";
import { BrowserEmptyState } from "./parts/BrowserEmptyState";
import { BrowserTabStrip } from "./parts/BrowserTabStrip";
import { BrowserToolbar } from "./parts/BrowserToolbar";
import { useElementPicker } from "./hooks/useElementPicker";

const DEFAULT_HOME = "https://www.google.com";

export function BrowserPanel(props: { visible: boolean }) {
  const tabs = useBrowserPanelStore((s) => s.tabs);
  const activeTabId = useBrowserPanelStore((s) => s.activeTabId);
  const browserOverlayOpen = usePanelStore((s) => s.browserOverlayOpen);
  const setBrowserOverlayOpen = usePanelStore((s) => s.setBrowserOverlayOpen);
  const visible = props.visible || browserOverlayOpen;
  const [menuPreviewDataUrl, setMenuPreviewDataUrl] = useState<string | null>(null);
  const {
    pickerActive,
    startPicker,
    threadTargets,
    pendingPickerAttachment,
    chooseTargetForPendingPick,
    cancelPendingPick,
  } = useElementPicker();
  const everHadTabsRef = useRef(false);
  const hasActiveTab = tabs.length > 0 && activeTabId !== null;

  const createTab = useCallback(async () => {
    try {
      await readBridge().browserCreateTab({ url: DEFAULT_HOME, activate: true });
    } catch {}
  }, []);

  const onPick = useCallback(() => {
    void startPicker();
  }, [startPicker]);

  useEffect(() => {
    if (tabs.length > 0) everHadTabsRef.current = true;
  }, [tabs.length]);

  useEffect(() => {
    if (!visible) return;
    if (tabs.length > 0) return;
    if (everHadTabsRef.current) return;
    // Small grace window so persisted tabs restored by main don't race with
    // an auto-create on cold start.
    const timer = setTimeout(() => {
      if (useBrowserPanelStore.getState().tabs.length === 0 && !everHadTabsRef.current) {
        void createTab();
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [createTab, visible, tabs.length]);

  return (
    <div
      className={
        browserOverlayOpen
          ? "fixed inset-0 z-[80] flex min-h-0 flex-col bg-[var(--content-background)]"
          : "flex h-full min-h-0 flex-col bg-[var(--content-background)]"
      }
    >
      {browserOverlayOpen ? (
        <div
          className="lightcode-overlay-header flex shrink-0 items-center gap-1.5 border-b border-[color:var(--border)] bg-[var(--content-background)] px-2"
          style={overlayHeaderStyle()}
        >
          {isMac() ? <div className={macosTrafficLightGutterClass} aria-hidden /> : null}
          <div className="text-xs font-medium text-foreground">Browser</div>
          <div className="flex-1" />
          <button
            type="button"
            className={`lightcode-overlay-header__controls ${panelHeaderIconButtonClass}`}
            title="Collapse browser"
            onClick={() => setBrowserOverlayOpen(false)}
          >
            <Minimize2 className="size-3.5" />
          </button>
        </div>
      ) : null}
      <BrowserToolbar
        onPick={onPick}
        onCreateTab={createTab}
        pickerActive={pickerActive}
        pickerTargets={threadTargets}
        hasPendingPick={pendingPickerAttachment !== null}
        pendingPickAnchor={
          pendingPickerAttachment &&
          typeof pendingPickerAttachment.anchorX === "number" &&
          typeof pendingPickerAttachment.anchorY === "number"
            ? { x: pendingPickerAttachment.anchorX, y: pendingPickerAttachment.anchorY }
            : null
        }
        onChoosePickTarget={chooseTargetForPendingPick}
        onCancelPendingPick={cancelPendingPick}
        onMenuPreviewChange={setMenuPreviewDataUrl}
      />
      <BrowserTabStrip />
      <div className="relative flex-1 overflow-hidden bg-[var(--surface-background,#0d1117)]">
        {tabs.map((tab) => (
          <BrowserTabWebview
            key={tab.tabId}
            tabId={tab.tabId}
            initialSrc={tab.url}
            visible={visible && !menuPreviewDataUrl && tab.tabId === activeTabId}
          />
        ))}
        {menuPreviewDataUrl ? (
          <img
            src={menuPreviewDataUrl}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 size-full object-cover object-left-top"
          />
        ) : null}
        {!hasActiveTab ? (
          <div className="absolute inset-0">
            <BrowserEmptyState onCreateTab={createTab} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BrowserTabWebview(props: { tabId: string; initialSrc: string; visible: boolean }) {
  const ref = useRef<HTMLWebViewElement | null>(null);
  const initialSrcRef = useRef(props.initialSrc);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const onDomReady = () => {
      if (cancelled) return;
      let webContentsId: number;
      try {
        webContentsId = el.getWebContentsId();
      } catch {
        return;
      }
      readBridge()
        .browserAttachWebContents({ tabId: props.tabId, webContentsId })
        .catch(() => {});
    };
    el.addEventListener("dom-ready", onDomReady);
    return () => {
      cancelled = true;
      el.removeEventListener("dom-ready", onDomReady);
    };
  }, [props.tabId]);

  return (
    <webview
      ref={ref}
      data-tab-id={props.tabId}
      src={initialSrcRef.current || "about:blank"}
      allowpopups={true}
      className="absolute inset-0 size-full"
      style={{ display: props.visible ? "flex" : "none" }}
    />
  );
}
