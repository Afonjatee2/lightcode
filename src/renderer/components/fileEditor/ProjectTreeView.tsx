import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button, Spinner, Tooltip, toast } from "@heroui/react";
import {
  ChevronRight,
  ChevronsDownUp,
  Copy,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  FilePlus,
} from "lucide-react";
import type { ProjectLocation, ProjectTreeEntry } from "../../../shared/contracts";
import { readBridge } from "../../bridge";
import { ContextMenu } from "../common";
import { getEntryIconUrl } from "../common/fileIcons";
import { useFileEditorStore, type FileEditorRootContext } from "../../state/fileEditorStore";

interface TreeDraftState {
  mode: "create" | "rename";
  type: "file" | "directory";
  parentPath: string;
  path?: string;
  value: string;
}

export function ProjectTreeView(props: {
  rootContext: FileEditorRootContext;
  selectedPath: string | null;
  openTabs: string[];
  onSelectFile: (path: string) => void;
  onPinFile?: (path: string) => void;
}) {
  const refreshToken = useFileEditorStore((state) => state.refreshToken);
  const activePath = useFileEditorStore((state) => state.activePath);
  const activeBuffer = useFileEditorStore((state) =>
    state.activePath ? state.buffers[state.activePath] : undefined,
  );
  const discardFileChanges = useFileEditorStore((state) => state.discardFileChanges);
  const renamePath = useFileEditorStore((state) => state.renamePath);
  const removePath = useFileEditorStore((state) => state.removePath);
  const bumpRefreshToken = useFileEditorStore((state) => state.bumpRefreshToken);

  const [directoryEntries, setDirectoryEntries] = useState<Record<string, ProjectTreeEntry[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({ "": true });
  const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProjectTreeEntry[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [draft, setDraft] = useState<TreeDraftState | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  const rootKey = `${props.rootContext.projectId}:${props.rootContext.worktreePath ?? ""}`;

  const reloadPaths = useEffectEvent(async (paths: string[]) => {
    const uniquePaths = [...new Set(paths)];
    setLoadingPaths((state) =>
      Object.fromEntries([...Object.entries(state), ...uniquePaths.map((path) => [path, true])]),
    );

    const results = await Promise.all(
      uniquePaths.map(async (path) => ({
        path,
        result: await readBridge().listProjectTree({
          projectLocation: props.rootContext.projectLocation,
          directoryPath: path,
        }),
      })),
    ).catch((error: unknown) => {
      toast.danger(error instanceof Error ? error.message : String(error));
      return [];
    });

    if (results.length > 0) {
      setDirectoryEntries((state) => ({
        ...state,
        ...Object.fromEntries(results.map((item) => [item.path, item.result.entries])),
      }));
    }
    setLoadingPaths((state) =>
      Object.fromEntries(Object.entries(state).filter(([path]) => !uniquePaths.includes(path))),
    );
  });

  useEffect(() => {
    setDirectoryEntries({});
    setExpandedPaths({ "": true });
    setDraft(null);
    setSearchQuery("");
    setSearchResults([]);
    void reloadPaths([""]);
  }, [rootKey]);

  useEffect(() => {
    const paths = Object.keys(directoryEntries);
    void reloadPaths(paths.length > 0 ? paths : [""]);
    // directoryEntries is intentionally omitted here: refreshes should reload
    // the currently visible tree snapshot, not trigger recursively on each write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken, rootKey]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    const handle = setTimeout(() => {
      void readBridge()
        .searchProjectTree({
          projectLocation: props.rootContext.projectLocation,
          query: searchQuery,
          limit: 50,
        })
        .then((result) => setSearchResults(result.entries))
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }, 120);

    return () => clearTimeout(handle);
  }, [props.rootContext.projectLocation, searchQuery]);

  async function toggleDirectory(path: string) {
    const isExpanded = expandedPaths[path] ?? false;
    if (!isExpanded && !(path in directoryEntries)) {
      await reloadPaths([path]);
    }
    setExpandedPaths((state) => ({ ...state, [path]: !isExpanded }));
  }

  function ensureActiveBufferCanChange(nextPath: string): boolean {
    if (
      !activePath ||
      activePath === nextPath ||
      !activeBuffer ||
      activeBuffer.status !== "ready" ||
      !activeBuffer.isDirty
    ) {
      return true;
    }
    if (!window.confirm(`Discard unsaved changes in ${activePath}?`)) {
      return false;
    }
    discardFileChanges(activePath);
    return true;
  }

  async function handleSelectFile(path: string) {
    if (!ensureActiveBufferCanChange(path)) return;
    props.onSelectFile(path);
  }

  async function handleCopyAbsolutePath(path: string) {
    await navigator.clipboard.writeText(
      resolveAbsolutePath(props.rootContext.projectLocation, path),
    );
  }

  async function handleCreateEntry(parentPath: string, type: "file" | "directory", name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const nextPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
    await readBridge().createProjectEntry({
      projectLocation: props.rootContext.projectLocation,
      path: nextPath,
      type,
    });
    bumpRefreshToken();
    setDraft(null);
    if (type === "file") {
      await handleSelectFile(nextPath);
      props.onPinFile?.(nextPath);
    }
  }

  async function handleRenameEntry(path: string, nextName: string) {
    const trimmed = nextName.trim();
    if (!trimmed) return;
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const nextPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
    await readBridge().renameProjectEntry({
      projectLocation: props.rootContext.projectLocation,
      path,
      nextName: trimmed,
    });
    renamePath(path, nextPath);
    setDraft(null);
  }

  async function handleDeleteEntry(entry: ProjectTreeEntry) {
    if (!window.confirm(`Delete ${entry.path}?`)) return;
    await readBridge().deleteProjectEntry({
      projectLocation: props.rootContext.projectLocation,
      path: entry.path,
    });
    removePath(entry.path);
  }

  async function handleMovePath(sourcePath: string, nextParentPath: string) {
    await readBridge().moveProjectEntry({
      projectLocation: props.rootContext.projectLocation,
      path: sourcePath,
      nextParentPath,
    });
    const currentName = sourcePath.split("/").at(-1);
    if (!currentName) return;
    const nextPath = nextParentPath ? `${nextParentPath}/${currentName}` : currentName;
    renamePath(sourcePath, nextPath);
  }

  function expandAncestors(path: string) {
    const parts = path.split("/");
    let cursor = "";
    const nextExpanded: Record<string, boolean> = { "": true };
    const pathsToLoad = [""];
    for (let index = 0; index < parts.length - 1; index += 1) {
      cursor = cursor ? `${cursor}/${parts[index]}` : parts[index]!;
      nextExpanded[cursor] = true;
      pathsToLoad.push(cursor);
    }
    setExpandedPaths((state) => ({ ...state, ...nextExpanded }));
    void reloadPaths(pathsToLoad);
  }

  function openSearchResult(entry: ProjectTreeEntry) {
    expandAncestors(entry.path);
    setSearchQuery("");
    setSearchResults([]);
    if (entry.type === "directory") {
      setExpandedPaths((state) => ({ ...state, [entry.path]: true }));
      void reloadPaths([entry.path]);
      return;
    }
    void handleSelectFile(entry.path);
  }

  async function handleEntryAction(entry: ProjectTreeEntry, action: string) {
    try {
      if (action === "reveal") {
        await readBridge().revealProjectEntry({
          projectLocation: props.rootContext.projectLocation,
          path: entry.path,
        });
        return;
      }
      if (action === "copy-path") {
        await handleCopyAbsolutePath(entry.path);
        return;
      }
      if (action === "copy-relative-path") {
        await navigator.clipboard.writeText(entry.path);
        return;
      }
      if (action === "rename") {
        setDraft({
          mode: "rename",
          type: entry.type,
          parentPath: entry.path.includes("/")
            ? entry.path.slice(0, entry.path.lastIndexOf("/"))
            : "",
          path: entry.path,
          value: entry.name,
        });
        return;
      }
      if (action === "delete") {
        await handleDeleteEntry(entry);
        return;
      }
      if (action === "new-file") {
        setExpandedPaths((state) => ({ ...state, [entry.path]: true }));
        await reloadPaths([entry.path]);
        setDraft({
          mode: "create",
          type: "file",
          parentPath: entry.path,
          value: "",
        });
        return;
      }
      if (action === "new-folder") {
        setExpandedPaths((state) => ({ ...state, [entry.path]: true }));
        await reloadPaths([entry.path]);
        setDraft({
          mode: "create",
          type: "directory",
          parentPath: entry.path,
          value: "",
        });
      }
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRootAction(action: string) {
    try {
      if (action === "reveal-root") {
        await readBridge().revealProjectEntry({
          projectLocation: props.rootContext.projectLocation,
          path: "",
        });
        return;
      }
      if (action === "new-file") {
        setDraft({ mode: "create", type: "file", parentPath: "", value: "" });
        return;
      }
      if (action === "new-folder") {
        setDraft({ mode: "create", type: "directory", parentPath: "", value: "" });
        return;
      }
      if (action === "collapse-all") {
        setExpandedPaths({ "": true });
        setDirectoryEntries({});
        await reloadPaths([""]);
        return;
      }
      if (action === "refresh") {
        await reloadPaths(
          Object.keys(directoryEntries).length > 0 ? Object.keys(directoryEntries) : [""],
        );
      }
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : String(error));
    }
  }

  function getDraftRow(parentPath: string, depth: number) {
    if (!draft || draft.parentPath !== parentPath || draft.mode !== "create") return null;
    return (
      <InlineDraftRow
        depth={depth}
        type={draft.type}
        value={draft.value}
        onChange={(value) => setDraft((state) => (state ? { ...state, value } : state))}
        onCancel={() => setDraft(null)}
        onCommit={(value) => {
          void handleCreateEntry(parentPath, draft.type, value).catch((error) =>
            toast.danger(error instanceof Error ? error.message : String(error)),
          );
        }}
      />
    );
  }

  function renderEntries(parentPath: string, depth: number): React.ReactNode {
    const entries = directoryEntries[parentPath] ?? [];
    const isLoading = loadingPaths[parentPath];

    return (
      <>
        {entries.map((entry) => {
          const isDirectory = entry.type === "directory";
          const isExpanded = expandedPaths[entry.path] ?? false;
          const isSelected = props.selectedPath === entry.path;
          const isOpenInTab = !isSelected && props.openTabs.includes(entry.path);
          const isRenameDraft = draft?.mode === "rename" && draft.path === entry.path;
          const iconUrl = getEntryIconUrl(entry.name, isDirectory);

          return (
            <div key={entry.path}>
              <ContextMenu
                items={[
                  {
                    id: "reveal",
                    label: "Reveal in File Explorer",
                    icon: <FolderOpen className="size-3.5" />,
                  },
                  ...(isDirectory
                    ? [
                        {
                          id: "new-file",
                          label: "New File",
                          icon: <FilePlus className="size-3.5" />,
                        },
                        {
                          id: "new-folder",
                          label: "New Folder",
                          icon: <FolderPlus className="size-3.5" />,
                        },
                      ]
                    : []),
                  {
                    id: "copy-path",
                    label: "Copy Path",
                    icon: <Copy className="size-3.5" />,
                  },
                  {
                    id: "copy-relative-path",
                    label: "Copy Relative Path",
                    icon: <Copy className="size-3.5" />,
                  },
                  {
                    id: "rename",
                    label: "Rename",
                    icon: <Pencil className="size-3.5" />,
                  },
                  {
                    id: "delete",
                    label: "Delete",
                    icon: <Trash2 className="size-3.5" />,
                    variant: "danger",
                  },
                ]}
                onAction={(action) => {
                  void handleEntryAction(entry, action);
                }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  draggable
                  className={`group flex items-center gap-1.5 rounded-md px-2 py-0.5 text-sm text-muted transition-colors ${
                    isSelected
                      ? "bg-white/[0.08] text-foreground"
                      : isOpenInTab
                        ? "bg-white/[0.04] text-foreground hover:bg-white/[0.06]"
                        : "hover:bg-white/[0.04] hover:text-foreground"
                  } ${dropTargetPath === entry.path ? "ring-1 ring-accent/40" : ""}`}
                  style={{ paddingLeft: `${depth * 14 + 8}px` }}
                  onClick={() => {
                    if (isDirectory) {
                      void toggleDirectory(entry.path);
                    } else {
                      void handleSelectFile(entry.path);
                    }
                  }}
                  onDoubleClick={() => {
                    if (!isDirectory) {
                      props.onPinFile?.(entry.path);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    if (isDirectory) {
                      void toggleDirectory(entry.path);
                    } else {
                      void handleSelectFile(entry.path);
                    }
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      "application/lightcode-project-tree",
                      JSON.stringify({ path: entry.path, type: entry.type }),
                    );
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(event) => {
                    if (isDirectory) {
                      event.preventDefault();
                      setDropTargetPath(entry.path);
                    }
                  }}
                  onDragLeave={() => {
                    if (dropTargetPath === entry.path) {
                      setDropTargetPath(null);
                    }
                  }}
                  onDrop={(event) => {
                    if (!isDirectory) return;
                    event.preventDefault();
                    setDropTargetPath(null);
                    const payload = event.dataTransfer.getData(
                      "application/lightcode-project-tree",
                    );
                    if (!payload) return;
                    try {
                      const { path } = JSON.parse(payload) as { path: string };
                      void handleMovePath(path, entry.path).catch((error) =>
                        toast.danger(error instanceof Error ? error.message : String(error)),
                      );
                    } catch {
                      // ignore malformed drops
                    }
                  }}
                >
                  <div className="flex size-4 shrink-0 items-center justify-center">
                    {isDirectory ? (
                      entry.hasChildren ? (
                        <ChevronRight
                          className={`size-3.5 text-muted/70 transition-transform ${
                            isExpanded ? "rotate-90" : ""
                          }`}
                        />
                      ) : null
                    ) : null}
                  </div>
                  <img alt="" aria-hidden className="size-4 shrink-0" src={iconUrl} />
                  {isRenameDraft ? (
                    <InlineNameInput
                      value={draft?.value ?? ""}
                      onChange={(value) =>
                        setDraft((state) => (state ? { ...state, value } : state))
                      }
                      onCancel={() => setDraft(null)}
                      onCommit={(value) => {
                        void handleRenameEntry(entry.path, value).catch((error) =>
                          toast.danger(error instanceof Error ? error.message : String(error)),
                        );
                      }}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  )}
                </div>
              </ContextMenu>

              {isDirectory && isExpanded ? (
                <div>
                  {getDraftRow(entry.path, depth + 1)}
                  {isLoading ? (
                    <div
                      className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted"
                      style={{ paddingLeft: `${(depth + 1) * 14 + 8}px` }}
                    >
                      <Spinner size="sm" />
                      Loading…
                    </div>
                  ) : (
                    renderEntries(entry.path, depth + 1)
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
        {getDraftRow(parentPath, depth)}
      </>
    );
  }

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
        void handleRootAction(action);
      }}
    >
      <div
        className="flex h-full min-h-0 flex-col bg-[var(--content-background)]"
        onDragOver={(event) => {
          event.preventDefault();
          setDropTargetPath("");
        }}
        onDragLeave={() => {
          if (dropTargetPath === "") setDropTargetPath(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDropTargetPath(null);
          const payload = event.dataTransfer.getData("application/lightcode-project-tree");
          if (!payload) return;
          try {
            const { path } = JSON.parse(payload) as { path: string };
            void handleMovePath(path, "").catch((error) =>
              toast.danger(error instanceof Error ? error.message : String(error)),
            );
          } catch {
            // ignore malformed drops
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-[color:var(--border)] bg-background px-3 py-1.5">
            <Search className="size-3.5 shrink-0 text-muted" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
              placeholder="Search files"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
          <Tooltip delay={200}>
            <Tooltip.Trigger>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => void handleRootAction("collapse-all")}
              >
                <ChevronsDownUp className="size-4" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content placement="bottom">Collapse all folders</Tooltip.Content>
          </Tooltip>
        </div>

        <div
          className={`min-h-0 flex-1 overflow-auto px-2 py-2 ${
            dropTargetPath === "" ? "ring-1 ring-inset ring-accent/40" : ""
          }`}
        >
          {searchQuery.trim() ? (
            searchLoading ? (
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted">
                <Spinner size="sm" />
                Searching…
              </div>
            ) : searchResults.length > 0 ? (
              <div>
                {searchResults.map((entry) => {
                  const isSearchSelected = props.selectedPath === entry.path;
                  const isSearchOpenInTab =
                    !isSearchSelected && props.openTabs.includes(entry.path);
                  return (
                    <button
                      key={entry.path}
                      className={`flex w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-left text-sm text-muted transition-colors hover:bg-white/[0.04] hover:text-foreground ${
                        isSearchSelected
                          ? "bg-white/[0.08] text-foreground"
                          : isSearchOpenInTab
                            ? "bg-white/[0.04] text-foreground"
                            : ""
                      }`}
                      onClick={() => openSearchResult(entry)}
                      type="button"
                    >
                      <img
                        alt=""
                        aria-hidden
                        className="size-4 shrink-0"
                        src={getEntryIconUrl(entry.name, entry.type === "directory")}
                      />
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      <span className="shrink-0 text-[11px] text-muted/70">{entry.path}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-2 py-2 text-xs text-muted">No files match “{searchQuery}”.</div>
            )
          ) : (
            <div>
              {loadingPaths[""] && !("" in directoryEntries) ? (
                <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted">
                  <Spinner size="sm" />
                  Loading…
                </div>
              ) : (
                renderEntries("", 0)
              )}
            </div>
          )}
        </div>
      </div>
    </ContextMenu>
  );
}

function InlineNameInput(props: {
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  return (
    <input
      ref={inputRef}
      className="min-w-0 flex-1 rounded bg-transparent text-sm text-foreground outline-none"
      value={props.value}
      onBlur={() => props.onCommit(props.value)}
      onChange={(event) => props.onChange(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          props.onCommit(props.value);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          props.onCancel();
        }
      }}
    />
  );
}

function InlineDraftRow(props: {
  depth: number;
  type: "file" | "directory";
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-sm text-foreground"
      style={{ paddingLeft: `${props.depth * 14 + 8}px` }}
    >
      <div className="size-4 shrink-0" />
      {props.type === "directory" ? (
        <FolderPlus className="size-4 shrink-0 text-muted" />
      ) : (
        <FilePlus className="size-4 shrink-0 text-muted" />
      )}
      <InlineNameInput
        value={props.value}
        onChange={props.onChange}
        onCommit={props.onCommit}
        onCancel={props.onCancel}
      />
    </div>
  );
}

function resolveAbsolutePath(location: ProjectLocation, path: string): string {
  if (location.kind === "wsl") {
    const suffix = path ? `\\${path.replace(/\//g, "\\")}` : "";
    return `${location.uncPath}${suffix}`;
  }
  if (location.kind === "posix") {
    const suffix = path ? `/${path}` : "";
    return `${location.path}${suffix}`;
  }
  const suffix = path ? `\\${path.replace(/\//g, "\\")}` : "";
  return `${location.path}${suffix}`;
}
