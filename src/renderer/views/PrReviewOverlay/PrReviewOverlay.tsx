import { useEffect, useState } from "react";
import { ArrowLeft, Columns2, ExternalLink, RefreshCw, Rows2 } from "lucide-react";
import { Link, toast } from "@heroui/react";
import type { Project, ProjectLocation } from "@/shared/contracts";
import { friendlyError } from "@/shared/messages";
import { readBridge } from "@/renderer/bridge";
import { useGitStore } from "@/renderer/state/gitStore";
import { PageLayout } from "@/renderer/components/layout/PageLayout";
import { usePrTitle, usePrUrl, usePrViewerDidAuthor } from "@/renderer/state/gitSelectors";
import { PrReviewSidebar } from "./parts/PrReviewSidebar";
import { PrDiffContent } from "./parts/PrDiffContent";
import { SubmitReviewPopover } from "./parts/SubmitReviewPopover";

const DIFF_MODE = { Split: 1, Unified: 4 } as const;

export function PrReviewOverlay(props: {
  project: Project;
  prNumber: number;
  locationOverride?: ProjectLocation;
  worktreePath?: string | undefined;
  /** PR key used for selectors (matches PrSection: worktreePath ?? `__branch:${projectId}`). */
  prKey: string;
  onClose: () => void;
}) {
  const { project, prNumber, locationOverride, worktreePath, prKey, onClose } = props;
  const effectiveLocation = locationOverride ?? project.location;
  const cacheKey = `${project.id}#${prNumber}`;

  const files = useGitStore((s) => s.prFiles[cacheKey]);
  const rawDiff = useGitStore((s) => s.prDiffs[cacheKey]);
  const prTitle = usePrTitle(prKey);
  const prUrl = usePrUrl(prKey);
  const viewerDidAuthor = usePrViewerDidAuthor(prKey);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<number>(DIFF_MODE.Split);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [filesRes, diffRes] = await Promise.all([
        readBridge().ghGetPrFiles({ projectLocation: effectiveLocation, prNumber }),
        readBridge().ghGetPrDiff({ projectLocation: effectiveLocation, prNumber }),
      ]);
      useGitStore.getState().setPrFiles(cacheKey, filesRes.files);
      useGitStore.getState().setPrDiff(cacheKey, diffRes.diff);
    } catch (err) {
      toast.danger(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSelectedFile(null);
    const store = useGitStore.getState();
    if (!store.prFiles[cacheKey] || store.prDiffs[cacheKey] === undefined) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload/reset only when switching PR cache keys
  }, [cacheKey]);

  return (
    <PageLayout
      title="PR Review"
      contentHeaderChildren={
        <>
          <div className="lightcode-overlay-header__controls flex min-w-0 shrink items-center gap-2 pl-1.5">
            <span className="shrink-0 font-mono text-[13px] font-medium tracking-tight text-muted">
              #{prNumber}
            </span>
            {prTitle && (
              <span className="min-w-0 truncate text-xs text-muted" title={prTitle}>
                {prTitle}
              </span>
            )}
            {prUrl && (
              <Link
                aria-label="Open PR on GitHub"
                className="shrink-0 text-muted hover:text-foreground"
                onPress={() => void readBridge().openExternal(prUrl)}
              >
                <ExternalLink className="size-3.5" />
              </Link>
            )}
          </div>
          {selectedFile && (
            <div className="lightcode-overlay-header__controls flex items-center gap-3">
              <button
                type="button"
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted hover:text-foreground"
                onClick={() => setSelectedFile(null)}
              >
                <ArrowLeft className="size-3" />
                All files
              </button>
              <span className="min-w-0 truncate text-xs font-medium text-foreground">
                {selectedFile}
              </span>
            </div>
          )}

          <div className="flex-1" />

          <div className="lightcode-overlay-header__controls flex items-center gap-1">
            <button
              type="button"
              className="rounded p-1 text-muted hover:text-foreground"
              title="Split view"
              onClick={() => setDiffMode(DIFF_MODE.Split)}
            >
              <Columns2
                className={`size-4 ${diffMode === DIFF_MODE.Split ? "text-foreground" : ""}`}
              />
            </button>
            <button
              type="button"
              className="rounded p-1 text-muted hover:text-foreground"
              title="Unified view"
              onClick={() => setDiffMode(DIFF_MODE.Unified)}
            >
              <Rows2
                className={`size-4 ${diffMode === DIFF_MODE.Unified ? "text-foreground" : ""}`}
              />
            </button>
            <button
              type="button"
              className="rounded p-1 text-muted hover:text-foreground"
              title="Refresh"
              onClick={() => void load()}
            >
              <RefreshCw className="size-4" />
            </button>
            <SubmitReviewPopover
              projectLocation={effectiveLocation}
              prNumber={prNumber}
              hidden={viewerDidAuthor === true}
              onSubmitted={onClose}
            />
          </div>
        </>
      }
      sidebar={
        <PrReviewSidebar
          files={files ?? []}
          selectedFile={selectedFile}
          loading={loading}
          projectId={project.id}
          projectLocation={effectiveLocation}
          prKey={prKey}
          worktreePath={worktreePath}
          onSelectFile={(path) => setSelectedFile((curr) => (curr === path ? null : path))}
          onClose={onClose}
          onRefresh={() => void load()}
        />
      }
      content={
        <PrDiffContent
          files={files ?? []}
          rawDiff={rawDiff ?? ""}
          selectedFile={selectedFile}
          diffMode={diffMode}
          loading={loading}
        />
      }
    />
  );
}
