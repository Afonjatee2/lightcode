/** Normalize model / markdown paths to a project-relative POSIX path for the file editor. */
export function normalizeChatRelativePath(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  if (s.startsWith("file://")) {
    try {
      const u = new URL(s);
      s = u.pathname;
      if (s.startsWith("/") && /^\/[A-Za-z]:/.test(s)) s = s.slice(1);
      else s = s.replace(/^\//, "");
    } catch {
      /* keep */
    }
  }
  s = s.replace(/^\.\//, "").replace(/\\/g, "/");
  return s.replace(/\/+/g, "/").replace(/^\/+/, "");
}
