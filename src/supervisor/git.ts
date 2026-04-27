import type {
  GitAddWorktreeResult,
  GitBranchListResult,
  GitDiffBatchResult,
  GitDiffResult,
  GitFileContentResult,
  GitFinishMergeResult,
  GitGetWorktreeSourceBranchResult,
  GitMergeToSourceResult,
  GitPullFromSourceResult,
  GitStatusResult,
  GitSwitchBranchResult,
  GitWorktreeListResult,
  ProjectLocation,
} from "@/shared/contracts";
import {
  computeDefaultWorktreePath,
  execGit,
  getLocationIdentity,
  parseRemoteUrl,
} from "./git/exec";
import { GitMergeService } from "./git/mergeService";
import { GitStatusService, parseStatusPorcelainV2 } from "./git/statusService";
import { GitWorktreeService } from "./git/worktreeService";

export {
  computeDefaultWorktreePath,
  execGit,
  getLocationIdentity,
  parseRemoteUrl,
  parseStatusPorcelainV2,
};

export class GitService {
  private readonly statusService = new GitStatusService();
  private readonly worktreeService = new GitWorktreeService();
  private readonly mergeService = new GitMergeService(this.worktreeService);

  async getStatus(location: ProjectLocation): Promise<GitStatusResult> {
    return this.statusService.getStatus(location);
  }

  async getDiff(
    location: ProjectLocation,
    filePath?: string,
    staged?: boolean,
  ): Promise<GitDiffResult> {
    return this.statusService.getDiff(location, filePath, staged);
  }

  async stage(location: ProjectLocation, filePath: string): Promise<void> {
    await execGit(location, ["add", "--", filePath]);
  }

  async unstage(location: ProjectLocation, filePath: string): Promise<void> {
    await execGit(location, ["reset", "HEAD", "--", filePath]);
  }

  async revert(location: ProjectLocation, filePath: string): Promise<void> {
    const statusOutput = await execGit(location, ["status", "--porcelain=v2", "--", filePath]);
    const parsed = parseStatusPorcelainV2(statusOutput);
    const unstagedEntry = parsed.unstaged.find(
      (entry) => entry.path === filePath.replace(/\\/g, "/"),
    );
    if (unstagedEntry?.status === "?") {
      await execGit(location, ["clean", "-f", "--", filePath]);
      return;
    }
    if (unstagedEntry?.status === "R" && unstagedEntry.oldPath) {
      await execGit(location, ["clean", "-f", "--", filePath]);
      await execGit(location, ["checkout", "--", unstagedEntry.oldPath]);
      return;
    }
    await execGit(location, ["checkout", "--", filePath]);
  }

  async getDiffBatch(
    location: ProjectLocation,
    untrackedPaths: string[],
  ): Promise<GitDiffBatchResult> {
    return this.statusService.getDiffBatch(location, untrackedPaths);
  }

  async getFileContent(
    location: ProjectLocation,
    filePath: string,
    staged: boolean,
  ): Promise<GitFileContentResult> {
    return this.statusService.getFileContent(location, filePath, staged);
  }

  async stageAll(location: ProjectLocation): Promise<void> {
    await execGit(location, ["add", "."]);
  }

  async unstageAll(location: ProjectLocation): Promise<void> {
    await execGit(location, ["reset", "HEAD"]);
  }

  async revertAll(location: ProjectLocation): Promise<void> {
    await execGit(location, ["checkout", "--", "."]);
    await execGit(location, ["clean", "-fd"]);
  }

  async commit(
    location: ProjectLocation,
    message: string,
    addAll: boolean,
  ): Promise<{ hash: string }> {
    if (addAll) {
      await execGit(location, ["add", "."]);
    }
    const output = await execGit(location, ["commit", "-m", message]);
    const hashMatch = output.match(/\[.+?\s+([a-f0-9]+)\]/);
    return { hash: hashMatch?.[1] ?? "" };
  }

  async getStagedDiff(location: ProjectLocation): Promise<string> {
    return execGit(location, ["diff", "--cached"]);
  }

  async getAllDiff(location: ProjectLocation): Promise<string> {
    return execGit(location, ["diff"]);
  }

  async getLogRange(location: ProjectLocation, base: string, head: string): Promise<string> {
    return execGit(location, ["log", "--oneline", `${base}..${head}`]);
  }

  async getDiffRange(location: ProjectLocation, base: string, head: string): Promise<string> {
    return execGit(location, ["diff", `${base}...${head}`]);
  }

  async listBranches(
    location: ProjectLocation,
    includeRemote: boolean,
  ): Promise<GitBranchListResult> {
    return this.worktreeService.listBranches(location, includeRemote);
  }

  async fetch(location: ProjectLocation, remote: string, prune: boolean): Promise<void> {
    return this.worktreeService.fetch(location, remote, prune);
  }

  async pull(location: ProjectLocation, remote: string): Promise<void> {
    return this.worktreeService.pull(location, remote);
  }

  async push(
    location: ProjectLocation,
    remote: string,
    branch?: string,
    setUpstream?: boolean,
  ): Promise<void> {
    return this.worktreeService.push(location, remote, branch, setUpstream);
  }

  async listWorktrees(location: ProjectLocation): Promise<GitWorktreeListResult> {
    return this.worktreeService.listWorktrees(location);
  }

  async addWorktree(
    location: ProjectLocation,
    path: string | undefined,
    branch?: string,
    createBranch?: boolean,
    startPoint?: string,
  ): Promise<GitAddWorktreeResult> {
    return this.worktreeService.addWorktree(location, path, branch, createBranch, startPoint);
  }

  async removeWorktree(
    location: ProjectLocation,
    path: string,
    force: boolean,
    deleteBranch?: boolean,
  ): Promise<void> {
    return this.worktreeService.removeWorktree(location, path, force, deleteBranch);
  }

  async deleteRemoteBranch(
    location: ProjectLocation,
    remote: string,
    branch: string,
  ): Promise<void> {
    return this.worktreeService.deleteRemoteBranch(location, remote, branch);
  }

  async deleteBranch(location: ProjectLocation, branch: string, force: boolean): Promise<void> {
    return this.worktreeService.deleteBranch(location, branch, force);
  }

  async switchBranch(
    location: ProjectLocation,
    branch: string,
    createNew: boolean,
  ): Promise<GitSwitchBranchResult> {
    return this.worktreeService.switchBranch(location, branch, createNew);
  }

  async getWorktreeSourceBranch(
    location: ProjectLocation,
    branch: string,
  ): Promise<GitGetWorktreeSourceBranchResult> {
    return this.worktreeService.getWorktreeSourceBranch(location, branch);
  }

  async mergeToSource(
    repoLocation: ProjectLocation,
    worktreeLocation: ProjectLocation,
    worktreeBranch: string,
    sourceBranch: string,
  ): Promise<GitMergeToSourceResult> {
    return this.mergeService.mergeToSource(
      repoLocation,
      worktreeLocation,
      worktreeBranch,
      sourceBranch,
    );
  }

  async pullFromSource(
    worktreeLocation: ProjectLocation,
    sourceBranch: string,
  ): Promise<GitPullFromSourceResult> {
    return this.mergeService.pullFromSource(worktreeLocation, sourceBranch);
  }

  async abortMerge(worktreeLocation: ProjectLocation): Promise<void> {
    return this.mergeService.abortMerge(worktreeLocation);
  }

  async finishMerge(worktreeLocation: ProjectLocation): Promise<GitFinishMergeResult> {
    return this.mergeService.finishMerge(worktreeLocation);
  }

  async pruneWorktrees(location: ProjectLocation, activeWorktreePaths: string[]): Promise<void> {
    return this.worktreeService.pruneWorktrees(location, activeWorktreePaths);
  }
}
