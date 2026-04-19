import {
  type GitFinishMergeResult,
  type GitMergeToSourceResult,
  type GitPullFromSourceResult,
  type GitRunMergetoolResult,
  type ProjectLocation,
} from "@/shared/contracts";
import { errorDetail, msg } from "@/shared/messages";
import {
  computeDefaultWorktreePath,
  ensureWorktreeParentExists,
  execGit,
  GIT_STATUS_TIMEOUT,
  getRepoPath,
} from "./exec";
import { parseStatusPorcelainV2 } from "./statusService";
import { GitWorktreeService } from "./worktreeService";

export class GitMergeService {
  constructor(private readonly worktreeService: GitWorktreeService) {}

  async mergeToSource(
    repoLocation: ProjectLocation,
    _worktreeLocation: ProjectLocation,
    worktreeBranch: string,
    sourceBranch: string,
  ): Promise<GitMergeToSourceResult> {
    let canFastForward = false;
    try {
      await execGit(repoLocation, ["merge-base", "--is-ancestor", sourceBranch, worktreeBranch]);
      canFastForward = true;
    } catch {
      // not an ancestor
    }

    if (canFastForward) {
      const sourceLocation = await this.findWorktreeForBranch(repoLocation, sourceBranch);
      if (sourceLocation) {
        await execGit(sourceLocation, ["merge", "--ff-only", worktreeBranch]);
        const newCommit = (await execGit(sourceLocation, ["rev-parse", "HEAD"])).trim();
        return { merged: true, fastForward: true, newSourceCommit: newCommit };
      }

      const worktreeTip = (await execGit(repoLocation, ["rev-parse", worktreeBranch])).trim();
      await execGit(repoLocation, ["update-ref", `refs/heads/${sourceBranch}`, worktreeTip]);
      return { merged: true, fastForward: true, newSourceCommit: worktreeTip };
    }

    const sourceLocation = await this.findWorktreeForBranch(repoLocation, sourceBranch);
    if (sourceLocation) {
      try {
        await this.ensureWorktreeCleanForMerge(sourceLocation, sourceBranch);
        return await this.mergeBranchIntoSourceLocation(sourceLocation, worktreeBranch);
      } catch (error) {
        return {
          merged: false,
          fastForward: false,
          newSourceCommit: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const tempBranchDir = `_merge-temp-${Date.now()}`;
    const tempPath = await computeDefaultWorktreePath(repoLocation, tempBranchDir);
    try {
      await ensureWorktreeParentExists(repoLocation, tempPath);
      await execGit(repoLocation, ["worktree", "add", tempPath, sourceBranch]);
      const tempLocation: ProjectLocation =
        repoLocation.kind === "wsl"
          ? { ...repoLocation, linuxPath: tempPath, uncPath: tempPath }
          : { ...repoLocation, path: tempPath };
      return await this.mergeBranchIntoSourceLocation(tempLocation, worktreeBranch);
    } catch (error: unknown) {
      return {
        merged: false,
        fastForward: false,
        newSourceCommit: "",
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await execGit(repoLocation, ["worktree", "remove", "--force", tempPath]).catch(
        () => undefined,
      );
    }
  }

  async pullFromSource(
    worktreeLocation: ProjectLocation,
    sourceBranch: string,
  ): Promise<GitPullFromSourceResult> {
    let canFastForward = false;
    try {
      await execGit(worktreeLocation, ["merge-base", "--is-ancestor", "HEAD", sourceBranch]);
      canFastForward = true;
    } catch {
      // not an ancestor
    }

    if (canFastForward) {
      try {
        await execGit(worktreeLocation, ["merge", "--ff-only", sourceBranch]);
        return { merged: true, fastForward: true };
      } catch (error: unknown) {
        return {
          merged: false,
          fastForward: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    try {
      await execGit(worktreeLocation, ["merge", sourceBranch, "--no-ff", "--no-edit"]);
    } catch (mergeError: unknown) {
      const detail = errorDetail(mergeError);
      if (detail.includes("CONFLICT") || detail.includes("Merge conflict")) {
        const conflictFiles: string[] = [];
        for (const match of detail.matchAll(/CONFLICT.*?:\s*(?:Merge conflict in\s+)?(.+)/g)) {
          if (match[1]) conflictFiles.push(match[1].trim());
        }
        return {
          merged: false,
          fastForward: false,
          conflicting: true,
          error: msg("git.merge.conflicts"),
          conflictFiles,
        };
      }
      return {
        merged: false,
        fastForward: false,
        error: detail,
      };
    }

    return { merged: true, fastForward: false };
  }

  async abortMerge(worktreeLocation: ProjectLocation): Promise<void> {
    await execGit(worktreeLocation, ["merge", "--abort"]);
  }

  async finishMerge(worktreeLocation: ProjectLocation): Promise<GitFinishMergeResult> {
    try {
      await execGit(worktreeLocation, ["commit", "--no-edit"]);
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: errorDetail(error) };
    }
  }

  async runMergetool(worktreeLocation: ProjectLocation): Promise<GitRunMergetoolResult> {
    try {
      await execGit(worktreeLocation, ["mergetool", "--no-prompt"]);
      const statusOutput = await execGit(worktreeLocation, ["status", "--porcelain=v2", "-b"], {
        timeout: GIT_STATUS_TIMEOUT,
      });
      const parsed = parseStatusPorcelainV2(statusOutput);
      if (parsed.conflictFiles.length > 0) {
        return { success: true, merged: false };
      }
      await execGit(worktreeLocation, ["commit", "--no-edit"]);
      return { success: true, merged: true };
    } catch (error: unknown) {
      return { success: false, error: errorDetail(error) };
    }
  }

  private async findWorktreeForBranch(
    repoLocation: ProjectLocation,
    branch: string,
  ): Promise<ProjectLocation | null> {
    const { worktrees } = await this.worktreeService.listWorktrees(repoLocation);
    const match = worktrees.find((worktree) => worktree.branch === branch);
    if (!match) return null;
    if (repoLocation.kind === "wsl") {
      return { ...repoLocation, linuxPath: match.path, uncPath: match.path };
    }
    return { ...repoLocation, path: match.path };
  }

  private async ensureWorktreeCleanForMerge(
    location: ProjectLocation,
    sourceBranch: string,
  ): Promise<void> {
    const status = await execGit(location, ["status", "--porcelain"]);
    if (!status.trim()) return;
    throw new Error(
      msg("git.worktree.dirtySource", { branch: sourceBranch, path: getRepoPath(location) }),
    );
  }

  private async mergeBranchIntoSourceLocation(
    location: ProjectLocation,
    worktreeBranch: string,
  ): Promise<GitMergeToSourceResult> {
    try {
      await execGit(location, ["merge", worktreeBranch, "--no-edit", "--no-ff"]);
    } catch (mergeError: unknown) {
      const detail = errorDetail(mergeError);
      if (detail.includes("CONFLICT") || detail.includes("Merge conflict")) {
        const conflictFiles: string[] = [];
        for (const match of detail.matchAll(/CONFLICT.*?:\s*(?:Merge conflict in\s+)?(.+)/g)) {
          if (match[1]) conflictFiles.push(match[1].trim());
        }
        await execGit(location, ["merge", "--abort"]).catch(() => undefined);
        return {
          merged: false,
          fastForward: false,
          newSourceCommit: "",
          error: msg("git.merge.conflicts"),
          conflictFiles,
        };
      }
      throw mergeError;
    }

    const newCommit = (await execGit(location, ["rev-parse", "HEAD"])).trim();
    return { merged: true, fastForward: false, newSourceCommit: newCommit };
  }
}
