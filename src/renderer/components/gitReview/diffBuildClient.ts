import { DiffFile, highlighter, getLang } from "@git-diff-view/react";
import type {
  DiffBuildItem,
  DiffBuildRequest,
  DiffBuildResponse,
} from "../../workers/diffBuildWorker";
import { useSharedSettings } from "../../state/sharedSettingsStore";

export type { DiffBuildItem };
export type DiffBuildResult = DiffBuildResponse["results"][number];

// ── Worker singleton ─────────────────────────────────────────

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (results: DiffBuildResponse["results"]) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../../workers/diffBuildWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<DiffBuildResponse>) => {
      const resolve = pending.get(e.data.id);
      if (resolve) {
        pending.delete(e.data.id);
        resolve(e.data.results);
      }
    };
  }
  return worker;
}

export function buildInWorker(
  items: DiffBuildItem[],
  theme?: "light" | "dark",
): Promise<DiffBuildResponse["results"]> {
  // Fallback to main-thread building when Worker is unavailable (e.g. tests)
  if (typeof Worker === "undefined") {
    return Promise.resolve(
      items.map((item) => {
        const data = {
          newFile: {
            fileName: item.newName,
            fileLang: item.fileLang,
            content: item.newContent ?? null,
          },
          hunks: [item.diff],
        };
        if (!item.diff.trim()) return { key: item.key, data, bundle: null };
        try {
          const instance = DiffFile.createInstance({
            oldFile: {
              fileName: item.oldName,
              fileLang: item.fileLang,
              content: item.oldContent ?? null,
            },
            ...data,
          });
          instance.initTheme(theme ?? "dark");
          instance.initRaw();
          instance.initSyntax({ registerHighlighter: highlighter });
          instance.buildSplitDiffLines();
          instance.buildUnifiedDiffLines();
          const bundle = instance._getFullBundle();
          instance.clear();
          return { key: item.key, data, bundle };
        } catch {
          return { key: item.key, data, bundle: null };
        }
      }),
    );
  }
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    getWorker().postMessage({ id, items, theme: theme ?? "dark" } satisfies DiffBuildRequest);
  });
}

/** Reconstruct a DiffFile on the main thread from a worker-built full bundle. No parsing. */
export function diffFileFromBundle(
  data: DiffBuildResult["data"],
  bundle: ReturnType<DiffFile["_getFullBundle"]>,
): DiffFile {
  return DiffFile.createInstance(data, bundle);
}

// ── Helpers ──────────────────────────────────────────────────

export function useDiffTheme(): "light" | "dark" {
  const themeMode = useSharedSettings((s) => s.themeMode);
  if (themeMode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return themeMode;
}

export function extractDiffNames(raw: string): { oldName: string; newName: string } {
  let oldName = "";
  let newName = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("--- ")) {
      oldName = line.slice(4).replace(/^a\//, "");
    } else if (line.startsWith("+++ ")) {
      newName = line.slice(4).replace(/^b\//, "");
      break;
    }
  }
  return { oldName, newName };
}

export { getLang };
