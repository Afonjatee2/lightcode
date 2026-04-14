import { useEffect, useRef, useState } from "react";
import { DiffFile, DiffView, highlighter, setEnableFastDiffTemplate } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view.css";

setEnableFastDiffTemplate(true);

import { AlertDialog, Button, Spinner } from "@heroui/react";
import {
  ChevronDown,
  ChevronRight,
  FileDiff,
  FileMinus2,
  FilePlus2,
  Lock,
  Minus,
  Plus,
  Undo2,
} from "lucide-react";
import type { GitFileChange, Project } from "../../../shared/contracts";
import { isLockFile } from "../../../shared/gitUtils";
import { readBridge } from "../../bridge";
import {
  buildInWorker,
  diffFileFromBundle,
  extractDiffNames,
  getLang,
} from "./diffBuildClient";

// ── Helpers ──────────────────────────────────────────────────

const LARGE_DIFF_THRESHOLD = 500;

function FileStatusIcon(props: { status: string }) {
  const cls = "size-3.5 shrink-0";
  switch (props.status) {
    case "A":
    case "?":
      return <FilePlus2 className={`${cls} text-success`} />;
    case "D":
      return <FileMinus2 className={`${cls} text-danger`} />;
    default:
      return <FileDiff className={`${cls} text-warning`} />;
  }
}

// ── Single file card ─────────────────────────────────────────

export function StackedFileCard(props: {
  file: GitFileChange;
  project: Project;
  theme: "light" | "dark";
  wrapLines: boolean;
  onRefresh: () => void;
}) {
  const { file, project, theme, wrapLines, onRefresh } = props;
  const [expanded, setExpanded] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);

  // Diff state — only loaded when first expanded
  const [diffFile, setDiffFile] = useState<DiffFile | null>(null);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);
  const tooLarge = file.insertions + file.deletions > LARGE_DIFF_THRESHOLD;

  const basename = file.path.split(/[\\/]/).pop() ?? file.path;
  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : undefined;

  // Lazy-load diff on first expand
  useEffect(() => {
    if (!expanded || loadedRef.current || tooLarge) return;
    loadedRef.current = true;
    let cancelled = false;

    setLoading(true);

    async function load() {
      try {
        const result = await readBridge().getGitDiff({
          projectLocation: project.location,
          filePath: file.path,
          staged: file.staged,
        });
        if (cancelled) return;

        const rawDiff = result.diff;
        if (!rawDiff.trim()) {
          setLoading(false);
          return;
        }

        const { oldName, newName } = extractDiffNames(rawDiff);
        const fileLang = getLang(newName || file.path);

        const { oldContent, newContent } = await readBridge().getGitFileContent({
          projectLocation: project.location,
          filePath: file.path,
          staged: file.staged,
        });
        if (cancelled) return;

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
  }, [expanded, tooLarge, file.path, file.staged, project.location, theme]);

  async function handleStageToggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (file.staged) {
      await readBridge().gitUnstage({ projectLocation: project.location, filePath: file.path });
    } else {
      await readBridge().gitStage({ projectLocation: project.location, filePath: file.path });
    }
    onRefresh();
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

  const isNewFile =
    file.deletions === 0 && file.status !== "M" && file.status !== "D";

  return (
    <>
      <div className="rounded border border-border">
        {/* File header */}
        <div
          role="button"
          tabIndex={0}
          className="group flex cursor-pointer select-none items-center gap-1.5 px-2 py-1 text-xs transition-colors hover:bg-white/[0.04]"
          onClick={() => setExpanded((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setExpanded((v) => !v);
            }
          }}
        >
          {expanded ? (
            <ChevronDown className="size-3 shrink-0 text-muted" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-muted" />
          )}
          <FileStatusIcon status={file.status} />
          <span className="min-w-0 flex-1 truncate" title={file.path}>
            <span className="font-medium text-foreground">{basename}</span>
            {isLockFile(file.path) && (
              <Lock className="ml-1 inline-block size-2 text-muted/40" />
            )}
            {dir && <span className="ml-1 text-muted/60">{dir}</span>}
          </span>

          <span className="relative w-14 shrink-0">
            {/* Stats — visible when not hovering */}
            <span className="flex items-center justify-end text-[10px] font-medium transition-opacity group-hover:opacity-0">
              {file.insertions > 0 && <span className="text-success">+{file.insertions}</span>}
              {file.deletions > 0 && (
                <span className="ml-0.5 text-danger">-{file.deletions}</span>
              )}
            </span>
            {/* Action buttons — visible on hover */}
            <span className="absolute inset-0 flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <div
                role="button"
                tabIndex={0}
                className="rounded p-0.5 text-muted transition-colors hover:bg-white/[0.04] hover:text-foreground"
                title={file.staged ? "Unstage" : "Stage"}
                onClick={handleStageToggle}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    void handleStageToggle(e as unknown as React.MouseEvent);
                  }
                }}
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      setRevertOpen(true);
                    }
                  }}
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
                <Spinner size="sm" />
              </div>
            )}
            {!loading && tooLarge && (
              <div className="px-4 py-3 text-xs text-muted">
                {`File too large to display (${(file.insertions + file.deletions).toLocaleString()} lines changed)`}
              </div>
            )}
            {!loading && !tooLarge && !diffFile && loadedRef.current && (
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

      <AlertDialog.Backdrop isOpen={revertOpen} onOpenChange={setRevertOpen}>
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Revert changes</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              Are you sure you want to revert <strong>{file.path}</strong>? This cannot be undone.
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Cancel
              </Button>
              <Button variant="danger" onPress={() => void handleRevert()}>
                Revert
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}
