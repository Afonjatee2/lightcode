import type {
  CloseThreadPayload,
  CreateProjectEntryPayload,
  DeleteProjectEntryPayload,
  ExtractContextPayload,
  GenerateCommitMessagePayload,
  GenerateTitlePayload,
  GeneratePrSummaryPayload,
  GetGitBranchesPayload,
  GetGitDiffBatchPayload,
  GetGitDiffPayload,
  GetGitFileContentPayload,
  GetGitStatusPayload,
  GitAddWorktreePayload,
  GitCommitPayload,
  GitDeleteBranchPayload,
  GitSwitchBranchPayload,
  GitFetchPayload,
  GitGetWorktreeSourceBranchPayload,
  GitListWorktreesPayload,
  GitMergeToSourcePayload,
  GitPullFromSourcePayload,
  GitAbortMergePayload,
  GitRunMergetoolPayload,
  GitFinishMergePayload,
  GitPullPayload,
  GitPushPayload,
  GitRemoveWorktreePayload,
  GitPruneWorktreesPayload,
  GitRevertAllPayload,
  GitRevertPayload,
  GitStageAllPayload,
  GitStagePayload,
  GitSyncPayload,
  GitUnstageAllPayload,
  ListProjectTreePayload,
  MoveProjectEntryPayload,
  ReadProjectFilePayload,
  DetectSetupScriptPayload,
  RenameProjectEntryPayload,
  SearchProjectFilesPayload,
  SearchProjectTreePayload,
  GitUnstagePayload,
  GitUnwatchProjectPayload,
  GitWatchProjectPayload,
  GitWatchWorktreesPayload,
  GhCreatePrPayload,
  GhGetPrForBranchPayload,
  GhMergePrPayload,
  GhClosePrPayload,
  GhReopenPrPayload,
  GhGetPrChecksPayload,
  ResizeTerminalPayload,
  ResolveThreadServerRequestPayload,
  SendThreadInputPayload,
  StartShellPayload,
  StartThreadPayload,
  WriteTerminalPayload,
  WriteProjectFilePayload,
} from "@/shared/contracts";
import type { SupervisorReply, SupervisorRequest } from "@/shared/ipc";
import {
  closeThreadPayloadSchema,
  createProjectEntryPayloadSchema,
  deleteProjectEntryPayloadSchema,
  getAgentStatusesPayloadSchema,
  getGitBranchesPayloadSchema,
  getGitDiffBatchPayloadSchema,
  getGitDiffPayloadSchema,
  getGitFileContentPayloadSchema,
  getGitStatusPayloadSchema,
  gitAddWorktreePayloadSchema,
  gitCommitPayloadSchema,
  gitFetchPayloadSchema,
  gitListWorktreesPayloadSchema,
  gitPullPayloadSchema,
  gitPushPayloadSchema,
  gitDeleteBranchPayloadSchema,
  gitSwitchBranchPayloadSchema,
  gitGetWorktreeSourceBranchPayloadSchema,
  gitMergeToSourcePayloadSchema,
  gitPullFromSourcePayloadSchema,
  gitAbortMergePayloadSchema,
  gitRunMergetoolPayloadSchema,
  gitFinishMergePayloadSchema,
  gitRemoveWorktreePayloadSchema,
  gitPruneWorktreesPayloadSchema,
  gitSyncPayloadSchema,
  gitWatchProjectPayloadSchema,
  gitWatchWorktreesPayloadSchema,
  gitUnwatchProjectPayloadSchema,
  listProjectTreePayloadSchema,
  detectSetupScriptPayloadSchema,
  moveProjectEntryPayloadSchema,
  readProjectFilePayloadSchema,
  renameProjectEntryPayloadSchema,
  searchProjectFilesPayloadSchema,
  searchProjectTreePayloadSchema,
  ghCreatePrPayloadSchema,
  ghGetPrForBranchPayloadSchema,
  ghMergePrPayloadSchema,
  ghClosePrPayloadSchema,
  ghReopenPrPayloadSchema,
  ghGetPrChecksPayloadSchema,
  getGitStatusPayloadSchema as ghCheckAvailablePayloadSchema,
  extractContextPayloadSchema,
  generateCommitMessagePayloadSchema,
  generateTitlePayloadSchema,
  generatePrSummaryPayloadSchema,
  gitRevertAllPayloadSchema,
  gitRevertPayloadSchema,
  gitStageAllPayloadSchema,
  gitStagePayloadSchema,
  gitUnstageAllPayloadSchema,
  gitUnstagePayloadSchema,
  resizeTerminalPayloadSchema,
  resolveThreadServerRequestPayloadSchema,
  sendThreadInputPayloadSchema,
  startShellPayloadSchema,
  startThreadPayloadSchema,
  writeProjectFilePayloadSchema,
  writeTerminalPayloadSchema,
} from "@/shared/contracts";
import { SupervisorRuntime } from "./runtime";

const runtime = new SupervisorRuntime((event) => {
  process.send?.(event);
});

let isShuttingDown = false;

function shutdownSupervisor(exitCode = 0): void {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  runtime.dispose();
  process.exit(exitCode);
}

async function handleRequest(request: SupervisorRequest): Promise<unknown> {
  switch (request.type) {
    case "listWslDistros":
      return runtime.listWslDistros();
    case "getAgentStatuses":
      return runtime.getAgentStatuses(getAgentStatusesPayloadSchema.parse(request.payload));
    case "getThreadSnapshots":
      return runtime.getThreadSnapshots();
    case "startThread":
      return runtime.startThread(
        startThreadPayloadSchema.parse(request.payload) as StartThreadPayload,
      );
    case "sendThreadInput":
      return runtime.sendThreadInput(
        sendThreadInputPayloadSchema.parse(request.payload) as SendThreadInputPayload,
      );
    case "writeTerminal":
      return runtime.writeTerminal(
        writeTerminalPayloadSchema.parse(request.payload) as WriteTerminalPayload,
      );
    case "resizeTerminal":
      return runtime.resizeTerminal(
        resizeTerminalPayloadSchema.parse(request.payload) as ResizeTerminalPayload,
      );
    case "resolveThreadServerRequest":
      return runtime.resolveThreadServerRequest(
        resolveThreadServerRequestPayloadSchema.parse(
          request.payload,
        ) as ResolveThreadServerRequestPayload,
      );
    case "closeThread":
      return runtime.closeThread(
        closeThreadPayloadSchema.parse(request.payload) as CloseThreadPayload,
      );
    case "startShell":
      return runtime.startShell(
        startShellPayloadSchema.parse(request.payload) as StartShellPayload,
      );
    case "getGitStatus":
      return runtime.getGitStatus(
        getGitStatusPayloadSchema.parse(request.payload) as GetGitStatusPayload,
      );
    case "getGitDiff":
      return runtime.getGitDiff(
        getGitDiffPayloadSchema.parse(request.payload) as GetGitDiffPayload,
      );
    case "getGitDiffBatch":
      return runtime.getGitDiffBatch(
        getGitDiffBatchPayloadSchema.parse(request.payload) as GetGitDiffBatchPayload,
      );
    case "getGitFileContent":
      return runtime.getGitFileContent(
        getGitFileContentPayloadSchema.parse(request.payload) as GetGitFileContentPayload,
      );
    case "gitStage":
      return runtime.gitStage(gitStagePayloadSchema.parse(request.payload) as GitStagePayload);
    case "gitUnstage":
      return runtime.gitUnstage(
        gitUnstagePayloadSchema.parse(request.payload) as GitUnstagePayload,
      );
    case "gitRevert":
      return runtime.gitRevert(gitRevertPayloadSchema.parse(request.payload) as GitRevertPayload);
    case "gitStageAll":
      return runtime.gitStageAll(
        gitStageAllPayloadSchema.parse(request.payload) as GitStageAllPayload,
      );
    case "gitUnstageAll":
      return runtime.gitUnstageAll(
        gitUnstageAllPayloadSchema.parse(request.payload) as GitUnstageAllPayload,
      );
    case "gitRevertAll":
      return runtime.gitRevertAll(
        gitRevertAllPayloadSchema.parse(request.payload) as GitRevertAllPayload,
      );
    case "gitCommit":
      return runtime.gitCommit(gitCommitPayloadSchema.parse(request.payload) as GitCommitPayload);
    case "generateCommitMessage":
      return runtime.generateCommitMessage(
        generateCommitMessagePayloadSchema.parse(request.payload) as GenerateCommitMessagePayload,
      );
    case "generateTitle":
      return runtime.generateTitle(
        generateTitlePayloadSchema.parse(request.payload) as GenerateTitlePayload,
      );
    case "generatePrSummary":
      return runtime.generatePrSummary(
        generatePrSummaryPayloadSchema.parse(request.payload) as GeneratePrSummaryPayload,
      );
    case "extractContext":
      return runtime.extractContext(
        extractContextPayloadSchema.parse(request.payload) as ExtractContextPayload,
      );
    case "cancelExtractContext":
      return runtime.cancelExtractContext((request.payload as { threadId: string }).threadId);
    case "readTerminalScrollback":
      return runtime.readTerminalScrollback((request.payload as { threadId: string }).threadId);
    case "gitListBranches":
      return runtime.gitListBranches(
        getGitBranchesPayloadSchema.parse(request.payload) as GetGitBranchesPayload,
      );
    case "gitFetch":
      return runtime.gitFetch(gitFetchPayloadSchema.parse(request.payload) as GitFetchPayload);
    case "gitListWorktrees":
      return runtime.gitListWorktrees(
        gitListWorktreesPayloadSchema.parse(request.payload) as GitListWorktreesPayload,
      );
    case "gitAddWorktree":
      return runtime.gitAddWorktree(
        gitAddWorktreePayloadSchema.parse(request.payload) as GitAddWorktreePayload,
      );
    case "gitRemoveWorktree":
      return runtime.gitRemoveWorktree(
        gitRemoveWorktreePayloadSchema.parse(request.payload) as GitRemoveWorktreePayload,
      );
    case "gitPruneWorktrees":
      return runtime.gitPruneWorktrees(
        gitPruneWorktreesPayloadSchema.parse(request.payload) as GitPruneWorktreesPayload,
      );
    case "gitDeleteBranch":
      return runtime.gitDeleteBranch(
        gitDeleteBranchPayloadSchema.parse(request.payload) as GitDeleteBranchPayload,
      );
    case "gitSwitchBranch":
      return runtime.gitSwitchBranch(
        gitSwitchBranchPayloadSchema.parse(request.payload) as GitSwitchBranchPayload,
      );
    case "gitPull":
      return runtime.gitPull(gitPullPayloadSchema.parse(request.payload) as GitPullPayload);
    case "gitPush":
      return runtime.gitPush(gitPushPayloadSchema.parse(request.payload) as GitPushPayload);
    case "gitSync":
      return runtime.gitSync(gitSyncPayloadSchema.parse(request.payload) as GitSyncPayload);
    case "gitGetWorktreeSourceBranch":
      return runtime.gitGetWorktreeSourceBranch(
        gitGetWorktreeSourceBranchPayloadSchema.parse(
          request.payload,
        ) as GitGetWorktreeSourceBranchPayload,
      );
    case "gitMergeToSource":
      return runtime.gitMergeToSource(
        gitMergeToSourcePayloadSchema.parse(request.payload) as GitMergeToSourcePayload,
      );
    case "gitPullFromSource":
      return runtime.gitPullFromSource(
        gitPullFromSourcePayloadSchema.parse(request.payload) as GitPullFromSourcePayload,
      );
    case "gitAbortMerge":
      return runtime.gitAbortMerge(
        gitAbortMergePayloadSchema.parse(request.payload) as GitAbortMergePayload,
      );
    case "gitRunMergetool":
      return runtime.gitRunMergetool(
        gitRunMergetoolPayloadSchema.parse(request.payload) as GitRunMergetoolPayload,
      );
    case "gitFinishMerge":
      return runtime.gitFinishMerge(
        gitFinishMergePayloadSchema.parse(request.payload) as GitFinishMergePayload,
      );
    case "gitWatchProject":
      return runtime.gitWatchProject(
        gitWatchProjectPayloadSchema.parse(request.payload) as GitWatchProjectPayload,
      );
    case "gitWatchWorktrees":
      return runtime.gitWatchWorktrees(
        gitWatchWorktreesPayloadSchema.parse(request.payload) as GitWatchWorktreesPayload,
      );
    case "gitUnwatchProject":
      return runtime.gitUnwatchProject(
        gitUnwatchProjectPayloadSchema.parse(request.payload) as GitUnwatchProjectPayload,
      );
    case "searchProjectFiles":
      return runtime.searchProjectFiles(
        searchProjectFilesPayloadSchema.parse(request.payload) as SearchProjectFilesPayload,
      );
    case "listProjectTree":
      return runtime.listProjectTree(
        listProjectTreePayloadSchema.parse(request.payload) as ListProjectTreePayload,
      );
    case "searchProjectTree":
      return runtime.searchProjectTree(
        searchProjectTreePayloadSchema.parse(request.payload) as SearchProjectTreePayload,
      );
    case "readProjectFile":
      return runtime.readProjectFile(
        readProjectFilePayloadSchema.parse(request.payload) as ReadProjectFilePayload,
      );
    case "writeProjectFile":
      return runtime.writeProjectFile(
        writeProjectFilePayloadSchema.parse(request.payload) as WriteProjectFilePayload,
      );
    case "createProjectEntry":
      return runtime.createProjectEntry(
        createProjectEntryPayloadSchema.parse(request.payload) as CreateProjectEntryPayload,
      );
    case "renameProjectEntry":
      return runtime.renameProjectEntry(
        renameProjectEntryPayloadSchema.parse(request.payload) as RenameProjectEntryPayload,
      );
    case "moveProjectEntry":
      return runtime.moveProjectEntry(
        moveProjectEntryPayloadSchema.parse(request.payload) as MoveProjectEntryPayload,
      );
    case "deleteProjectEntry":
      return runtime.deleteProjectEntry(
        deleteProjectEntryPayloadSchema.parse(request.payload) as DeleteProjectEntryPayload,
      );
    case "detectSetupScript":
      return runtime.detectSetupScript(
        detectSetupScriptPayloadSchema.parse(request.payload) as DetectSetupScriptPayload,
      );
    case "ghCheckAvailable":
      return runtime.ghCheckAvailable(
        ghCheckAvailablePayloadSchema.parse(request.payload) as GetGitStatusPayload,
      );
    case "ghCreatePr":
      return runtime.ghCreatePr(
        ghCreatePrPayloadSchema.parse(request.payload) as GhCreatePrPayload,
      );
    case "ghGetPrForBranch":
      return runtime.ghGetPrForBranch(
        ghGetPrForBranchPayloadSchema.parse(request.payload) as GhGetPrForBranchPayload,
      );
    case "ghMergePr":
      return runtime.ghMergePr(ghMergePrPayloadSchema.parse(request.payload) as GhMergePrPayload);
    case "ghClosePr":
      return runtime.ghClosePr(ghClosePrPayloadSchema.parse(request.payload) as GhClosePrPayload);
    case "ghReopenPr":
      return runtime.ghReopenPr(
        ghReopenPrPayloadSchema.parse(request.payload) as GhReopenPrPayload,
      );
    case "ghGetPrChecks":
      return runtime.ghGetPrChecks(
        ghGetPrChecksPayloadSchema.parse(request.payload) as GhGetPrChecksPayload,
      );
    case "lspStart":
      return runtime.lspStart(request.payload);
    case "lspStop":
      return runtime.lspStop(request.payload);
    case "lspMessage":
      return runtime.lspSendMessage(request.payload);
    default: {
      const exhaustive: never = request;
      return exhaustive;
    }
  }
}

process.on("message", async (message: SupervisorRequest) => {
  const reply = await handleRequest(message)
    .then(
      (data): SupervisorReply => ({
        replyTo: message.id,
        ok: true,
        data,
      }),
    )
    .catch(
      (error: unknown): SupervisorReply => ({
        replyTo: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

  process.send?.(reply);
});

process.on("disconnect", () => {
  shutdownSupervisor(0);
});

process.on("SIGINT", () => {
  shutdownSupervisor(0);
});

process.on("SIGTERM", () => {
  shutdownSupervisor(0);
});

process.on("uncaughtException", (error) => {
  console.error("[supervisor] uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[supervisor] unhandled rejection:", reason);
});
