import { Button, Tooltip, toast } from "@heroui/react";
import {
  ChevronsDownUp,
  FilePlus,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { ProjectTreeEntry } from "@/shared/contracts";
import { ContextMenu, PixelLoader } from "@/renderer/components/common";
import { getEntryIconUrl } from "@/renderer/components/common/fileIcons";
import type { FileEditorRootContext } from "@/renderer/state/fileEditorStore";
import { useIsTabActive, useIsPathOpenInTab } from "@/renderer/state/fileEditorSelectors";
import {
  useIsDropTarget,
  useIsPathLoading,
  useProjectTreeStore,
} from "@/renderer/state/projectTreeStore";
import { TreeChildren } from "./parts/TreeEntryRow";
import { useProjectTree } from "./parts/useProjectTree";

export function ProjectTreeView(props: {
  rootContext: FileEditorRootContext;
  onSelectFile: (path: string) => void;
  onPinFile?: (path: string) => void;
}) {
  const tree = useProjectTree(props);
  const rootIsDropTarget = useIsDropTarget("");
  const rootLoading = useIsPathLoading("");
  const isAnyDirectoryLoaded = useProjectTreeStore(
    (s) => Object.keys(s.directoryEntries).length > 0,
  );

  return (
    <ContextMenu
      items={[
        {
          id: "reveal-root",
          label: "Reveal in File Explorer",
          icon: <FolderOpen className="size-3.5" />,
        },
        { id: "new-file", label: "New File", icon: <FilePlus className="size-3.5" /> },
        { id: "new-folder", label: "New Folder", icon: <FolderPlus className="size-3.5" /> },
        {
          id: "collapse-all",
          label: "Collapse All",
          icon: <ChevronsDownUp className="size-3.5" />,
        },
        { id: "refresh", label: "Refresh", icon: <RefreshCw className="size-3.5" /> },
      ]}
      onAction={(action) => {
        void tree.handleRootAction(action);
      }}
    >
      <div
        className="flex h-full min-h-0 flex-col bg-inherit"
        onDragOver={(event) => {
          event.preventDefault();
          useProjectTreeStore.getState().setDropTargetPath("");
        }}
        onDragLeave={() => {
          if (useProjectTreeStore.getState().dropTargetPath === "") {
            useProjectTreeStore.getState().setDropTargetPath(null);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          useProjectTreeStore.getState().setDropTargetPath(null);
          const payload = event.dataTransfer.getData("application/lightcode-project-tree");
          if (!payload) return;
          try {
            const { path } = JSON.parse(payload) as { path: string };
            void tree
              .handleMovePath(path, "")
              .catch((error) =>
                toast.danger(error instanceof Error ? error.message : String(error)),
              );
          } catch {
            // ignore malformed drops
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-0 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-[color:var(--border)] bg-background px-3 py-1.5">
            <Search className="size-3.5 shrink-0 text-muted" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
              placeholder="Search files"
              value={tree.searchQuery}
              onChange={(event) => tree.setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && tree.searchQuery) {
                  event.preventDefault();
                  tree.setSearchQuery("");
                }
              }}
            />
            {tree.searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => tree.setSearchQuery("")}
                className="flex size-4 shrink-0 items-center justify-center rounded text-muted hover:bg-white/8 hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
          <Tooltip delay={200}>
            <Tooltip.Trigger>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => void tree.handleRootAction("collapse-all")}
              >
                <ChevronsDownUp className="size-4" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content placement="bottom">Collapse all folders</Tooltip.Content>
          </Tooltip>
        </div>

        <div
          className={`min-h-0 flex-1 overflow-auto px-0 py-2 ${
            rootIsDropTarget ? "ring-1 ring-inset ring-accent/40" : ""
          }`}
        >
          {tree.searchQuery.trim() ? (
            tree.searchLoading ? (
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted">
                <PixelLoader size="sm" />
                Searching…
              </div>
            ) : tree.searchResults.length > 0 ? (
              <div>
                {tree.searchResults.map((entry) => (
                  <SearchResultRow
                    key={entry.path}
                    entry={entry}
                    onOpen={() => tree.openSearchResult(entry)}
                  />
                ))}
              </div>
            ) : (
              <div className="px-2 py-2 text-xs text-muted">
                No files match "{tree.searchQuery}".
              </div>
            )
          ) : (
            <div>
              {rootLoading && !isAnyDirectoryLoaded ? (
                <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted">
                  <PixelLoader size="sm" />
                  Loading…
                </div>
              ) : (
                <TreeChildren
                  parentPath=""
                  depth={0}
                  isLoading={rootLoading}
                  draft={tree.draft}
                  setDraft={tree.setDraft}
                  onSelectFile={tree.handleSelectFile}
                  {...(props.onPinFile ? { onPinFile: props.onPinFile } : {})}
                  onToggleDirectory={tree.toggleDirectory}
                  onEntryAction={tree.handleEntryAction}
                  onMovePath={tree.handleMovePath}
                  onHandleRename={tree.handleRenameEntry}
                  onHandleCreate={tree.handleCreateEntry}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </ContextMenu>
  );
}

function SearchResultRow(props: { entry: ProjectTreeEntry; onOpen: () => void }) {
  const { entry } = props;
  const isSelected = useIsTabActive(entry.path);
  const isOpenInTabRaw = useIsPathOpenInTab(entry.path);
  const isOpenInTab = !isSelected && isOpenInTabRaw;

  const lastSlash = entry.path.lastIndexOf("/");
  const dirPath = lastSlash >= 0 ? entry.path.slice(0, lastSlash) : "";

  return (
    <button
      className={`flex w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-left text-sm text-muted transition-colors hover:bg-white/[0.04] hover:text-foreground ${
        isSelected
          ? "bg-white/[0.08] text-foreground"
          : isOpenInTab
            ? "bg-white/[0.04] text-foreground"
            : ""
      }`}
      onClick={props.onOpen}
      title={entry.path}
      type="button"
    >
      <img
        alt=""
        aria-hidden
        className="size-4 shrink-0"
        src={getEntryIconUrl(entry.name, entry.type === "directory")}
      />
      <span className="min-w-0 truncate">{entry.name}</span>
      {dirPath && (
        <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted/70">
          {dirPath}
        </span>
      )}
    </button>
  );
}
