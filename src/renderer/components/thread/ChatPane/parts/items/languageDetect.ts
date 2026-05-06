/**
 * Language ids the tool-call viewport understands. `plain` skips highlighting
 * entirely; everything else maps to a Shiki bundled language and is rendered
 * via `CodeBlock`. Add more here when extending — `shikiClient` will load the
 * grammar on demand the first time it's used.
 */
export type ViewportLanguage =
  | "plain"
  | "json"
  | "jsonc"
  | "javascript"
  | "typescript"
  | "tsx"
  | "jsx"
  | "python"
  | "bash"
  | "shell"
  | "yaml"
  | "html"
  | "css"
  | "go"
  | "rust"
  | "markdown"
  | "sql"
  | "diff";

const EXT_TO_LANGUAGE: Record<string, ViewportLanguage> = {
  json: "json",
  jsonc: "jsonc",
  json5: "jsonc",
  geojson: "json",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  py: "python",
  pyw: "python",
  sh: "bash",
  bash: "bash",
  zsh: "shell",
  fish: "shell",
  yaml: "yaml",
  yml: "yaml",
  html: "html",
  htm: "html",
  css: "css",
  go: "go",
  rs: "rust",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  sql: "sql",
  diff: "diff",
  patch: "diff",
};

export function detectLanguageFromPath(path: string | undefined): ViewportLanguage {
  if (!path) return "plain";
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const base = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "plain";
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_TO_LANGUAGE[ext] ?? "plain";
}
