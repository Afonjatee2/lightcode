import { useState } from "react";
import { ChevronDown, ChevronRight, FileEdit } from "lucide-react";
import type { GitFileChange, Project } from "@/shared/contracts";
import { FileIcon, FileStatusBadge, PathDisplay } from "@/renderer/components/common";
import { compareFilesByDirThenName, openFileInEditor } from "@/renderer/utils/gitHelpers";
import { handleKeyActivate } from "@/renderer/utils/a11y";
import { useGitReviewRowPadX } from "../gitReviewPadXContext";
import { ConflictFileCard } from "./ConflictFileCard";

export function ConflictGroup(props: {
  files: GitFileChange[];
  project: Project;
  selectedFile: string | null;
  worktreePath: string | undefined;
  worktreeBranch: string | undefined;
  onSelectFile: (path: string, staged: boolean) => void;
  mode?: "overlay" | "panel";
  diffTheme?: "light" | "dark";
  wrapLines?: boolean;
}) {
  const {
    files,
    project,
    selectedFile,
    worktreePath,
    worktreeBranch,
    onSelectFile,
    mode,
    diffTheme,
    wrapLines,
  } = props;
  const rowPadX = useGitReviewRowPadX();
  const [expanded, setExpanded] = useState(true);
  const inlineDiffs = mode === "panel";

  const handleOpenInEditor = (path: string) =>
    openFileInEditor(project, worktreePath, worktreeBranch, path);

  const sorted = files.toSorted(compareFilesByDirThenName);

  const totalInsertions = files.reduce((s, f) => s + f.insertions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div>
      <div
        className={`flex w-full items-center gap-1 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted ${rowPadX}`}
      >
        <button
          type="button"
          className="flex cursor-default items-center gap-1"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          Conflicts
          <span className="font-normal text-muted/60">({files.length})</span>
        </button>
        <span className="ml-auto mr-1.5 flex items-center gap-0.5 text-[10px] leading-4 font-medium font-normal">
          {totalInsertions > 0 && <span className="text-success">+{totalInsertions}</span>}
          {totalDeletions > 0 && <span className="text-danger">-{totalDeletions}</span>}
        </span>
      </div>
      {expanded && inlineDiffs && (
        <div className="min-w-0 divide-y divide-border">
          {sorted.map((file) => (
            <ConflictFileCard
              key={file.path}
              file={file}
              project={project}
              worktreePath={worktreePath}
              worktreeBranch={worktreeBranch}
              theme={diffTheme ?? "dark"}
              wrapLines={wrapLines ?? false}
            />
          ))}
        </div>
      )}
      {expanded && !inlineDiffs && (
        <div className="space-y-px">
          {sorted.map((file) => {
            const isSelected = selectedFile === file.path;
            return (
              <button
                key={file.path}
                type="button"
                className={`group flex w-full cursor-default items-center gap-1.5 rounded py-1 text-left text-xs transition-colors ${rowPadX} ${
                  isSelected
                    ? "bg-white/[0.08] text-foreground"
                    : "text-muted hover:bg-white/[0.04] hover:text-foreground"
                }`}
                onClick={() => onSelectFile(file.path, false)}
              >
                <FileIcon path={file.path} />
                <PathDisplay
                  path={file.path}
                  className="flex-1"
                  trailing={<FileStatusBadge status={file.status} />}
                />
                <span className="relative w-14 shrink-0">
                  <span className="flex items-center justify-end text-[10px] leading-4 font-medium transition-opacity group-hover:opacity-0">
                    {file.insertions > 0 && (
                      <span className="text-success">+{file.insertions}</span>
                    )}
                    {file.deletions > 0 && (
                      <span className="ml-0.5 text-danger">-{file.deletions}</span>
                    )}
                  </span>
                  <span className="absolute inset-0 flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <div
                      role="button"
                      tabIndex={0}
                      className="rounded p-0.5 text-muted transition-colors hover:bg-white/[0.04] hover:text-foreground"
                      title="Open in editor"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleOpenInEditor(file.path);
                      }}
                      onKeyDown={(e) =>
                        handleKeyActivate(e, () => void handleOpenInEditor(file.path), {
                          stopPropagation: true,
                        })
                      }
                    >
                      <FileEdit className="size-3" />
                    </div>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
