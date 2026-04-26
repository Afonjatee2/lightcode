import { useState } from "react";
import { ChevronDown, ChevronRight, GitMerge } from "lucide-react";
import { getBasename } from "@/shared/pathUtils";
import { useGitReviewRowPadX } from "../gitReviewPadXContext";

export function ConflictGroup(props: { files: string[] }) {
  const { files } = props;
  const rowPadX = useGitReviewRowPadX();
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <div
        className={`flex w-full items-center gap-1 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-warning ${rowPadX}`}
      >
        <button
          type="button"
          className="flex cursor-default items-center gap-1"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          Merge conflicts
          <span className="font-normal text-warning/60">({files.length})</span>
        </button>
      </div>
      {expanded && (
        <div className="space-y-px">
          {files.map((f) => {
            const basename = getBasename(f);
            const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : undefined;
            return (
              <div
                key={f}
                className={`flex w-full items-center gap-1.5 rounded py-1 text-xs text-muted ${rowPadX}`}
              >
                <GitMerge className="size-3.5 text-warning" />
                <span className="min-w-0 flex-1 truncate" title={f}>
                  <span className="text-foreground">{basename}</span>
                  {dir && <span className="ml-1 text-muted/60">{dir}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
