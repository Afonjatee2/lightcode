import { useEffect, useRef, useState } from "react";
import type { DevTerminalTab } from "@/renderer/state/devTerminalStore";
import { XTermSurface } from "@/renderer/components/terminal/XTermSurface";

const SPLIT_MIN_PERCENT = 15;
const SPLIT_DEFAULT_PERCENT = 50;
const SPLIT_STORAGE_KEY = "lightcode-split-percent";

function readSplitPercent(): number {
  try {
    const raw = localStorage.getItem(SPLIT_STORAGE_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      if (
        Number.isFinite(parsed) &&
        parsed >= SPLIT_MIN_PERCENT &&
        parsed <= 100 - SPLIT_MIN_PERCENT
      ) {
        return parsed;
      }
    }
  } catch {
    /* ignore */
  }
  return SPLIT_DEFAULT_PERCENT;
}

export function TerminalSurfaces(props: {
  tabs: DevTerminalTab[];
  selectedTabId: string;
  activeTab: DevTerminalTab | undefined;
  markTabActive: (tabId: string) => void;
  updateTabTitle: (tabId: string, title: string) => void;
}) {
  const { tabs, selectedTabId, activeTab, markTabActive, updateTabTitle } = props;
  const [splitPercent, setSplitPercent] = useState(readSplitPercent);
  const [resizing, setResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const firstPaneRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ startX: 0, startPercent: 0 });
  const splitPercentRef = useRef(splitPercent);

  useEffect(() => {
    splitPercentRef.current = splitPercent;
    if (firstPaneRef.current) {
      firstPaneRef.current.style.flexBasis = `${splitPercent}%`;
    }
  }, [splitPercent]);

  useEffect(() => {
    localStorage.setItem(SPLIT_STORAGE_KEY, String(splitPercent));
  }, [splitPercent]);

  useEffect(() => {
    if (!resizing) return;

    function onMouseMove(e: MouseEvent) {
      const container = containerRef.current;
      if (!container) return;
      const totalWidth = container.offsetWidth;
      const deltaPx = e.clientX - dragRef.current.startX;
      const deltaPercent = (deltaPx / totalWidth) * 100;
      const next = dragRef.current.startPercent + deltaPercent;
      if (next >= SPLIT_MIN_PERCENT && next <= 100 - SPLIT_MIN_PERCENT) {
        splitPercentRef.current = next;
        if (firstPaneRef.current) {
          firstPaneRef.current.style.flexBasis = `${next}%`;
        }
      }
    }

    function onMouseUp() {
      setSplitPercent(splitPercentRef.current);
      setResizing(false);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [resizing]);

  function handleResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startPercent: splitPercent };
    setResizing(true);
  }

  if (activeTab?.splitId) {
    return (
      <div
        ref={containerRef}
        className={`flex h-full min-h-0 w-full ${resizing ? "select-none" : ""}`}
      >
        <div
          ref={firstPaneRef}
          className="relative h-full min-h-0 min-w-0 overflow-hidden"
          style={{ flexBasis: `${splitPercent}%`, flexGrow: 0, flexShrink: 0 }}
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`absolute inset-0 ${tab.id === selectedTabId ? "" : "invisible"}`}
            >
              <XTermSurface
                terminalId={tab.id}
                onActivity={() => markTabActive(tab.id)}
                onBell={() => markTabActive(tab.id)}
                onTitleChange={(title) => updateTabTitle(tab.id, title)}
              />
            </div>
          ))}
        </div>
        <div
          className="lightcode-pane-divider"
          onMouseDown={handleResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize split"
        />
        <div className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden">
          {tabs
            .filter((t) => t.splitId)
            .map((tab) => (
              <div
                key={tab.splitId}
                className={`absolute inset-0 ${tab.id === selectedTabId ? "" : "invisible"}`}
              >
                <XTermSurface
                  terminalId={tab.splitId!}
                  onActivity={() => markTabActive(tab.id)}
                  onBell={() => markTabActive(tab.id)}
                  onTitleChange={(title) => updateTabTitle(tab.splitId!, title)}
                />
              </div>
            ))}
        </div>
        {resizing && <div className="fixed inset-0 z-50 cursor-col-resize" />}
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`absolute inset-0 ${tab.id === selectedTabId ? "" : "invisible"}`}
        >
          <XTermSurface
            terminalId={tab.id}
            onActivity={() => markTabActive(tab.id)}
            onBell={() => markTabActive(tab.id)}
            onTitleChange={(title) => updateTabTitle(tab.id, title)}
          />
        </div>
      ))}
    </div>
  );
}
