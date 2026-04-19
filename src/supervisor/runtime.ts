import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentKind,
  AgentStatusesResponse,
  CloseThreadPayload,
  CreateProjectEntryPayload,
  DeleteProjectEntryPayload,
  DetectSetupScriptPayload,
  DetectSetupScriptResult,
  ExtractContextPayload,
  ExtractContextResult,
  GenerateCommitMessagePayload,
  GenerateCommitMessageResult,
  GeneratePrSummaryPayload,
  GeneratePrSummaryResult,
  GenerateTitlePayload,
  GenerateTitleResult,
  GetAgentStatusesPayload,
  GetGitBranchesPayload,
  GetGitDiffBatchPayload,
  GetGitDiffPayload,
  GetGitFileContentPayload,
  GetGitStatusPayload,
  GhCheckAvailableResult,
  GhCreatePrPayload,
  GhGetPrChecksPayload,
  GhGetPrChecksResult,
  GhGetPrForBranchPayload,
  GhMergePrPayload,
  GhClosePrPayload,
  GhReopenPrPayload,
  GitAbortMergePayload,
  GitAddWorktreePayload,
  GitAddWorktreeResult,
  GitBranchListResult,
  GitCommitPayload,
  GitCommitResult,
  GitDeleteBranchPayload,
  GitDiffBatchResult,
  GitDiffResult,
  GitFetchPayload,
  GitFileContentResult,
  GitFinishMergePayload,
  GitFinishMergeResult,
  GitGetWorktreeSourceBranchPayload,
  GitGetWorktreeSourceBranchResult,
  GitListWorktreesPayload,
  GitMergeToSourcePayload,
  GitMergeToSourceResult,
  GitPullFromSourcePayload,
  GitPullFromSourceResult,
  GitPullPayload,
  GitPruneWorktreesPayload,
  GitPushPayload,
  GitRemoveWorktreePayload,
  GitRevertAllPayload,
  GitRevertPayload,
  GitRunMergetoolPayload,
  GitRunMergetoolResult,
  GitStageAllPayload,
  GitStagePayload,
  GitStatusResult,
  GitSwitchBranchPayload,
  GitSwitchBranchResult,
  GitSyncPayload,
  GitSyncResult,
  GitUnstageAllPayload,
  GitUnstagePayload,
  GitUnwatchProjectPayload,
  GitWatchProjectPayload,
  GitWatchWorktreesPayload,
  GitWorktreeListResult,
  ListProjectTreePayload,
  ListProjectTreeResult,
  MoveProjectEntryPayload,
  PrData,
  ReadProjectFilePayload,
  ReadProjectFileResult,
  RenameProjectEntryPayload,
  ResizeTerminalPayload,
  ResolveThreadServerRequestPayload,
  SearchProjectFilesPayload,
  SearchProjectFilesResult,
  SearchProjectTreePayload,
  SearchProjectTreeResult,
  SendThreadInputPayload,
  StartShellPayload,
  StartThreadPayload,
  StartThreadResult,
  ThreadRuntimeSnapshot,
  WriteProjectFilePayload,
  WriteProjectFileResult,
  WriteTerminalPayload,
} from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import type { LspMessagePayload, LspStartPayload, LspStopPayload } from "@/shared/lsp";
import { resolveLightcodePaths } from "@/shared/lightcodePaths";
import { createAgentRegistry } from "./agents/registry";
import { readWslCommandOutputAsync } from "./agents/base";
import { generateCommitMessage } from "./commitMessageGenerator";
import {
  extractContext as extractContextFn,
  extractContextFromScrollback,
} from "./contextExtractor";
import { FileIndexService } from "./fileIndex";
import { GitService } from "./git";
import { GitHubService } from "./github";
import { GitWatcher } from "./gitWatcher";
import { LanguageServerManager } from "./lsp";
import { ProjectTreeService } from "./projectTree";
import { generatePrSummary } from "./prSummaryGenerator";
import { detectWindowsShell, type WindowsShellPreference } from "./shellPreference";
import { generateTitle } from "./titleGenerator";
import { AgentStatusService, detectWslAgentStatuses } from "./runtime/agentStatusService";
import { type SessionRuntime, type ShellSessionRuntime } from "./runtime/sessionTypes";
import { ThreadSessionManager, writeSubmittedPrompt } from "./runtime/threadSessionManager";

export { detectWslAgentStatuses, writeSubmittedPrompt };

export class SupervisorRuntime {
  private readonly isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
  private readonly logsDir: string;
  private readonly settingsPath: string;
  private readonly gitService = new GitService();
  private _gitWatcher: GitWatcher | undefined;
  private readonly githubService = new GitHubService();
  private readonly fileIndexService = new FileIndexService();
  private readonly projectTreeService = new ProjectTreeService();
  private readonly adapters = new Map(
    createAgentRegistry().map((adapter) => [adapter.kind, adapter]),
  );
  private readonly windowsShell: WindowsShellPreference;
  private readonly agentStatusService: AgentStatusService;
  private readonly threadSessionManager: ThreadSessionManager;
  private readonly lspManager: LanguageServerManager;
  private extractionAbortControllers = new Map<string, AbortController>();

  readonly sessions: Map<string, SessionRuntime>;
  readonly shellSessions: Map<string, ShellSessionRuntime>;

  private get gitWatcher(): GitWatcher {
    if (!this._gitWatcher) {
      this._gitWatcher = new GitWatcher((projectId) => {
        this.emit({ type: "git-changed", projectId });
      });
    }
    return this._gitWatcher;
  }

  constructor(private readonly emit: (event: SupervisorEvent) => void) {
    const baseDir = process.env.LIGHTCODE_DATA_DIR?.trim() || join(homedir(), ".lightcode");
    const paths = resolveLightcodePaths(baseDir);
    this.logsDir = paths.terminalLogsDir;
    this.settingsPath = paths.settingsPath;
    mkdirSync(paths.cacheDir, { recursive: true });
    mkdirSync(this.logsDir, { recursive: true });

    this.lspManager = new LanguageServerManager(emit);
    this.windowsShell =
      process.platform === "win32"
        ? detectWindowsShell()
        : { shell: process.env.SHELL || "/bin/bash", kind: "cmd", args: [] };

    this.agentStatusService = new AgentStatusService({
      adapters: this.adapters,
      settingsPath: this.settingsPath,
      statusCachePath: paths.statusCachePath,
      emit,
    });
    this.threadSessionManager = new ThreadSessionManager({
      emit,
      isDev: this.isDev,
      logsDir: this.logsDir,
      settingsPath: this.settingsPath,
      adapters: this.adapters,
      windowsShell: this.windowsShell,
    });
    this.sessions = this.threadSessionManager.sessions;
    this.shellSessions = this.threadSessionManager.shellSessions;
  }

  async listWslDistros(): Promise<string[]> {
    return this.agentStatusService.listWslDistros();
  }

  async getAgentStatuses(payload: GetAgentStatusesPayload): Promise<AgentStatusesResponse> {
    return this.agentStatusService.getAgentStatuses(payload);
  }

  getThreadSnapshots(): ThreadRuntimeSnapshot[] {
    return this.threadSessionManager.getThreadSnapshots();
  }

  async startThread(payload: StartThreadPayload): Promise<StartThreadResult> {
    return this.threadSessionManager.startThread(payload);
  }

  async sendThreadInput(payload: SendThreadInputPayload): Promise<void> {
    return this.threadSessionManager.sendThreadInput(payload);
  }

  async writeTerminal(payload: WriteTerminalPayload): Promise<void> {
    return this.threadSessionManager.writeTerminal(payload);
  }

  async resizeTerminal(payload: ResizeTerminalPayload): Promise<void> {
    return this.threadSessionManager.resizeTerminal(payload);
  }

  async closeThread(payload: CloseThreadPayload): Promise<void> {
    return this.threadSessionManager.closeThread(payload);
  }

  async startShell(payload: StartShellPayload): Promise<void> {
    return this.threadSessionManager.startShell(payload);
  }

  async resolveThreadServerRequest(payload: ResolveThreadServerRequestPayload): Promise<void> {
    return this.threadSessionManager.resolveThreadServerRequest(payload);
  }

  readTerminalScrollback(threadId: string): string {
    return this.threadSessionManager.readTerminalScrollback(threadId);
  }

  async getGitStatus(payload: GetGitStatusPayload): Promise<GitStatusResult> {
    return this.gitService.getStatus(payload.projectLocation);
  }

  async getGitDiff(payload: GetGitDiffPayload): Promise<GitDiffResult> {
    return this.gitService.getDiff(payload.projectLocation, payload.filePath, payload.staged);
  }

  async getGitDiffBatch(payload: GetGitDiffBatchPayload): Promise<GitDiffBatchResult> {
    return this.gitService.getDiffBatch(payload.projectLocation, payload.untrackedPaths);
  }

  async getGitFileContent(payload: GetGitFileContentPayload): Promise<GitFileContentResult> {
    return this.gitService.getFileContent(
      payload.projectLocation,
      payload.filePath,
      payload.staged,
    );
  }

  async gitStage(payload: GitStagePayload): Promise<void> {
    return this.gitService.stage(payload.projectLocation, payload.filePath);
  }

  async gitUnstage(payload: GitUnstagePayload): Promise<void> {
    return this.gitService.unstage(payload.projectLocation, payload.filePath);
  }

  async gitRevert(payload: GitRevertPayload): Promise<void> {
    return this.gitService.revert(payload.projectLocation, payload.filePath);
  }

  async gitStageAll(payload: GitStageAllPayload): Promise<void> {
    return this.gitService.stageAll(payload.projectLocation);
  }

  async gitUnstageAll(payload: GitUnstageAllPayload): Promise<void> {
    return this.gitService.unstageAll(payload.projectLocation);
  }

  async gitRevertAll(payload: GitRevertAllPayload): Promise<void> {
    return this.gitService.revertAll(payload.projectLocation);
  }

  async gitCommit(payload: GitCommitPayload): Promise<GitCommitResult> {
    const { hash } = await this.gitService.commit(
      payload.projectLocation,
      payload.message,
      payload.addAll ?? false,
    );
    return { hash, message: payload.message };
  }

  async generateCommitMessage(
    payload: GenerateCommitMessagePayload,
  ): Promise<GenerateCommitMessageResult> {
    const adapter = this.requireAdapter(payload.agentKind);
    return {
      message: await generateCommitMessage(
        payload.projectLocation,
        adapter,
        payload.model,
        payload.effort,
      ),
    };
  }

  async generateTitle(payload: GenerateTitlePayload): Promise<GenerateTitleResult> {
    const adapter = this.requireAdapter(payload.agentKind);
    return {
      title: await generateTitle(
        payload.projectLocation,
        adapter,
        payload.prompt,
        payload.model,
        payload.effort,
      ),
    };
  }

  async generatePrSummary(payload: GeneratePrSummaryPayload): Promise<GeneratePrSummaryResult> {
    const adapter = this.requireAdapter(payload.agentKind);
    return generatePrSummary(
      payload.projectLocation,
      adapter,
      payload.branch,
      payload.baseBranch,
      payload.model,
      payload.effort,
    );
  }

  async extractContext(payload: ExtractContextPayload): Promise<ExtractContextResult> {
    const adapter = this.requireAdapter(payload.agentKind);
    const abortController = new AbortController();
    this.extractionAbortControllers.set(payload.threadId, abortController);

    try {
      try {
        return await extractContextFn(
          payload.projectLocation,
          adapter,
          payload.sessionRef,
          payload.worktreePath,
          payload.model,
          payload.effort,
          abortController.signal,
        );
      } catch {
        const scrollback = this.readTerminalScrollback(payload.threadId);
        if (scrollback) {
          return extractContextFromScrollback(
            payload.projectLocation,
            adapter,
            scrollback,
            payload.agentKind,
            payload.sessionRef.providerSessionId,
            payload.worktreePath,
            payload.model,
            payload.effort,
            abortController.signal,
          );
        }
        throw new Error(
          `Cannot extract context from ${adapter.label}: no session resume or scrollback available`,
        );
      }
    } finally {
      this.extractionAbortControllers.delete(payload.threadId);
    }
  }

  cancelExtractContext(threadId: string): void {
    const controller = this.extractionAbortControllers.get(threadId);
    if (controller) {
      controller.abort();
      this.extractionAbortControllers.delete(threadId);
    }
  }

  async gitListBranches(payload: GetGitBranchesPayload): Promise<GitBranchListResult> {
    return this.gitService.listBranches(payload.projectLocation, payload.includeRemote);
  }

  async gitFetch(payload: GitFetchPayload): Promise<void> {
    return this.gitService.fetch(payload.projectLocation, payload.remote, payload.prune);
  }

  async gitListWorktrees(payload: GitListWorktreesPayload): Promise<GitWorktreeListResult> {
    return this.gitService.listWorktrees(payload.projectLocation);
  }

  async gitAddWorktree(payload: GitAddWorktreePayload): Promise<GitAddWorktreeResult> {
    return this.gitService.addWorktree(
      payload.projectLocation,
      payload.path,
      payload.branch,
      payload.createBranch,
      payload.startPoint,
    );
  }

  async gitRemoveWorktree(payload: GitRemoveWorktreePayload): Promise<void> {
    const normalizedTarget = payload.path.replace(/\\/g, "/").toLowerCase();

    for (const [threadId, session] of this.sessions) {
      const sessionPath =
        session.projectLocation.kind === "wsl"
          ? session.projectLocation.uncPath
          : session.projectLocation.path;
      if (sessionPath.replace(/\\/g, "/").toLowerCase() === normalizedTarget) {
        await this.closeThread({ threadId }).catch(() => undefined);
      }
    }

    for (const [threadId, shell] of this.shellSessions) {
      if (shell.worktreePath?.replace(/\\/g, "/").toLowerCase() === normalizedTarget) {
        await this.closeThread({ threadId }).catch(() => undefined);
      }
    }

    this.gitWatcher.unwatchWorktree(payload.path);
    return this.gitService.removeWorktree(
      payload.projectLocation,
      payload.path,
      payload.force,
      payload.deleteBranch,
    );
  }

  async gitPruneWorktrees(payload: GitPruneWorktreesPayload): Promise<void> {
    return this.gitService.pruneWorktrees(payload.projectLocation, payload.activeWorktreePaths);
  }

  async gitDeleteBranch(payload: GitDeleteBranchPayload): Promise<void> {
    if (payload.remote) {
      return this.gitService.deleteRemoteBranch(
        payload.projectLocation,
        payload.remote,
        payload.branch,
      );
    }
    return this.gitService.deleteBranch(payload.projectLocation, payload.branch, payload.force);
  }

  async gitSwitchBranch(payload: GitSwitchBranchPayload): Promise<GitSwitchBranchResult> {
    return this.gitService.switchBranch(payload.projectLocation, payload.branch, payload.createNew);
  }

  async gitPull(payload: GitPullPayload): Promise<void> {
    return this.gitService.pull(payload.projectLocation, payload.remote ?? "origin");
  }

  async gitPush(payload: GitPushPayload): Promise<void> {
    return this.gitService.push(
      payload.projectLocation,
      payload.remote ?? "origin",
      payload.branch,
      payload.setUpstream ?? false,
    );
  }

  async gitSync(payload: GitSyncPayload): Promise<GitSyncResult> {
    const location = payload.projectLocation;
    const remote = payload.remote ?? "origin";
    await this.gitService.fetch(location, remote, false);

    const status = await this.gitService.getStatus(location);
    let pulled = false;
    let pushed = false;

    if (status.behind > 0) {
      await this.gitService.pull(location, remote);
      pulled = true;
    }

    const afterPull = pulled ? await this.gitService.getStatus(location) : status;
    if (afterPull.ahead > 0) {
      await this.gitService.push(location, remote);
      pushed = true;
    }

    return { pulled, pushed };
  }

  async gitGetWorktreeSourceBranch(
    payload: GitGetWorktreeSourceBranchPayload,
  ): Promise<GitGetWorktreeSourceBranchResult> {
    return this.gitService.getWorktreeSourceBranch(payload.projectLocation, payload.branch);
  }

  async gitMergeToSource(payload: GitMergeToSourcePayload): Promise<GitMergeToSourceResult> {
    return this.gitService.mergeToSource(
      payload.projectLocation,
      payload.worktreeLocation,
      payload.worktreeBranch,
      payload.sourceBranch,
    );
  }

  async gitPullFromSource(payload: GitPullFromSourcePayload): Promise<GitPullFromSourceResult> {
    return this.gitService.pullFromSource(payload.worktreeLocation, payload.sourceBranch);
  }

  async ghCheckAvailable(payload: GetGitStatusPayload): Promise<GhCheckAvailableResult> {
    return this.githubService.checkGhAvailable(payload.projectLocation);
  }

  async ghCreatePr(payload: GhCreatePrPayload): Promise<PrData> {
    return this.githubService.createPr(
      payload.projectLocation,
      payload.branch,
      payload.baseBranch,
      payload.title,
      payload.body,
      payload.isDraft,
    );
  }

  async ghGetPrForBranch(payload: GhGetPrForBranchPayload): Promise<PrData | null> {
    return this.githubService.getPrForBranch(payload.projectLocation, payload.branch);
  }

  async ghMergePr(payload: GhMergePrPayload): Promise<void> {
    return this.githubService.mergePr(payload.projectLocation, payload.prNumber, payload.method);
  }

  async ghClosePr(payload: GhClosePrPayload): Promise<void> {
    return this.githubService.closePr(payload.projectLocation, payload.prNumber);
  }

  async ghReopenPr(payload: GhReopenPrPayload): Promise<void> {
    return this.githubService.reopenPr(payload.projectLocation, payload.prNumber);
  }

  async ghGetPrChecks(payload: GhGetPrChecksPayload): Promise<GhGetPrChecksResult> {
    return this.githubService.getPrChecks(payload.projectLocation, payload.branch);
  }

  async gitAbortMerge(payload: GitAbortMergePayload): Promise<void> {
    return this.gitService.abortMerge(payload.worktreeLocation);
  }

  async gitRunMergetool(payload: GitRunMergetoolPayload): Promise<GitRunMergetoolResult> {
    return this.gitService.runMergetool(payload.worktreeLocation);
  }

  async gitFinishMerge(payload: GitFinishMergePayload): Promise<GitFinishMergeResult> {
    return this.gitService.finishMerge(payload.worktreeLocation);
  }

  async gitWatchProject(payload: GitWatchProjectPayload): Promise<void> {
    this.gitWatcher.watch(payload.projectId, payload.projectLocation);
  }

  async gitWatchWorktrees(payload: GitWatchWorktreesPayload): Promise<void> {
    this.gitWatcher.watchWorktrees(payload.projectId, payload.worktreePaths);
  }

  async gitUnwatchProject(payload: GitUnwatchProjectPayload): Promise<void> {
    this.gitWatcher.unwatch(payload.projectId);
  }

  async searchProjectFiles(payload: SearchProjectFilesPayload): Promise<SearchProjectFilesResult> {
    return this.fileIndexService.searchProjectFiles(payload);
  }

  async listProjectTree(payload: ListProjectTreePayload): Promise<ListProjectTreeResult> {
    return this.projectTreeService.listProjectTree(payload);
  }

  async searchProjectTree(payload: SearchProjectTreePayload): Promise<SearchProjectTreeResult> {
    return this.projectTreeService.searchProjectTree(payload);
  }

  async readProjectFile(payload: ReadProjectFilePayload): Promise<ReadProjectFileResult> {
    return this.projectTreeService.readProjectFile(payload);
  }

  async writeProjectFile(payload: WriteProjectFilePayload): Promise<WriteProjectFileResult> {
    return this.projectTreeService.writeProjectFile(payload);
  }

  async createProjectEntry(payload: CreateProjectEntryPayload): Promise<void> {
    return this.projectTreeService.createProjectEntry(payload);
  }

  async renameProjectEntry(payload: RenameProjectEntryPayload): Promise<void> {
    return this.projectTreeService.renameProjectEntry(payload);
  }

  async moveProjectEntry(payload: MoveProjectEntryPayload): Promise<void> {
    return this.projectTreeService.moveProjectEntry(payload);
  }

  async deleteProjectEntry(payload: DeleteProjectEntryPayload): Promise<void> {
    return this.projectTreeService.deleteProjectEntry(payload);
  }

  async detectSetupScript(payload: DetectSetupScriptPayload): Promise<DetectSetupScriptResult> {
    const candidates: { file: string; command: string }[] = [
      { file: "pnpm-lock.yaml", command: "pnpm install" },
      { file: "bun.lockb", command: "bun install" },
      { file: "bun.lock", command: "bun install" },
      { file: "yarn.lock", command: "yarn install" },
      { file: "package-lock.json", command: "npm install" },
      { file: "poetry.lock", command: "poetry install" },
      { file: "Pipfile.lock", command: "pipenv install" },
      { file: "requirements.txt", command: "pip install -r requirements.txt" },
      { file: "Cargo.lock", command: "cargo fetch" },
      { file: "go.sum", command: "go mod download" },
      { file: "Gemfile.lock", command: "bundle install" },
      { file: "composer.lock", command: "composer install" },
    ];

    const location = payload.projectLocation;
    if (location.kind === "wsl") {
      const checks = candidates.map(
        (candidate) => `test -f "${location.linuxPath}/${candidate.file}" && echo yes || echo no`,
      );
      const result = await readWslCommandOutputAsync(location.distro, "sh", [
        "-c",
        checks.join(" && echo '---' && "),
      ]);
      if (result.ok) {
        const answers = result.stdout.split("---").map((value) => value.trim());
        for (let index = 0; index < candidates.length; index += 1) {
          if (answers[index] === "yes") {
            return { setupScript: candidates[index]!.command };
          }
        }
      }
      return {};
    }

    const dir = location.path;
    for (const candidate of candidates) {
      if (existsSync(join(dir, candidate.file))) {
        return { setupScript: candidate.command };
      }
    }
    return {};
  }

  async lspStart(payload: LspStartPayload): Promise<void> {
    await this.lspManager.start(payload);
  }

  async lspStop(payload: LspStopPayload): Promise<void> {
    await this.lspManager.stop(payload);
  }

  async lspSendMessage(payload: LspMessagePayload): Promise<unknown> {
    return this.lspManager.sendMessage(payload);
  }

  dispose(): void {
    this.lspManager.dispose();
    this._gitWatcher?.dispose();
    this.threadSessionManager.dispose();
  }

  private requireAdapter(kind: AgentKind) {
    const adapter = this.adapters.get(kind);
    if (!adapter) {
      throw new Error(`Unsupported agent adapter: ${kind}`);
    }
    return adapter;
  }

  private handlePtyData(session: SessionRuntime, data: string): void {
    this.threadSessionManager.handlePtyDataForTests(session, data);
  }

  private spawnThread(input: unknown): unknown {
    return (
      this.threadSessionManager as unknown as { spawnThread: (value: unknown) => unknown }
    ).spawnThread(input);
  }

  /**
   * Test-only accessor for the private cache reader on the agent status
   * service.  Runtime callers should use `getAgentStatuses()` instead, which
   * returns the cached payload from the RPC promise.
   */
  private readCachedStatuses(wslDistros: readonly string[]): AgentStatusesResponse {
    return (
      this.agentStatusService as unknown as {
        readCachedStatuses: (distros: readonly string[]) => AgentStatusesResponse;
      }
    ).readCachedStatuses(wslDistros);
  }
}
