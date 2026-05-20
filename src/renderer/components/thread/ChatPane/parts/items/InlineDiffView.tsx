import { Component, useEffect, useState, type ReactNode } from "react";
import { DiffView, highlighter } from "@git-diff-view/react";
import type { DiffFile } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view.css";
import { normalizeDiffFilePath } from "@/shared/lineUnifiedDiff";
import {
  buildInWorker,
  diffFileFromBundle,
  extractDiffNames,
  getLang,
  useDiffTheme,
} from "@/renderer/views/GitReviewOverlay/parts/diffBuildClient";
import { CommandOutputViewport } from "./CommandOutputViewport";

const UNIFIED_MODE = 4;
/** Fall back to raw text for patches larger than ~100 KB. */
const MAX_DIFF_LENGTH = 100_000;

interface InlineDiffViewProps {
  diffText: string;
  filePath: string;
  /** When set (Cursor ACP content diffs), passed to git-diff-view for reliable rich rendering. */
  oldText?: string;
  newText?: string;
}

/**
 * Renders a unified diff string as a rich, syntax-highlighted diff view using
 * `@git-diff-view/react`. The heavy DiffFile parsing runs in a web worker to
 * keep the UI thread responsive. Falls back to Shiki-highlighted raw diff text
 * when the patch is too large or the worker build fails.
 */
export function InlineDiffView({ diffText, filePath, oldText, newText }: InlineDiffViewProps) {
  const displayPath = normalizeDiffFilePath(filePath);
  const theme = useDiffTheme();
  const [diffFile, setDiffFile] = useState<DiffFile | null>(null);
  const [state, setState] = useState<"building" | "ready" | "fallback">(
    diffText.length > MAX_DIFF_LENGTH ? "fallback" : "building",
  );

  useEffect(() => {
    if (diffText.length > MAX_DIFF_LENGTH) {
      setState("fallback");
      return;
    }
    let cancelled = false;
    setState("building");
    setDiffFile(null);

    const parsedNames = extractDiffNames(diffText);
    const oldName = parsedNames.oldName || (oldText === "" ? "/dev/null" : `a/${displayPath}`);
    const newName = parsedNames.newName || `b/${displayPath}`;
    const lang = getLang(newName || displayPath);

    void buildInWorker(
      [
        {
          key: displayPath,
          diff: diffText,
          oldName,
          newName,
          fileLang: lang,
          ...(oldText !== undefined && newText !== undefined
            ? { oldContent: oldText, newContent: newText }
            : {}),
        },
      ],
      theme,
    )
      .then((results) => {
        if (cancelled) return;
        const r = results[0];
        if (r?.bundle) {
          setDiffFile(diffFileFromBundle(r.data, r.bundle));
          setState("ready");
        } else {
          setState("fallback");
        }
      })
      .catch(() => {
        if (!cancelled) setState("fallback");
      });

    return () => {
      cancelled = true;
    };
  }, [diffText, displayPath, oldText, newText, theme]);

  if (state === "fallback") {
    return <CommandOutputViewport text={diffText} language="diff" />;
  }

  if (state === "building" || !diffFile) {
    return <div className="py-2 text-xs text-[color:var(--muted)]">Building diff…</div>;
  }

  return (
    <DiffViewErrorBoundary fallback={<CommandOutputViewport text={diffText} language="diff" />}>
      <div className="max-h-[min(24rem,50vh)] overflow-auto [scrollbar-gutter:stable]">
        <DiffView
          diffFile={diffFile}
          diffViewMode={UNIFIED_MODE}
          diffViewTheme={theme}
          diffViewFontSize={12}
          registerHighlighter={highlighter}
          diffViewHighlight={true}
          diffViewWrap={false}
        />
      </div>
    </DiffViewErrorBoundary>
  );
}

/** Catches render errors from DiffView (e.g. missing canvas in test envs). */
class DiffViewErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
