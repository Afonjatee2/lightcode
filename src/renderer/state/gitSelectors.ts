import { useShallow } from "zustand/shallow";
import type { GitFileChange, PrData } from "@/shared/contracts";
import { createArrayKeyedMap } from "./derivations";
import { useGitStore } from "./gitStore";

function buildPathMap(files: GitFileChange[]): Map<string, GitFileChange> {
  const map = new Map<string, GitFileChange>();
  for (const f of files) map.set(f.path, f);
  return map;
}

const getStagedFile = createArrayKeyedMap<GitFileChange, string, GitFileChange>(buildPathMap);
const getUnstagedFile = createArrayKeyedMap<GitFileChange, string, GitFileChange>(buildPathMap);

/**
 * `useShallow` isolates re-renders to rows whose own fields changed — siblings
 * whose entries didn't move in the array still see a stable shallow-equal value.
 */
export function useGitFile(
  storeKey: string,
  path: string,
  isWorktree: boolean,
): GitFileChange | undefined {
  return useGitStore(
    useShallow((s) => {
      const status = isWorktree ? s.worktreeStatuses[storeKey] : s.statuses[storeKey];
      if (!status) return undefined;
      return getStagedFile(status.staged, path) ?? getUnstagedFile(status.unstaged, path);
    }),
  );
}

type PrField<K extends keyof PrData> = PrData[K] | undefined;

function makePrFieldSelector<K extends keyof PrData>(field: K) {
  return function usePrField(key: string | undefined): PrField<K> {
    return useGitStore((s) => (key ? s.prData[key]?.[field] : undefined));
  };
}

export const usePrNumber = makePrFieldSelector("number");
export const usePrState = makePrFieldSelector("state");
export const usePrTitle = makePrFieldSelector("title");
export const usePrUrl = makePrFieldSelector("url");
export const usePrChecksStatus = makePrFieldSelector("checksStatus");

export function useHasPr(key: string | undefined): boolean {
  return useGitStore((s) => Boolean(key && s.prData[key]));
}

export function useSourceBranch(key: string | undefined): string | null | undefined {
  return useGitStore((s) => (key ? s.worktreeSourceInfo[key]?.sourceBranch : undefined));
}

export function useCommitsAhead(key: string | undefined): number {
  return useGitStore((s) => (key ? (s.worktreeSourceInfo[key]?.commitsAhead ?? 0) : 0));
}

export function useSourceAhead(key: string | undefined): number {
  return useGitStore((s) => (key ? (s.worktreeSourceInfo[key]?.sourceAhead ?? 0) : 0));
}
