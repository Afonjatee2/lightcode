import { useState } from "react";
import { Lock, Minus, Plus, Undo2 } from "lucide-react";
import type { Project } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { useGitStore } from "@/renderer/state/gitStore";
import { useGitFile } from "@/renderer/state/gitSelectors";
import { isLockFile } from "@/shared/gitUtils";
import { getBasename } from "@/shared/pathUtils";
import { ConfirmDialog, FileIcon, FileStatusBadge } from "@/renderer/components/common";
import { handleKeyActivate } from "@/renderer/utils/a11y";
import { useGitReviewRowPadX } from "../gitReviewPadXContext";

export function FileRow(props: {
  path: string;
  project: Project;
  isSelected: boolean;
  onSelect: () => void;
  onRefresh: () => void;
  storeKey: string;
  isWorktree: boolean;
}) {
  const { path, project, isSelected, onSelect, onRefresh, storeKey, isWorktree } = props;
  const rowPadX = useGitReviewRowPadX();
  const file = useGitFile(storeKey, path, isWorktree);
  const [revertOpen, setRevertOpen] = useState(false);

  if (!file) return null;

  const basename = getBasename(path);
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined;

  async function handleStageToggle() {
    if (!file) return;
    const store = useGitStore.getState();
    if (file.staged) {
      store.optimisticUnstageFile(storeKey, path, isWorktree);
      await readBridge()
        .gitUnstage({ projectLocation: project.location, filePath: path })
        .catch(() => onRefresh());
    } else {
      store.optimisticStageFile(storeKey, path, isWorktree);
      await readBridge()
        .gitStage({ projectLocation: project.location, filePath: path })
        .catch(() => onRefresh());
    }
  }

  async function handleRevert() {
    await readBridge().gitRevert({
      projectLocation: project.location,
      filePath: path,
    });
    setRevertOpen(false);
    onRefresh();
  }

  return (
    <>
      <button
        type="button"
        className={`group flex w-full cursor-default items-center gap-1.5 rounded py-1 text-left text-xs transition-colors ${rowPadX} ${
          isSelected
            ? "bg-white/[0.08] text-foreground"
            : "text-muted hover:bg-white/[0.04] hover:text-foreground"
        }`}
        onClick={onSelect}
      >
        <FileIcon path={path} />
        <span className="min-w-0 flex-1 truncate" title={path}>
          <span className="text-foreground">{basename}</span>
          {isLockFile(path) && <Lock className="ml-1 inline-block size-2 text-muted/40" />}
          {dir && <span className="ml-1 text-muted/60">{dir}</span>}
          <FileStatusBadge status={file.status} />
        </span>
        <span className="relative w-14 shrink-0">
          <span className="flex items-center justify-end text-[10px] leading-4 font-medium transition-opacity group-hover:opacity-0">
            {file.insertions > 0 && <span className="text-success">+{file.insertions}</span>}
            {file.deletions > 0 && <span className="ml-0.5 text-danger">-{file.deletions}</span>}
          </span>
          <span className="absolute inset-0 flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <div
              role="button"
              tabIndex={0}
              className="rounded p-0.5 text-muted transition-colors hover:bg-white/[0.04] hover:text-foreground"
              title={file.staged ? "Unstage" : "Stage"}
              onClick={(e) => {
                e.stopPropagation();
                void handleStageToggle();
              }}
              onKeyDown={(e) =>
                handleKeyActivate(e, () => void handleStageToggle(), { stopPropagation: true })
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
                onClick={(e) => {
                  e.stopPropagation();
                  setRevertOpen(true);
                }}
                onKeyDown={(e) =>
                  handleKeyActivate(e, () => setRevertOpen(true), { stopPropagation: true })
                }
              >
                <Undo2 className="size-3" />
              </div>
            )}
          </span>
        </span>
      </button>

      <ConfirmDialog
        isOpen={revertOpen}
        title="Revert changes"
        body={
          <>
            Are you sure you want to revert <strong>{path}</strong>? This cannot be undone.
          </>
        }
        confirmLabel="Revert"
        onConfirm={() => void handleRevert()}
        onClose={() => setRevertOpen(false)}
      />
    </>
  );
}
