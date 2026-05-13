import { useEffect, useRef, useState } from "react";
import { Columns2 } from "lucide-react";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useDevTerminalStore, type DevTerminalTab } from "@/renderer/state/devTerminalStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { closeAllPanels } from "@/renderer/actions/panelActions";
import { buildWorktreeLocation } from "@/shared/worktree";
import { BottomTerminalLayout } from "./parts/BottomTerminalLayout";
import { RightTerminalLayout } from "./parts/RightTerminalLayout";

export function DevTerminalPanel(props: { hideHeader?: boolean }) {
  const { hideHeader } = props;
  const projects = useAppStore((s) => s.projects);
  const tabs = useDevTerminalStore((s) => s.tabs);
  const activeProjectId = useDevTerminalStore((s) => s.activeProjectId);
  const activeWorktreePath = useDevTerminalStore((s) => s.activeWorktreePath);
  const activeTabId = useDevTerminalStore((s) => s.activeTabId);
  const focusRequestId = useDevTerminalStore((s) => s.focusRequestId);
  const removeTab = useDevTerminalStore((s) => s.removeTab);
  const setActiveTab = useDevTerminalStore((s) => s.setActiveTab);
  const addTab = useDevTerminalStore((s) => s.addTab);
  const splitTabAction = useDevTerminalStore((s) => s.splitTab);
  const closeSplitAction = useDevTerminalStore((s) => s.closeSplit);
  const markTabActive = useDevTerminalStore((s) => s.markTabActive);
  const updateTabTitle = useDevTerminalStore((s) => s.updateTabTitle);
  const terminalPosition = useSharedSettings((s) => s.terminalPosition);
  const spawnedRef = useRef(new Set<string>());

  const projectTabs = tabs.filter((t) => {
    if (t.projectId !== activeProjectId) return false;
    if (activeWorktreePath) return t.worktreePath === activeWorktreePath;
    return !t.worktreePath;
  });
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const selectedTabId =
    projectTabs.find((tab) => tab.id === activeTabId)?.id ?? projectTabs.at(-1)?.id ?? "__add__";
  const activeTab = projectTabs.find((t) => t.id === selectedTabId);

  const isBottom = terminalPosition === "bottom";

  // Cross-fade when switching between project and worktree contexts.
  const isOpen = useDevTerminalStore((s) => s.isOpen);
  const contextKey = `${activeProjectId}:${activeWorktreePath ?? ""}`;
  const [fadeOpacity, setFadeOpacity] = useState(1);
  const prevContextRef = useRef(contextKey);
  useEffect(() => {
    if (prevContextRef.current !== contextKey) {
      prevContextRef.current = contextKey;
      if (isOpen && activeProjectId) {
        setFadeOpacity(0);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setFadeOpacity(1));
        });
      }
    }
  }, [contextKey, isOpen, activeProjectId]);
  const fadeStyle = {
    opacity: fadeOpacity,
    transition: fadeOpacity < 1 ? "none" : "opacity 150ms ease-out",
  } as const;

  // Re-spawn shells for persisted tabs and splits on mount.
  useEffect(() => {
    for (const tab of tabs) {
      const project = projects.find((p) => p.id === tab.projectId);
      if (!project) continue;
      const location = tab.worktreePath
        ? buildWorktreeLocation(project.location, tab.worktreePath)
        : project.location;

      if (!spawnedRef.current.has(tab.id)) {
        spawnedRef.current.add(tab.id);
        void readBridge()
          .startShell({
            shellId: tab.id,
            projectLocation: location,
            ...(tab.worktreePath ? { worktreePath: tab.worktreePath } : {}),
          })
          .catch(() => undefined);
      }

      if (tab.splitId && !spawnedRef.current.has(tab.splitId)) {
        spawnedRef.current.add(tab.splitId);
        void readBridge()
          .startShell({
            shellId: tab.splitId,
            projectLocation: location,
            ...(tab.worktreePath ? { worktreePath: tab.worktreePath } : {}),
          })
          .catch(() => undefined);
      }
    }
  }, [tabs, projects]);

  function handleCloseTab(tab: DevTerminalTab) {
    const remaining = tabs.filter((t) => t.id !== tab.id);
    if (tab.splitId) {
      void readBridge()
        .closeThread({ threadId: tab.splitId })
        .catch(() => undefined);
      spawnedRef.current.delete(tab.splitId);
    }
    removeTab(tab.id);
    void readBridge()
      .closeThread({ threadId: tab.id })
      .catch(() => undefined);
    spawnedRef.current.delete(tab.id);

    const remainingInContext = remaining.filter((t) => {
      if (t.projectId !== tab.projectId) return false;
      if (activeWorktreePath) return t.worktreePath === activeWorktreePath;
      return !t.worktreePath;
    });
    if (remainingInContext.length === 0) {
      if (!isBottom) closeAllPanels();
      useDevTerminalStore.getState().closePanel();
    }
  }

  function handleAddTab() {
    if (!activeProject) return;
    const name = activeWorktreePath
      ? (activeWorktreePath.split(/[/\\]/).pop() ?? activeProject.name)
      : activeProject.name;
    const tab = addTab(activeProject.id, name, activeWorktreePath ?? undefined);
    setActiveTab(tab.id);
  }

  function handleSplitTab(tab: DevTerminalTab) {
    if (!activeProject) return;
    const project = projects.find((p) => p.id === tab.projectId);
    if (!project) return;

    const splitId = splitTabAction(tab.id);
    const location = tab.worktreePath
      ? buildWorktreeLocation(project.location, tab.worktreePath)
      : project.location;
    void readBridge()
      .startShell({
        shellId: splitId,
        projectLocation: location,
        ...(tab.worktreePath ? { worktreePath: tab.worktreePath } : {}),
      })
      .catch(() => undefined);
    spawnedRef.current.add(splitId);
  }

  function handleCloseSplit(tab: DevTerminalTab) {
    const splitId = closeSplitAction(tab.id);
    if (splitId) {
      void readBridge()
        .closeThread({ threadId: splitId })
        .catch(() => undefined);
      spawnedRef.current.delete(splitId);
    }
  }

  function getTabContextItems(tab: DevTerminalTab) {
    if (!isBottom) return [];

    if (tab.splitId) {
      return [{ id: "close-split", label: "Close Split", icon: <Columns2 className="size-4" /> }];
    }
    return [
      { id: "split-terminal", label: "Split Terminal", icon: <Columns2 className="size-4" /> },
    ];
  }

  function handleTabContextAction(tab: DevTerminalTab, key: string) {
    if (key === "split-terminal") handleSplitTab(tab);
    if (key === "close-split") handleCloseSplit(tab);
  }

  function handleSelectionChange(key: string | number) {
    const id = String(key);
    if (id === "__add__") {
      handleAddTab();
      return;
    }
    const parentTab = projectTabs.find((t) => t.splitId === id);
    setActiveTab(parentTab ? parentTab.id : id);
  }

  const emptyState =
    projectTabs.length === 0 ? (
      <div className="flex h-full items-center justify-center">
        <button
          className="cursor-default rounded-lg border border-dashed border-white/10 px-6 py-4 text-sm text-muted transition-colors hover:border-white/20 hover:text-foreground"
          onClick={handleAddTab}
          type="button"
        >
          Open a terminal
        </button>
      </div>
    ) : null;

  if (isBottom) {
    return (
      <BottomTerminalLayout
        tabs={tabs}
        projectTabs={projectTabs}
        activeProject={activeProject}
        selectedTabId={selectedTabId}
        activeTab={activeTab}
        focusRequestId={focusRequestId}
        markTabActive={markTabActive}
        updateTabTitle={updateTabTitle}
        fadeStyle={fadeStyle}
        emptyState={emptyState}
        handleCloseTab={handleCloseTab}
        handleCloseSplit={handleCloseSplit}
        handleSelectionChange={handleSelectionChange}
        getTabContextItems={getTabContextItems}
        handleTabContextAction={handleTabContextAction}
      />
    );
  }

  return (
    <RightTerminalLayout
      tabs={tabs}
      projectTabs={projectTabs}
      activeProject={activeProject}
      selectedTabId={selectedTabId}
      activeTab={activeTab}
      focusRequestId={focusRequestId}
      markTabActive={markTabActive}
      updateTabTitle={updateTabTitle}
      fadeStyle={fadeStyle}
      emptyState={emptyState}
      hideHeader={hideHeader}
      handleCloseTab={handleCloseTab}
      handleSelectionChange={handleSelectionChange}
    />
  );
}
