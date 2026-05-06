import type { BundledLanguage, Highlighter, ShikiTransformer } from "shiki";

/**
 * Languages eagerly registered when the highlighter is created. These cover
 * what we typically see in tool-call args / file_change bodies. Anything
 * outside this set is loaded on demand via `ensureLanguage()`.
 */
const INITIAL_LANGS: BundledLanguage[] = [
  "json",
  "jsonc",
  "javascript",
  "typescript",
  "tsx",
  "jsx",
  "python",
  "bash",
  "shell",
  "yaml",
  "html",
  "css",
  "go",
  "rust",
  "markdown",
  "sql",
  "diff",
];

export const SHIKI_THEMES = ["github-light", "github-dark"] as const;
export type ShikiTheme = (typeof SHIKI_THEMES)[number];

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>(INITIAL_LANGS);
const failedLangs = new Set<string>();

/**
 * Lazy-create the singleton Shiki highlighter. Done via dynamic import so
 * Shiki's grammars / WASM stay out of the renderer's initial chunk and only
 * load the first time a tool-call body needs syntax highlighting.
 */
export function getShikiHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const { createHighlighter } = await import("shiki");
      return createHighlighter({
        themes: [...SHIKI_THEMES],
        langs: INITIAL_LANGS,
      });
    })();
  }
  return highlighterPromise;
}

/**
 * Ensure `lang` is registered with the singleton highlighter, loading it on
 * demand. Returns `false` for unknown / non-bundled languages so callers can
 * fall back to plain rendering.
 */
export async function ensureLanguage(lang: string): Promise<boolean> {
  if (loadedLangs.has(lang)) return true;
  if (failedLangs.has(lang)) return false;
  const highlighter = await getShikiHighlighter();
  try {
    await highlighter.loadLanguage(lang as BundledLanguage);
    loadedLangs.add(lang);
    return true;
  } catch {
    failedLangs.add(lang);
    return false;
  }
}

/** Strip the theme-provided `background-color` from the `<pre>` so the host surface shows through. */
export const transparentBgTransformer: ShikiTransformer = {
  name: "lc-transparent-bg",
  pre(node) {
    const style = String(node.properties.style ?? "");
    const next = style.replace(/background-color\s*:[^;]+;?/g, "").trim();
    if (next.length > 0) node.properties.style = next;
    else delete node.properties.style;
  },
};
