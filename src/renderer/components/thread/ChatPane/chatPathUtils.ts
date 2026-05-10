import type { ProjectLocation } from "@/shared/contracts";

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

export function normalizeChatProjectPath(raw: string, projectLocation: ProjectLocation): string {
  const normalized = normalizeChatRelativePath(raw);
  const projectRoots = getProjectRoots(projectLocation).map(normalizeChatRelativePath);
  const root = projectRoots.find((candidate) => pathStartsWithRoot(normalized, candidate));
  if (!root) return normalized;
  return normalized.slice(root.length).replace(/^\/+/, "");
}

function getProjectRoots(projectLocation: ProjectLocation): string[] {
  switch (projectLocation.kind) {
    case "windows":
      return [projectLocation.path];
    case "wsl":
      return [projectLocation.linuxPath, projectLocation.uncPath];
    case "posix":
      return [projectLocation.path];
  }
}

function pathStartsWithRoot(path: string, root: string): boolean {
  const normalizedRoot = root.replace(/\/+$/, "");
  if (!normalizedRoot) return false;
  const lcPath = path.toLowerCase();
  const lcRoot = normalizedRoot.toLowerCase();
  if (path.length === normalizedRoot.length) return lcPath === lcRoot;
  return lcPath.startsWith(`${lcRoot}/`) || path.startsWith(`${normalizedRoot}/`);
}
