import { useEffect, useRef, useState } from "react";
import { Tooltip, toast } from "@heroui/react";
import { Code, Eye, Maximize2, Save, X } from "lucide-react";
import { MarkdownPreview } from "./MarkdownPreview";
import { Editor, type BeforeMount, type OnMount, type Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useSortable } from "@dnd-kit/react/sortable";
import { useSharedSettings } from "../../state/sharedSettingsStore";
import { useFileEditorStore } from "../../state/fileEditorStore";
import { useDndContext, type DragSourceData } from "../../dnd";
import { lspOrchestrator } from "../../lsp";

const LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  json5: "json",
  md: "markdown",
  mdx: "markdown",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  xml: "xml",
  svg: "xml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",
  psm1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  swift: "swift",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "dockerfile",
  lua: "lua",
  r: "r",
  dart: "dart",
  vue: "html",
  svelte: "html",
  php: "php",
  ini: "ini",
  conf: "ini",
  cfg: "ini",
  env: "ini",
  gitignore: "ignore",
  makefile: "makefile",
};

export function getLanguageFromPath(filePath: string): string {
  const fileName = filePath.split("/").pop()?.toLowerCase() ?? "";
  if (fileName === "dockerfile") return "dockerfile";
  if (fileName === "makefile") return "makefile";
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return LANG_MAP[ext] ?? "plaintext";
}

function isMarkdownFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return ext === "md" || ext === "mdx";
}

// ── Monaco themes ───────────────────────────────────────────

/**
 * Define custom Monaco themes that use transparent backgrounds so the
 * parent element's CSS `var(--content-background)` shows through.
 */
function defineAppThemes(monaco: Monaco) {
  const transparent = "#00000000";

  // Disable Monaco's built-in TS/JS semantic validation.
  // When LSP is enabled, the language server provides diagnostics instead.
  // When LSP is off, we want a clean editor with no false errors.
  const diagOpts = { noSemanticValidation: true, noSyntaxValidation: false };
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(diagOpts);
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(diagOpts);

  monaco.editor.defineTheme("lightcode-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": transparent,
      "editorGutter.background": transparent,
      "editor.lineHighlightBackground": "#ffffff08",
      "editor.selectionBackground": "#ffffff18",
      "editorWidget.background": "#2a2a2e",
      "editorWidget.border": "#3a3a40",
      "scrollbar.shadow": transparent,
      "scrollbarSlider.background": "#ffffff15",
      "scrollbarSlider.hoverBackground": "#ffffff25",
      "scrollbarSlider.activeBackground": "#ffffff35",
      "editorOverviewRuler.border": transparent,
    },
  });

  monaco.editor.defineTheme("lightcode-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": transparent,
      "editorGutter.background": transparent,
      "editor.lineHighlightBackground": "#00000006",
      "editor.selectionBackground": "#00000012",
      "editorWidget.background": "#f5f5f8",
      "editorWidget.border": "#e0e0e4",
      "scrollbar.shadow": transparent,
      "scrollbarSlider.background": "#00000012",
      "scrollbarSlider.hoverBackground": "#00000020",
      "scrollbarSlider.activeBackground": "#00000030",
      "editorOverviewRuler.border": transparent,
    },
  });
}

function useResolvedTheme(): "light" | "dark" {
  const themeMode = useSharedSettings((s) => s.themeMode);
  if (themeMode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return themeMode;
}

function SortableTab(props: {
  path: string;
  index: number;
  isActive: boolean;
  isPreview: boolean;
  isDirty: boolean;
  onSelect: () => void;
  onClose: () => void;
  onDoubleClick: () => void;
}) {
  const { ref } = useSortable({
    id: `editor-tab:${props.path}`,
    index: props.index,
    type: "editor-tab",
    accept: "editor-tab",
    group: "editor-tabs",
    data: { type: "editor-tab", path: props.path } satisfies DragSourceData,
  });

  const { source } = useDndContext();
  const isDragging = source?.type === "editor-tab" && source.path === props.path;

  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={props.isActive}
      className={`group flex h-6 max-w-[220px] shrink-0 cursor-default items-center gap-1 rounded-md pl-3 pr-1 text-xs transition-colors ${
        props.isActive
          ? "bg-default/40 text-foreground"
          : "text-muted hover:bg-default/20 hover:text-foreground"
      } ${isDragging ? "opacity-60" : ""}`}
      onClick={props.onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") props.onSelect();
      }}
      onDoubleClick={props.onDoubleClick}
    >
      <span className={`min-w-0 truncate ${props.isPreview ? "italic" : ""}`} title={props.path}>
        {props.path.split("/").at(-1)}
        {props.isDirty ? " *" : ""}
      </span>
      <button
        className="ml-auto flex size-4 shrink-0 items-center justify-center rounded opacity-0 transition hover:text-danger group-hover:opacity-100"
        tabIndex={-1}
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          props.onClose();
        }}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

export function FileEditorPane(props: {
  showTabs: boolean;
  onOpenFullscreen?: () => void;
  onClose?: () => void;
}) {
  const tabs = useFileEditorStore((state) => state.tabs);
  const activePath = useFileEditorStore((state) => state.activePath);
  const previewTab = useFileEditorStore((state) => state.previewTab);
  const buffers = useFileEditorStore((state) => state.buffers);
  const setActivePath = useFileEditorStore((state) => state.setActivePath);
  const updateBuffer = useFileEditorStore((state) => state.updateBuffer);
  const discardFileChanges = useFileEditorStore((state) => state.discardFileChanges);
  const closeTab = useFileEditorStore((state) => state.closeTab);
  const pinTab = useFileEditorStore((state) => state.pinTab);
  const saveFile = useFileEditorStore((state) => state.saveFile);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const theme = useResolvedTheme();
  const lspEnabled = useSharedSettings((s) => s.editorLspEnabled);
  const rootProjectId = useFileEditorStore((state) => state.rootContext?.projectId ?? null);
  const rootProjectLocation = useFileEditorStore(
    (state) => state.rootContext?.projectLocation ?? null,
  );

  const [showPreview, setShowPreview] = useState(false);

  const buffer = activePath ? buffers[activePath] : undefined;
  const isDirty = buffer?.status === "ready" && buffer.isDirty;
  const bufferStatus = buffer?.status ?? null;
  const isMarkdown = activePath ? isMarkdownFile(activePath) : false;

  // Reset preview mode when switching files
  useEffect(() => {
    setShowPreview(false);
  }, [activePath]);

  // LSP: start language server when a file opens (if enabled)
  useEffect(() => {
    if (!lspEnabled || !monacoRef.current || !rootProjectId || !rootProjectLocation || !activePath)
      return;
    void lspOrchestrator.ensureServer(
      monacoRef.current,
      rootProjectId,
      rootProjectLocation,
      activePath,
    );
  }, [lspEnabled, rootProjectId, rootProjectLocation, activePath]);

  // LSP: document sync — didOpen when buffer loads
  useEffect(() => {
    if (!lspEnabled || !rootProjectId || !activePath || bufferStatus !== "ready") return;
    const session = lspOrchestrator.getSession(rootProjectId, activePath);
    if (!session) return;

    const currentBuffer = useFileEditorStore.getState().buffers[activePath];
    if (!currentBuffer || currentBuffer.status !== "ready") return;

    const uri = `file:///${activePath}`;
    session.docSync.didOpen(uri, currentBuffer.content, activePath);

    // Watch model for changes
    const model = monacoRef.current?.editor.getModel(monacoRef.current.Uri.file(`/${activePath}`));
    if (model) session.docSync.watchModel(model);
  }, [lspEnabled, rootProjectId, activePath, bufferStatus]);

  // LSP: cleanup when project changes
  useEffect(() => {
    const projectId = rootProjectId;
    return () => {
      if (projectId) void lspOrchestrator.stopProject(projectId);
    };
  }, [rootProjectId]);

  async function handleSave(path: string) {
    try {
      await saveFile(path);
      // LSP: notify didSave
      if (lspEnabled && rootProjectId) {
        const session = lspOrchestrator.getSession(rootProjectId, path);
        const savedBuffer = useFileEditorStore.getState().buffers[path];
        if (session && savedBuffer?.status === "ready") {
          session.docSync.didSave(`file:///${path}`, savedBuffer.content);
        }
      }
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : String(error));
    }
  }

  function handleCloseTab(path: string) {
    const tabBuffer = buffers[path];
    if (tabBuffer?.status === "ready" && tabBuffer.isDirty) {
      if (!window.confirm(`Discard unsaved changes in ${path}?`)) {
        return;
      }
      discardFileChanges(path);
    }
    closeTab(path);
  }

  const handleBeforeMount: BeforeMount = (monaco) => {
    defineAppThemes(monaco);
  };

  // Close active tab with Ctrl/Cmd+W; save with Ctrl/Cmd+S when Monaco is unmounted
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "w") {
        const path = useFileEditorStore.getState().activePath;
        if (path) {
          e.preventDefault();
          handleCloseTab(path);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && showPreview) {
        const path = useFileEditorStore.getState().activePath;
        if (path) {
          e.preventDefault();
          void handleSave(path);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // Bind Ctrl+S / Cmd+S to save
    // eslint-disable-next-line no-bitwise -- Monaco uses bitmask key combos
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const path = useFileEditorStore.getState().activePath;
      if (path) void handleSave(path);
    });
  };

  const monacoTheme = theme === "dark" ? "lightcode-dark" : "lightcode-light";

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--content-background)]">
      {props.showTabs && tabs.length > 0 ? (
        <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-[color:var(--border)] pl-1 pr-3">
          <div
            className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
            role="tablist"
            aria-label="Editor tabs"
          >
            {tabs.map((path, index) => {
              const tabBuffer = buffers[path];
              const tabDirty = tabBuffer?.status === "ready" && tabBuffer.isDirty;
              return (
                <SortableTab
                  key={path}
                  path={path}
                  index={index}
                  isActive={path === activePath}
                  isPreview={previewTab === path}
                  isDirty={tabDirty}
                  onSelect={() => setActivePath(path)}
                  onClose={() => handleCloseTab(path)}
                  onDoubleClick={() => pinTab(path)}
                />
              );
            })}
          </div>

          <div className="flex-1" />
          {isMarkdown ? (
            <Tooltip delay={300}>
              <Tooltip.Trigger>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted hover:text-foreground"
                  onClick={() => setShowPreview((v) => !v)}
                >
                  {showPreview ? <Code className="size-3" /> : <Eye className="size-3" />}
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content placement="bottom">
                {showPreview ? "Show source" : "Show preview"}
              </Tooltip.Content>
            </Tooltip>
          ) : null}
          {activePath ? (
            <Tooltip delay={300}>
              <Tooltip.Trigger>
                <button
                  type="button"
                  className={`rounded p-0.5 ${isDirty ? "text-foreground" : "text-muted/40 pointer-events-none"}`}
                  onClick={() => void handleSave(activePath)}
                >
                  <Save className="size-3" />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content placement="bottom">Save</Tooltip.Content>
            </Tooltip>
          ) : null}
          {props.onOpenFullscreen ? (
            <button
              type="button"
              className="rounded p-0.5 text-muted hover:text-foreground"
              title="Open fullscreen"
              onClick={props.onOpenFullscreen}
            >
              <Maximize2 className="size-3" />
            </button>
          ) : null}
          {props.onClose ? (
            <button
              type="button"
              className="rounded p-0.5 text-muted hover:text-foreground"
              title="Close editor"
              onClick={props.onClose}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}

      {activePath && buffer ? (
        <>
          {!props.showTabs ? (
            <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-[color:var(--border)] px-3">
              <span className="min-w-0 truncate text-xs font-medium text-foreground">
                {activePath.split("/").at(-1)}
                {isDirty ? " *" : ""}
              </span>
              <div className="flex-1" />
              {isMarkdown ? (
                <Tooltip delay={300}>
                  <Tooltip.Trigger>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted hover:text-foreground"
                      onClick={() => setShowPreview((v) => !v)}
                    >
                      {showPreview ? <Code className="size-3" /> : <Eye className="size-3" />}
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Content placement="bottom">
                    {showPreview ? "Show source" : "Show preview"}
                  </Tooltip.Content>
                </Tooltip>
              ) : null}
              <Tooltip delay={300}>
                <Tooltip.Trigger>
                  <button
                    type="button"
                    className={`rounded p-0.5 ${isDirty ? "text-foreground" : "text-muted/40 pointer-events-none"}`}
                    onClick={() => void handleSave(activePath)}
                  >
                    <Save className="size-3" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content placement="bottom">Save</Tooltip.Content>
              </Tooltip>
              {props.onOpenFullscreen ? (
                <button
                  type="button"
                  className="rounded p-0.5 text-muted hover:text-foreground"
                  title="Open fullscreen"
                  onClick={props.onOpenFullscreen}
                >
                  <Maximize2 className="size-3" />
                </button>
              ) : null}
              {props.onClose ? (
                <button
                  type="button"
                  className="rounded p-0.5 text-muted hover:text-foreground"
                  title="Close editor"
                  onClick={props.onClose}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-hidden">
            {buffer.status === "ready" && showPreview && isMarkdown ? (
              <MarkdownPreview content={buffer.content} />
            ) : buffer.status === "ready" ? (
              <Editor
                path={activePath}
                language={getLanguageFromPath(activePath)}
                theme={monacoTheme}
                value={buffer.content}
                onChange={(value) => {
                  if (value !== undefined) updateBuffer(activePath, value);
                }}
                beforeMount={handleBeforeMount}
                onMount={handleEditorMount}
                options={{
                  fontSize: 13,
                  lineHeight: 20,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  automaticLayout: true,
                  padding: { top: 4, bottom: 4 },
                  renderLineHighlightOnlyWhenFocus: true,
                  overviewRulerLanes: 0,
                  hideCursorInOverviewRuler: true,
                  overviewRulerBorder: false,
                  scrollbar: {
                    verticalScrollbarSize: 10,
                    horizontalScrollbarSize: 10,
                    verticalSliderSize: 8,
                    horizontalSliderSize: 8,
                  },
                  contextmenu: true,
                  tabSize: 2,
                }}
                loading={
                  <div className="flex h-full items-center justify-center text-sm text-muted">
                    Loading editor…
                  </div>
                }
              />
            ) : (
              <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted">
                {buffer.status === "binary"
                  ? "Binary files can't be edited here."
                  : buffer.status === "too_large"
                    ? "This file is too large for the built-in editor."
                    : "This file uses an unsupported encoding."}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted">
          Select a file to start editing.
        </div>
      )}
    </div>
  );
}
