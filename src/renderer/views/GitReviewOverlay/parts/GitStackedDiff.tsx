import { useEffect, useRef, useState } from "react";
import { DiffFile, DiffView, highlighter, setEnableFastDiffTemplate } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view.css";

setEnableFastDiffTemplate(true);

import { PixelLoader } from "@/renderer/components/common";
import {
  ChevronDown,
  ChevronRight,
  CircleMinus,
  CirclePlus,
  Lock,
  Minus,
  Plus,
  Undo2,
} from "lucide-react";
import type { GitFileChange, Project } from "@/shared/contracts";
import { isLockFile } from "@/shared/gitUtils";
import { getFileIconUrl } from "@/renderer/components/common/fileIcons";
import { readBridge } from "@/renderer/bridge";
import { useGitStore } from "@/renderer/state/gitStore";
import { buildInWorker, diffFileFromBundle, extractDiffNames, getLang } from "./diffBuildClient";
import { getBasename } from "@/shared/pathUtils";
import { handleKeyActivate } from "@/renderer/utils/a11y";
import { ConfirmDialog } from "@/renderer/components/common/ConfirmDialog";

// ── Helpers ──────────────────────────────────────────────────

const LARGE_DIFF_THRESHOLD = 500;

function FileIcon(props: { path: string }) {
  const name = props.path.split(/[\\/]/).pop() ?? props.path;
  return <img src={getFileIconUrl(name)} alt="" className="size-4 shrink-0" />;
}

function FileStatusBadge(props: { status: string }) {
  const cls = "ml-1 inline-block size-3 align-[-0.15em]";
  switch (props.status) {
    case "A":
    case "?":
      return <CirclePlus className={`${cls} text-success`} />;
    case "D":
      return <CircleMinus className={`${cls} text-danger`} />;
    default:
      return null;
  }
}

// ── Single file card ─────────────────────────────────────────

export function StackedFileCard(props: {
  file: GitFileChange;
  project: Project;
  theme: "light" | "dark";
  wrapLines: boolean;
  onRefresh: () => void;
  storeKey?: string;
  isWorktree?: boolean;
}) {
  const { file, project, theme, wrapLines, onRefresh, storeKey, isWorktree } = props;
  const [expanded, setExpanded] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);
  const [diffFile, setDiffFile] = useState<DiffFile | null>(null);
  const [loading, setLoading] = useState(false);
  const loadedKeyRef = useRef<string | null>(null);
  const tooLarge = file.insertions + file.deletions > LARGE_DIFF_THRESHOLD;

  const basename = getBasename(file.path);
  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : undefined;

  // Theme is intentionally excluded from the fetch key — DiffView re-styles without re-fetching.
  const fetchKey = `${file.path}|${file.staged ? "s" : "u"}|${file.status}|${file.insertions}|${file.deletions}`;

  useEffect(() => {
    if (!expanded || tooLarge) return;
    if (loadedKeyRef.current === fetchKey) return;
    loadedKeyRef.current = fetchKey;
    let cancelled = false;

    setLoading(true);

    async function load() {
      try {
        const [result, { oldContent, newContent }] = await Promise.all([
          readBridge().getGitDiff({
            projectLocation: project.location,
            filePath: file.path,
            staged: file.staged,
          }),
          readBridge().getGitFileContent({
            projectLocation: project.location,
            filePath: file.path,
            staged: file.staged,
          }),
        ]);
        if (cancelled) return;

        const rawDiff = result.diff;
        if (!rawDiff.trim()) {
          setLoading(false);
          return;
        }

        const { oldName, newName } = extractDiffNames(rawDiff);
        const fileLang = getLang(newName || file.path);

        const results = await buildInWorker(
          [
            {
              key: `stacked:${file.staged ? "s" : "u"}:${file.path}`,
              diff: rawDiff,
              oldName,
              newName,
              fileLang,
              oldContent,
              newContent,
            },
          ],
          theme,
        );
        if (cancelled) return;

        const r = results[0];
        if (r?.bundle) {
          setDiffFile(diffFileFromBundle(r.data, r.bundle));
        }
      } catch {
        // Diff unavailable
      }
      if (!cancelled) setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [expanded, tooLarge, fetchKey, file.path, file.staged, project.location, theme]);

  async function handleStageToggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (storeKey) {
      const store = useGitStore.getState();
      if (file.staged) {
        store.optimisticUnstageFile(storeKey, file.path, isWorktree ?? false);
      } else {
        store.optimisticStageFile(storeKey, file.path, isWorktree ?? false);
      }
    }
    if (file.staged) {
      await readBridge()
        .gitUnstage({ projectLocation: project.location, filePath: file.path })
        .catch(() => onRefresh());
    } else {
      await readBridge()
        .gitStage({ projectLocation: project.location, filePath: file.path })
        .catch(() => onRefresh());
    }
  }

  function handleRevertClick(e: React.MouseEvent) {
    e.stopPropagation();
    setRevertOpen(true);
  }

  async function handleRevert() {
    await readBridge().gitRevert({ projectLocation: project.location, filePath: file.path });
    setRevertOpen(false);
    onRefresh();
  }

  const isNewFile = file.deletions === 0 && file.status !== "M" && file.status !== "D";

  return (
    <>
      <div className="min-w-0">
        {/* File header */}
        <div
          role="button"
          tabIndex={0}
          className="sticky top-0 z-10 bg-[var(--content-background)] group flex cursor-pointer select-none items-center gap-1.5 px-3 py-1 text-xs transition-colors hover:bg-content2"
          onClick={() => setExpanded((v) => !v)}
          onKeyDown={(e) => handleKeyActivate(e, () => setExpanded((v) => !v))}
        >
          {expanded ? (
            <ChevronDown className="size-3 shrink-0 text-muted" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-muted" />
          )}
          <FileIcon path={file.path} />
          <span className="min-w-0 flex-1 truncate" title={file.path}>
            <span className="font-medium text-foreground">{basename}</span>
            {isLockFile(file.path) && <Lock className="ml-1 inline-block size-2 text-muted/40" />}
            {dir && <span className="ml-1 text-muted/60">{dir}</span>}
            <FileStatusBadge status={file.status} />
          </span>
          <span className="relative w-14 shrink-0">
            {/* Stats — visible when not hovering */}
            <span className="flex items-center justify-end text-[10px] font-medium transition-opacity group-hover:opacity-0">
              {file.insertions > 0 && <span className="text-success">+{file.insertions}</span>}
              {file.deletions > 0 && <span className="ml-0.5 text-danger">-{file.deletions}</span>}
            </span>
            {/* Action buttons — visible on hover */}
            <span className="absolute inset-0 flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <div
                role="button"
                tabIndex={0}
                className="rounded p-0.5 text-muted transition-colors hover:bg-white/[0.04] hover:text-foreground"
                title={file.staged ? "Unstage" : "Stage"}
                onClick={handleStageToggle}
                onKeyDown={(e) =>
                  handleKeyActivate(
                    e,
                    () => void handleStageToggle(e as unknown as React.MouseEvent),
                    { stopPropagation: true },
                  )
                }
              >
                {file.staged ? <Minus className="size-3" /> : <Plus className="size-3" />}
              </div>
              {!file.staged && (
                <div
                  role="button"
                  tabIndex={0}
                  className="rounded p-0.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                  title="Revert changes"
                  onClick={handleRevertClick}
                  onKeyDown={(e) =>
                    handleKeyActivate(e, () => setRevertOpen(true), { stopPropagation: true })
                  }
                >
                  <Undo2 className="size-3" />
                </div>
              )}
            </span>
          </span>
        </div>

        {/* Diff content */}
        {expanded && (
          <div className="border-t border-border">
            {loading && (
              <div className="flex items-center justify-center py-6">
                <PixelLoader size="sm" />
              </div>
            )}
            {!loading && tooLarge && (
              <div className="px-4 py-3 text-xs text-muted">
                {`File too large to display (${(file.insertions + file.deletions).toLocaleString()} lines changed)`}
              </div>
            )}
            {!loading && !tooLarge && !diffFile && loadedKeyRef.current !== null && (
              <div className="px-4 py-3 text-xs text-muted">No changes to display</div>
            )}
            {diffFile && (
              <div className={isNewFile ? "diff-new-file" : undefined}>
                <DiffView
                  diffFile={diffFile}
                  diffViewMode={4}
                  diffViewTheme={theme}
                  diffViewFontSize={12}
                  registerHighlighter={highlighter}
                  diffViewHighlight={true}
                  diffViewWrap={wrapLines}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={revertOpen}
        title="Revert changes"
        body={
          <>
            Are you sure you want to revert <strong>{file.path}</strong>? This cannot be undone.
          </>
        }
        confirmLabel="Revert"
        onConfirm={() => void handleRevert()}
        onClose={() => setRevertOpen(false)}
      />
    </>
  );
}
