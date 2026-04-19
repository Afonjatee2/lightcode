import { useMemo } from "react";
import type { GitBranchInfo } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useGitStore } from "@/renderer/state/gitStore";
import { useProject } from "@/renderer/state/useThread";

export function useBranchList(params: { projectId: string; search: string }) {
  const { projectId, search } = params;
  const branchData = useGitStore((s) => s.branches[projectId]);
  const worktrees = useGitStore((s) => s.worktrees[projectId]);
  const threads = useAppStore((s) => s.threads);
  const projectLocation = useProject(projectId)?.location;

  const activeWorktreeBranches = new Set(
    threads
      .filter((t) => t.projectId === projectId && !t.archived && t.worktreeBranch)
      .map((t) => t.worktreeBranch!),
  );
  const worktreeBranches = new Set(worktrees?.filter((w) => !w.isMain).map((w) => w.branch) ?? []);
  const branchWorktreePath = new Map(
    worktrees?.filter((w) => !w.isMain && w.branch).map((w) => [w.branch, w.path]) ?? [],
  );

  // Deduplicate: prefer local over remote with same name
  const allBranches = branchData?.branches ?? [];
  const seen = new Set<string>();
  const deduped: GitBranchInfo[] = [];
  for (const b of allBranches) {
    if (!b.isRemote && !seen.has(b.name)) {
      seen.add(b.name);
      deduped.push(b);
    }
  }
  for (const b of allBranches) {
    if (b.isRemote && !seen.has(b.name)) {
      seen.add(b.name);
      deduped.push(b);
    }
  }

  const filtered = search.trim()
    ? deduped.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()))
    : deduped;

  const allLocal = filtered.filter((b) => !b.isRemote);
  const allRemote = filtered.filter((b) => b.isRemote);
  const hasLocal = allLocal.length > 0;
  const hasRemote = allRemote.length > 0;

  const items = useMemo(() => {
    const list: (
      | { type: "header"; id: string; name: string }
      | { type: "branch"; id: string; branch: GitBranchInfo }
    )[] = [];
    if (hasLocal) {
      list.push({ type: "header", id: "header-local", name: "Local" });
      allLocal.forEach((b) => list.push({ type: "branch", id: b.name, branch: b }));
    }
    if (hasRemote) {
      list.push({ type: "header", id: "header-remote", name: "Remote" });
      allRemote.forEach((b) => list.push({ type: "branch", id: b.name, branch: b }));
    }
    return list;
  }, [allLocal, allRemote, hasLocal, hasRemote]);

  return {
    items,
    hasLocal,
    hasRemote,
    activeWorktreeBranches,
    worktreeBranches,
    branchWorktreePath,
    projectLocation,
  };
}

export type BranchListItem =
  | { type: "header"; id: string; name: string }
  | { type: "branch"; id: string; branch: GitBranchInfo };
