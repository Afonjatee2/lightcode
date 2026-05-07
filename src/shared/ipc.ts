import { z } from "zod";
import type { LspMessagePayload, LspSessionStatus, LspStartPayload, LspStopPayload } from "./lsp";
import type { OscShellEvent } from "./osc";
import type { SharedSettings, SharedSettingsInput } from "./settings";
import {
  closeThreadPayloadSchema,
  createProjectEntryPayloadSchema,
  deleteProjectEntryPayloadSchema,
  detectSetupScriptPayloadSchema,
  extractContextPayloadSchema,
  generateCommitMessagePayloadSchema,
  generatePrSummaryPayloadSchema,
  generateTitlePayloadSchema,
  getAgentStatusesPayloadSchema,
  getGitBranchesPayloadSchema,
  getGitDiffBatchPayloadSchema,
  getGitDiffPayloadSchema,
  getGitFileContentPayloadSchema,
  getGitStatusPayloadSchema,
  ghClosePrPayloadSchema,
  ghCreatePrPayloadSchema,
  ghGetPrChecksPayloadSchema,
  ghGetPrDiffPayloadSchema,
  ghGetPrFilesPayloadSchema,
  ghGetPrForBranchPayloadSchema,
  ghMarkPrReadyPayloadSchema,
  ghMergePrPayloadSchema,
  ghReopenPrPayloadSchema,
  ghSubmitPrReviewPayloadSchema,
  ghUpdatePrBranchPayloadSchema,
  gitAbortMergePayloadSchema,
  gitAddWorktreePayloadSchema,
  gitCommitPayloadSchema,
  gitDeleteBranchPayloadSchema,
  gitFetchPayloadSchema,
  gitFinishMergePayloadSchema,
  gitGetWorktreeSourceBranchPayloadSchema,
  gitProjectSnapshotPayloadSchema,
  gitWorktreeStatusBatchPayloadSchema,
  gitListWorktreesPayloadSchema,
  gitMergeToSourcePayloadSchema,
  gitPullFromSourcePayloadSchema,
  gitPullPayloadSchema,
  gitPruneWorktreesPayloadSchema,
  gitPushPayloadSchema,
  gitRemoveWorktreePayloadSchema,
  gitRevertAllPayloadSchema,
  gitRevertPayloadSchema,
  gitStageAllPayloadSchema,
  gitStagePayloadSchema,
  gitSwitchBranchPayloadSchema,
  gitSyncPayloadSchema,
  gitUnstageAllPayloadSchema,
  gitUnstagePayloadSchema,
  gitUnwatchProjectPayloadSchema,
  gitWatchProjectPayloadSchema,
  gitWatchWorktreesPayloadSchema,
  listProjectTreePayloadSchema,
  moveProjectEntryPayloadSchema,
  interruptThreadPayloadSchema,
  setPendingSteerPayloadSchema,
  clearPendingSteerPayloadSchema,
  projectSchema,
  readProjectFilePayloadSchema,
  renameProjectEntryPayloadSchema,
  resizeTerminalPayloadSchema,
  resolveThreadServerRequestPayloadSchema,
  revealProjectEntryPayloadSchema,
  searchProjectFilesPayloadSchema,
  searchProjectTreePayloadSchema,
  sendThreadInputPayloadSchema,
  startShellPayloadSchema,
  startThreadPayloadSchema,
  threadSchema,
  writeProjectFilePayloadSchema,
  writeTerminalPayloadSchema,
} from "./contracts";
import type {
  AgentStatus,
  AgentStatusesResponse,
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
  GhClosePrPayload,
  GhCreatePrPayload,
  GhGetPrChecksPayload,
  GhGetPrChecksResult,
  GhGetPrDiffPayload,
  GhGetPrDiffResult,
  GhGetPrFilesPayload,
  GhGetPrFilesResult,
  GhGetPrForBranchPayload,
  GhMarkPrReadyPayload,
  GhMergePrPayload,
  GhReopenPrPayload,
  GhSubmitPrReviewPayload,
  GhUpdatePrBranchPayload,
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
  GitProjectSnapshotPayload,
  GitProjectSnapshotResult,
  GitWorktreeStatusBatchPayload,
  GitWorktreeStatusBatchResult,
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
  InterruptThreadPayload,
  SetPendingSteerPayload,
  ClearPendingSteerPayload,
  PendingSteerState,
  ListProjectTreePayload,
  ListProjectTreeResult,
  MoveProjectEntryPayload,
  PrData,
  Project,
  ReadProjectFilePayload,
  ReadProjectFileResult,
  RenameProjectEntryPayload,
  ResizeTerminalPayload,
  ResolveThreadServerRequestPayload,
  RevealProjectEntryPayload,
  SearchProjectFilesPayload,
  SearchProjectFilesResult,
  SearchProjectTreePayload,
  SearchProjectTreeResult,
  SendThreadInputPayload,
  StartShellPayload,
  StartThreadPayload,
  StartThreadResult,
  Thread,
  ThreadAttention,
  ThreadConfig,
  ThreadRuntimeSnapshot,
  ThreadStatus,
  ThreadStatusSource,
  CloseThreadPayload,
  WriteProjectFilePayload,
  WriteProjectFileResult,
  WriteTerminalPayload,
  RuntimeEvent,
} from "./contracts";

const emptyPayloadSchema = z.object({});
type EmptyPayload = z.infer<typeof emptyPayloadSchema>;

const pickFilesOptionsSchema = z
  .object({
    title: z.string().optional(),
    filters: z
      .array(
        z.object({
          name: z.string().min(1),
          extensions: z.array(z.string().min(1)),
        }),
      )
      .optional(),
  })
  .optional();

const saveClipboardImagePayloadSchema = z.object({
  threadId: z.string().min(1),
  data: z.instanceof(Uint8Array),
  extension: z.string().min(1),
});

const saveHandoffContextPayloadSchema = z.object({
  threadId: z.string().min(1),
  content: z.string(),
});

const readThreadPayloadSchema = z.object({
  threadId: z.string().min(1),
});

const dbStateKeySchema = z.string().min(1);
const dbStatePayloadSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});
const dbDeleteThreadPayloadSchema = z.object({
  threadId: z.string().min(1),
});
const dbDeleteProjectPayloadSchema = z.object({
  projectId: z.string().min(1),
});
const dbSyncAllPayloadSchema = z.object({
  projects: z.array(projectSchema),
  threads: z.array(threadSchema),
  viewJson: z.string(),
});

const persistedRuntimeItemSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  state: z.enum(["started", "updated", "completed"]),
  payload: z.unknown(),
  streams: z.record(z.string(), z.string()),
});
export type PersistedRuntimeItem = z.infer<typeof persistedRuntimeItemSchema>;

const dbReplaceRuntimeItemsPayloadSchema = z.object({
  threadId: z.string().min(1),
  items: z.array(persistedRuntimeItemSchema),
});
const dbGetRuntimeItemsPayloadSchema = z.object({
  threadId: z.string().min(1),
});

const openExternalPayloadSchema = z.string().min(1);

export const windowChromePayloadSchema = z.object({
  backgroundColor: z.string(),
  symbolColor: z.string(),
});
export type WindowChromePayload = z.infer<typeof windowChromePayloadSchema>;

export type IpcTransport = "main-local" | "supervisor";

export interface IpcProcedureDef<
  Args extends unknown[],
  Payload,
  Result,
  Transport extends IpcTransport,
> {
  channel: string;
  transport: Transport;
  payloadSchema: z.ZodType<Payload>;
  parseArgs: (...args: Args) => Payload;
  __types: {
    args: Args;
    payload: Payload;
    result: Result;
  };
}

function toKebabCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function createChannel(name: string): string {
  return `lightcode:${toKebabCase(name)}`;
}

function defineIpcProcedure<
  Args extends unknown[],
  Payload,
  Result,
  Transport extends IpcTransport,
>(
  name: string,
  transport: Transport,
  payloadSchema: z.ZodType<Payload>,
  parseArgs: (...args: Args) => Payload,
): IpcProcedureDef<Args, Payload, Result, Transport> {
  return {
    channel: createChannel(name),
    transport,
    payloadSchema,
    parseArgs,
    __types: undefined as unknown as {
      args: Args;
      payload: Payload;
      result: Result;
    },
  };
}

function definePayloadProcedure<Payload, Result, Transport extends IpcTransport>(
  name: string,
  transport: Transport,
  payloadSchema: z.ZodType<Payload>,
): IpcProcedureDef<[Payload], Payload, Result, Transport> {
  return defineIpcProcedure(name, transport, payloadSchema, (payload) =>
    payloadSchema.parse(payload),
  );
}

function defineNoArgProcedure<Result, Transport extends IpcTransport>(
  name: string,
  transport: Transport,
): IpcProcedureDef<[], EmptyPayload, Result, Transport> {
  return defineIpcProcedure(name, transport, emptyPayloadSchema, () =>
    emptyPayloadSchema.parse({}),
  );
}

export const groupedIpcProcedures = {
  app: {
    pickFolder: defineIpcProcedure<[string?], string | undefined, string | null, "main-local">(
      "pickFolder",
      "main-local",
      z.string().optional(),
      (defaultPath) => (defaultPath ? z.string().parse(defaultPath) : undefined),
    ),
    pickFiles: defineIpcProcedure<
      [z.infer<typeof pickFilesOptionsSchema>?],
      z.infer<typeof pickFilesOptionsSchema>,
      string[] | null,
      "main-local"
    >("pickFiles", "main-local", pickFilesOptionsSchema, (options) =>
      pickFilesOptionsSchema.parse(options),
    ),
    saveClipboardImage: definePayloadProcedure<
      z.infer<typeof saveClipboardImagePayloadSchema>,
      string,
      "main-local"
    >("saveClipboardImage", "main-local", saveClipboardImagePayloadSchema),
    saveHandoffContext: definePayloadProcedure<
      z.infer<typeof saveHandoffContextPayloadSchema>,
      string,
      "main-local"
    >("saveHandoffContext", "main-local", saveHandoffContextPayloadSchema),
    listWslDistros: defineNoArgProcedure<string[], "supervisor">("listWslDistros", "supervisor"),
    openExternal: defineIpcProcedure<[string], string, void, "main-local">(
      "openExternal",
      "main-local",
      openExternalPayloadSchema,
      (url) => openExternalPayloadSchema.parse(url),
    ),
    focusWindow: defineNoArgProcedure<void, "main-local">("focusWindow", "main-local"),
  },
  thread: {
    getAgentStatuses: defineIpcProcedure<
      [string[]?],
      GetAgentStatusesPayload,
      AgentStatusesResponse,
      "supervisor"
    >("getAgentStatuses", "supervisor", getAgentStatusesPayloadSchema, (wslDistros) =>
      getAgentStatusesPayloadSchema.parse({ wslDistros: wslDistros ?? [] }),
    ),
    getThreadSnapshots: defineNoArgProcedure<ThreadRuntimeSnapshot[], "supervisor">(
      "getThreadSnapshots",
      "supervisor",
    ),
    startThread: definePayloadProcedure<StartThreadPayload, StartThreadResult, "supervisor">(
      "startThread",
      "supervisor",
      startThreadPayloadSchema,
    ),
    sendThreadInput: definePayloadProcedure<SendThreadInputPayload, void, "supervisor">(
      "sendThreadInput",
      "supervisor",
      sendThreadInputPayloadSchema,
    ),
    interruptThread: definePayloadProcedure<InterruptThreadPayload, void, "supervisor">(
      "interruptThread",
      "supervisor",
      interruptThreadPayloadSchema,
    ),
    setPendingSteer: definePayloadProcedure<SetPendingSteerPayload, void, "supervisor">(
      "setPendingSteer",
      "supervisor",
      setPendingSteerPayloadSchema,
    ),
    clearPendingSteer: definePayloadProcedure<ClearPendingSteerPayload, void, "supervisor">(
      "clearPendingSteer",
      "supervisor",
      clearPendingSteerPayloadSchema,
    ),
    writeTerminal: definePayloadProcedure<WriteTerminalPayload, void, "supervisor">(
      "writeTerminal",
      "supervisor",
      writeTerminalPayloadSchema,
    ),
    resizeTerminal: definePayloadProcedure<ResizeTerminalPayload, void, "supervisor">(
      "resizeTerminal",
      "supervisor",
      resizeTerminalPayloadSchema,
    ),
    resolveThreadServerRequest: definePayloadProcedure<
      ResolveThreadServerRequestPayload,
      void,
      "supervisor"
    >("resolveThreadServerRequest", "supervisor", resolveThreadServerRequestPayloadSchema),
    closeThread: definePayloadProcedure<CloseThreadPayload, void, "supervisor">(
      "closeThread",
      "supervisor",
      closeThreadPayloadSchema,
    ),
    startShell: definePayloadProcedure<StartShellPayload, void, "supervisor">(
      "startShell",
      "supervisor",
      startShellPayloadSchema,
    ),
    extractContext: definePayloadProcedure<
      ExtractContextPayload,
      ExtractContextResult,
      "supervisor"
    >("extractContext", "supervisor", extractContextPayloadSchema),
    cancelExtractContext: definePayloadProcedure<{ threadId: string }, void, "supervisor">(
      "cancelExtractContext",
      "supervisor",
      readThreadPayloadSchema,
    ),
    readTerminalScrollback: definePayloadProcedure<{ threadId: string }, string, "supervisor">(
      "readTerminalScrollback",
      "supervisor",
      readThreadPayloadSchema,
    ),
  },
  git: {
    getGitStatus: definePayloadProcedure<GetGitStatusPayload, GitStatusResult, "supervisor">(
      "getGitStatus",
      "supervisor",
      getGitStatusPayloadSchema,
    ),
    getGitDiff: definePayloadProcedure<GetGitDiffPayload, GitDiffResult, "supervisor">(
      "getGitDiff",
      "supervisor",
      getGitDiffPayloadSchema,
    ),
    getGitDiffBatch: definePayloadProcedure<
      GetGitDiffBatchPayload,
      GitDiffBatchResult,
      "supervisor"
    >("getGitDiffBatch", "supervisor", getGitDiffBatchPayloadSchema),
    getGitFileContent: definePayloadProcedure<
      GetGitFileContentPayload,
      GitFileContentResult,
      "supervisor"
    >("getGitFileContent", "supervisor", getGitFileContentPayloadSchema),
    gitStage: definePayloadProcedure<GitStagePayload, void, "supervisor">(
      "gitStage",
      "supervisor",
      gitStagePayloadSchema,
    ),
    gitUnstage: definePayloadProcedure<GitUnstagePayload, void, "supervisor">(
      "gitUnstage",
      "supervisor",
      gitUnstagePayloadSchema,
    ),
    gitRevert: definePayloadProcedure<GitRevertPayload, void, "supervisor">(
      "gitRevert",
      "supervisor",
      gitRevertPayloadSchema,
    ),
    gitStageAll: definePayloadProcedure<GitStageAllPayload, void, "supervisor">(
      "gitStageAll",
      "supervisor",
      gitStageAllPayloadSchema,
    ),
    gitUnstageAll: definePayloadProcedure<GitUnstageAllPayload, void, "supervisor">(
      "gitUnstageAll",
      "supervisor",
      gitUnstageAllPayloadSchema,
    ),
    gitRevertAll: definePayloadProcedure<GitRevertAllPayload, void, "supervisor">(
      "gitRevertAll",
      "supervisor",
      gitRevertAllPayloadSchema,
    ),
    gitCommit: definePayloadProcedure<GitCommitPayload, GitCommitResult, "supervisor">(
      "gitCommit",
      "supervisor",
      gitCommitPayloadSchema,
    ),
    generateCommitMessage: definePayloadProcedure<
      GenerateCommitMessagePayload,
      GenerateCommitMessageResult,
      "supervisor"
    >("generateCommitMessage", "supervisor", generateCommitMessagePayloadSchema),
    generateTitle: definePayloadProcedure<GenerateTitlePayload, GenerateTitleResult, "supervisor">(
      "generateTitle",
      "supervisor",
      generateTitlePayloadSchema,
    ),
    generatePrSummary: definePayloadProcedure<
      GeneratePrSummaryPayload,
      GeneratePrSummaryResult,
      "supervisor"
    >("generatePrSummary", "supervisor", generatePrSummaryPayloadSchema),
    gitListBranches: definePayloadProcedure<
      GetGitBranchesPayload,
      GitBranchListResult,
      "supervisor"
    >("gitListBranches", "supervisor", getGitBranchesPayloadSchema),
    gitFetch: definePayloadProcedure<GitFetchPayload, void, "supervisor">(
      "gitFetch",
      "supervisor",
      gitFetchPayloadSchema,
    ),
    gitListWorktrees: definePayloadProcedure<
      GitListWorktreesPayload,
      GitWorktreeListResult,
      "supervisor"
    >("gitListWorktrees", "supervisor", gitListWorktreesPayloadSchema),
    gitAddWorktree: definePayloadProcedure<
      GitAddWorktreePayload,
      GitAddWorktreeResult,
      "supervisor"
    >("gitAddWorktree", "supervisor", gitAddWorktreePayloadSchema),
    gitRemoveWorktree: definePayloadProcedure<GitRemoveWorktreePayload, void, "supervisor">(
      "gitRemoveWorktree",
      "supervisor",
      gitRemoveWorktreePayloadSchema,
    ),
    gitPruneWorktrees: definePayloadProcedure<GitPruneWorktreesPayload, void, "supervisor">(
      "gitPruneWorktrees",
      "supervisor",
      gitPruneWorktreesPayloadSchema,
    ),
    gitDeleteBranch: definePayloadProcedure<GitDeleteBranchPayload, void, "supervisor">(
      "gitDeleteBranch",
      "supervisor",
      gitDeleteBranchPayloadSchema,
    ),
    gitSwitchBranch: definePayloadProcedure<
      GitSwitchBranchPayload,
      GitSwitchBranchResult,
      "supervisor"
    >("gitSwitchBranch", "supervisor", gitSwitchBranchPayloadSchema),
    gitPull: definePayloadProcedure<GitPullPayload, void, "supervisor">(
      "gitPull",
      "supervisor",
      gitPullPayloadSchema,
    ),
    gitPullRebase: definePayloadProcedure<GitPullPayload, void, "supervisor">(
      "gitPullRebase",
      "supervisor",
      gitPullPayloadSchema,
    ),
    gitPush: definePayloadProcedure<GitPushPayload, void, "supervisor">(
      "gitPush",
      "supervisor",
      gitPushPayloadSchema,
    ),
    gitSync: definePayloadProcedure<GitSyncPayload, GitSyncResult, "supervisor">(
      "gitSync",
      "supervisor",
      gitSyncPayloadSchema,
    ),
    gitSyncRebase: definePayloadProcedure<GitSyncPayload, GitSyncResult, "supervisor">(
      "gitSyncRebase",
      "supervisor",
      gitSyncPayloadSchema,
    ),
    gitProjectSnapshot: definePayloadProcedure<
      GitProjectSnapshotPayload,
      GitProjectSnapshotResult,
      "supervisor"
    >("gitProjectSnapshot", "supervisor", gitProjectSnapshotPayloadSchema),
    gitWorktreeStatusBatch: definePayloadProcedure<
      GitWorktreeStatusBatchPayload,
      GitWorktreeStatusBatchResult,
      "supervisor"
    >("gitWorktreeStatusBatch", "supervisor", gitWorktreeStatusBatchPayloadSchema),
    gitGetWorktreeSourceBranch: definePayloadProcedure<
      GitGetWorktreeSourceBranchPayload,
      GitGetWorktreeSourceBranchResult,
      "supervisor"
    >("gitGetWorktreeSourceBranch", "supervisor", gitGetWorktreeSourceBranchPayloadSchema),
    gitMergeToSource: definePayloadProcedure<
      GitMergeToSourcePayload,
      GitMergeToSourceResult,
      "supervisor"
    >("gitMergeToSource", "supervisor", gitMergeToSourcePayloadSchema),
    gitPullFromSource: definePayloadProcedure<
      GitPullFromSourcePayload,
      GitPullFromSourceResult,
      "supervisor"
    >("gitPullFromSource", "supervisor", gitPullFromSourcePayloadSchema),
    gitAbortMerge: definePayloadProcedure<GitAbortMergePayload, void, "supervisor">(
      "gitAbortMerge",
      "supervisor",
      gitAbortMergePayloadSchema,
    ),
    gitFinishMerge: definePayloadProcedure<
      GitFinishMergePayload,
      GitFinishMergeResult,
      "supervisor"
    >("gitFinishMerge", "supervisor", gitFinishMergePayloadSchema),
    gitWatchProject: definePayloadProcedure<GitWatchProjectPayload, void, "supervisor">(
      "gitWatchProject",
      "supervisor",
      gitWatchProjectPayloadSchema,
    ),
    gitWatchWorktrees: definePayloadProcedure<GitWatchWorktreesPayload, void, "supervisor">(
      "gitWatchWorktrees",
      "supervisor",
      gitWatchWorktreesPayloadSchema,
    ),
    gitUnwatchProject: definePayloadProcedure<GitUnwatchProjectPayload, void, "supervisor">(
      "gitUnwatchProject",
      "supervisor",
      gitUnwatchProjectPayloadSchema,
    ),
  },
  projectTree: {
    searchProjectFiles: definePayloadProcedure<
      SearchProjectFilesPayload,
      SearchProjectFilesResult,
      "supervisor"
    >("searchProjectFiles", "supervisor", searchProjectFilesPayloadSchema),
    listProjectTree: definePayloadProcedure<
      ListProjectTreePayload,
      ListProjectTreeResult,
      "supervisor"
    >("listProjectTree", "supervisor", listProjectTreePayloadSchema),
    searchProjectTree: definePayloadProcedure<
      SearchProjectTreePayload,
      SearchProjectTreeResult,
      "supervisor"
    >("searchProjectTree", "supervisor", searchProjectTreePayloadSchema),
    readProjectFile: definePayloadProcedure<
      ReadProjectFilePayload,
      ReadProjectFileResult,
      "supervisor"
    >("readProjectFile", "supervisor", readProjectFilePayloadSchema),
    writeProjectFile: definePayloadProcedure<
      WriteProjectFilePayload,
      WriteProjectFileResult,
      "supervisor"
    >("writeProjectFile", "supervisor", writeProjectFilePayloadSchema),
    createProjectEntry: definePayloadProcedure<CreateProjectEntryPayload, void, "supervisor">(
      "createProjectEntry",
      "supervisor",
      createProjectEntryPayloadSchema,
    ),
    renameProjectEntry: definePayloadProcedure<RenameProjectEntryPayload, void, "supervisor">(
      "renameProjectEntry",
      "supervisor",
      renameProjectEntryPayloadSchema,
    ),
    moveProjectEntry: definePayloadProcedure<MoveProjectEntryPayload, void, "supervisor">(
      "moveProjectEntry",
      "supervisor",
      moveProjectEntryPayloadSchema,
    ),
    deleteProjectEntry: definePayloadProcedure<DeleteProjectEntryPayload, void, "supervisor">(
      "deleteProjectEntry",
      "supervisor",
      deleteProjectEntryPayloadSchema,
    ),
    revealProjectEntry: definePayloadProcedure<RevealProjectEntryPayload, void, "main-local">(
      "revealProjectEntry",
      "main-local",
      revealProjectEntryPayloadSchema,
    ),
    detectSetupScript: definePayloadProcedure<
      DetectSetupScriptPayload,
      DetectSetupScriptResult,
      "supervisor"
    >("detectSetupScript", "supervisor", detectSetupScriptPayloadSchema),
  },
  github: {
    ghCheckAvailable: definePayloadProcedure<
      GetGitStatusPayload,
      GhCheckAvailableResult,
      "supervisor"
    >("ghCheckAvailable", "supervisor", getGitStatusPayloadSchema),
    ghCreatePr: definePayloadProcedure<GhCreatePrPayload, PrData, "supervisor">(
      "ghCreatePr",
      "supervisor",
      ghCreatePrPayloadSchema,
    ),
    ghGetPrForBranch: definePayloadProcedure<GhGetPrForBranchPayload, PrData | null, "supervisor">(
      "ghGetPrForBranch",
      "supervisor",
      ghGetPrForBranchPayloadSchema,
    ),
    ghMergePr: definePayloadProcedure<GhMergePrPayload, void, "supervisor">(
      "ghMergePr",
      "supervisor",
      ghMergePrPayloadSchema,
    ),
    ghClosePr: definePayloadProcedure<GhClosePrPayload, void, "supervisor">(
      "ghClosePr",
      "supervisor",
      ghClosePrPayloadSchema,
    ),
    ghReopenPr: definePayloadProcedure<GhReopenPrPayload, void, "supervisor">(
      "ghReopenPr",
      "supervisor",
      ghReopenPrPayloadSchema,
    ),
    ghMarkPrReady: definePayloadProcedure<GhMarkPrReadyPayload, void, "supervisor">(
      "ghMarkPrReady",
      "supervisor",
      ghMarkPrReadyPayloadSchema,
    ),
    ghGetPrChecks: definePayloadProcedure<GhGetPrChecksPayload, GhGetPrChecksResult, "supervisor">(
      "ghGetPrChecks",
      "supervisor",
      ghGetPrChecksPayloadSchema,
    ),
    ghGetPrFiles: definePayloadProcedure<GhGetPrFilesPayload, GhGetPrFilesResult, "supervisor">(
      "ghGetPrFiles",
      "supervisor",
      ghGetPrFilesPayloadSchema,
    ),
    ghGetPrDiff: definePayloadProcedure<GhGetPrDiffPayload, GhGetPrDiffResult, "supervisor">(
      "ghGetPrDiff",
      "supervisor",
      ghGetPrDiffPayloadSchema,
    ),
    ghSubmitPrReview: definePayloadProcedure<GhSubmitPrReviewPayload, void, "supervisor">(
      "ghSubmitPrReview",
      "supervisor",
      ghSubmitPrReviewPayloadSchema,
    ),
    ghUpdatePrBranch: definePayloadProcedure<GhUpdatePrBranchPayload, void, "supervisor">(
      "ghUpdatePrBranch",
      "supervisor",
      ghUpdatePrBranchPayloadSchema,
    ),
  },
  settings: {
    getSharedSettings: defineNoArgProcedure<SharedSettings, "main-local">(
      "getSharedSettings",
      "main-local",
    ),
    setSharedSettings: definePayloadProcedure<SharedSettingsInput, void, "main-local">(
      "setSharedSettings",
      "main-local",
      z.custom<SharedSettingsInput>(),
    ),
    setWindowChrome: definePayloadProcedure<WindowChromePayload, void, "main-local">(
      "setWindowChrome",
      "main-local",
      windowChromePayloadSchema,
    ),
  },
  db: {
    dbGetProjects: defineNoArgProcedure<Project[], "main-local">("dbGetProjects", "main-local"),
    dbGetThreads: defineNoArgProcedure<Thread[], "main-local">("dbGetThreads", "main-local"),
    dbGetState: defineIpcProcedure<[string], string, string | null, "main-local">(
      "dbGetState",
      "main-local",
      dbStateKeySchema,
      (key) => dbStateKeySchema.parse(key),
    ),
    dbSetState: defineIpcProcedure<
      [string, string],
      z.infer<typeof dbStatePayloadSchema>,
      void,
      "main-local"
    >("dbSetState", "main-local", dbStatePayloadSchema, (key, value) =>
      dbStatePayloadSchema.parse({ key, value }),
    ),
    dbUpsertProject: definePayloadProcedure<Project, void, "main-local">(
      "dbUpsertProject",
      "main-local",
      projectSchema,
    ),
    dbUpsertThread: definePayloadProcedure<Thread, void, "main-local">(
      "dbUpsertThread",
      "main-local",
      threadSchema,
    ),
    dbDeleteThread: defineIpcProcedure<
      [string],
      z.infer<typeof dbDeleteThreadPayloadSchema>,
      void,
      "main-local"
    >("dbDeleteThread", "main-local", dbDeleteThreadPayloadSchema, (threadId) =>
      dbDeleteThreadPayloadSchema.parse({ threadId }),
    ),
    dbDeleteProject: defineIpcProcedure<
      [string],
      z.infer<typeof dbDeleteProjectPayloadSchema>,
      void,
      "main-local"
    >("dbDeleteProject", "main-local", dbDeleteProjectPayloadSchema, (projectId) =>
      dbDeleteProjectPayloadSchema.parse({ projectId }),
    ),
    dbSyncAll: defineIpcProcedure<
      [Project[], Thread[], string],
      z.infer<typeof dbSyncAllPayloadSchema>,
      void,
      "main-local"
    >("dbSyncAll", "main-local", dbSyncAllPayloadSchema, (projects, threads, viewJson) =>
      dbSyncAllPayloadSchema.parse({ projects, threads, viewJson }),
    ),
    dbGetThreadRuntimeItems: defineIpcProcedure<
      [string],
      z.infer<typeof dbGetRuntimeItemsPayloadSchema>,
      PersistedRuntimeItem[],
      "main-local"
    >("dbGetThreadRuntimeItems", "main-local", dbGetRuntimeItemsPayloadSchema, (threadId) =>
      dbGetRuntimeItemsPayloadSchema.parse({ threadId }),
    ),
    dbReplaceThreadRuntimeItems: definePayloadProcedure<
      z.infer<typeof dbReplaceRuntimeItemsPayloadSchema>,
      void,
      "main-local"
    >("dbReplaceThreadRuntimeItems", "main-local", dbReplaceRuntimeItemsPayloadSchema),
  },
  updates: {
    checkForUpdate: defineNoArgProcedure<void, "main-local">("checkForUpdate", "main-local"),
    startUpdateDownload: defineNoArgProcedure<void, "main-local">(
      "startUpdateDownload",
      "main-local",
    ),
    installUpdate: defineNoArgProcedure<void, "main-local">("installUpdate", "main-local"),
  },
  lsp: {
    lspStart: definePayloadProcedure<LspStartPayload, void, "supervisor">(
      "lspStart",
      "supervisor",
      z.custom<LspStartPayload>(),
    ),
    lspStop: definePayloadProcedure<LspStopPayload, void, "supervisor">(
      "lspStop",
      "supervisor",
      z.custom<LspStopPayload>(),
    ),
    lspSendMessage: definePayloadProcedure<LspMessagePayload, void, "supervisor">(
      "lspSendMessage",
      "supervisor",
      z.custom<LspMessagePayload>(),
    ),
  },
} as const;

export const ipcProcedureMap = {
  pickFolder: groupedIpcProcedures.app.pickFolder,
  pickFiles: groupedIpcProcedures.app.pickFiles,
  saveClipboardImage: groupedIpcProcedures.app.saveClipboardImage,
  saveHandoffContext: groupedIpcProcedures.app.saveHandoffContext,
  listWslDistros: groupedIpcProcedures.app.listWslDistros,
  openExternal: groupedIpcProcedures.app.openExternal,
  focusWindow: groupedIpcProcedures.app.focusWindow,
  getAgentStatuses: groupedIpcProcedures.thread.getAgentStatuses,
  getThreadSnapshots: groupedIpcProcedures.thread.getThreadSnapshots,
  startThread: groupedIpcProcedures.thread.startThread,
  sendThreadInput: groupedIpcProcedures.thread.sendThreadInput,
  interruptThread: groupedIpcProcedures.thread.interruptThread,
  setPendingSteer: groupedIpcProcedures.thread.setPendingSteer,
  clearPendingSteer: groupedIpcProcedures.thread.clearPendingSteer,
  writeTerminal: groupedIpcProcedures.thread.writeTerminal,
  resizeTerminal: groupedIpcProcedures.thread.resizeTerminal,
  resolveThreadServerRequest: groupedIpcProcedures.thread.resolveThreadServerRequest,
  closeThread: groupedIpcProcedures.thread.closeThread,
  startShell: groupedIpcProcedures.thread.startShell,
  extractContext: groupedIpcProcedures.thread.extractContext,
  cancelExtractContext: groupedIpcProcedures.thread.cancelExtractContext,
  readTerminalScrollback: groupedIpcProcedures.thread.readTerminalScrollback,
  getGitStatus: groupedIpcProcedures.git.getGitStatus,
  getGitDiff: groupedIpcProcedures.git.getGitDiff,
  getGitDiffBatch: groupedIpcProcedures.git.getGitDiffBatch,
  getGitFileContent: groupedIpcProcedures.git.getGitFileContent,
  gitStage: groupedIpcProcedures.git.gitStage,
  gitUnstage: groupedIpcProcedures.git.gitUnstage,
  gitRevert: groupedIpcProcedures.git.gitRevert,
  gitStageAll: groupedIpcProcedures.git.gitStageAll,
  gitUnstageAll: groupedIpcProcedures.git.gitUnstageAll,
  gitRevertAll: groupedIpcProcedures.git.gitRevertAll,
  gitCommit: groupedIpcProcedures.git.gitCommit,
  generateCommitMessage: groupedIpcProcedures.git.generateCommitMessage,
  generateTitle: groupedIpcProcedures.git.generateTitle,
  generatePrSummary: groupedIpcProcedures.git.generatePrSummary,
  gitListBranches: groupedIpcProcedures.git.gitListBranches,
  gitFetch: groupedIpcProcedures.git.gitFetch,
  gitListWorktrees: groupedIpcProcedures.git.gitListWorktrees,
  gitAddWorktree: groupedIpcProcedures.git.gitAddWorktree,
  gitRemoveWorktree: groupedIpcProcedures.git.gitRemoveWorktree,
  gitPruneWorktrees: groupedIpcProcedures.git.gitPruneWorktrees,
  gitDeleteBranch: groupedIpcProcedures.git.gitDeleteBranch,
  gitSwitchBranch: groupedIpcProcedures.git.gitSwitchBranch,
  gitPull: groupedIpcProcedures.git.gitPull,
  gitPullRebase: groupedIpcProcedures.git.gitPullRebase,
  gitPush: groupedIpcProcedures.git.gitPush,
  gitSync: groupedIpcProcedures.git.gitSync,
  gitSyncRebase: groupedIpcProcedures.git.gitSyncRebase,
  gitGetWorktreeSourceBranch: groupedIpcProcedures.git.gitGetWorktreeSourceBranch,
  gitProjectSnapshot: groupedIpcProcedures.git.gitProjectSnapshot,
  gitWorktreeStatusBatch: groupedIpcProcedures.git.gitWorktreeStatusBatch,
  gitMergeToSource: groupedIpcProcedures.git.gitMergeToSource,
  gitPullFromSource: groupedIpcProcedures.git.gitPullFromSource,
  gitAbortMerge: groupedIpcProcedures.git.gitAbortMerge,
  gitFinishMerge: groupedIpcProcedures.git.gitFinishMerge,
  gitWatchProject: groupedIpcProcedures.git.gitWatchProject,
  gitWatchWorktrees: groupedIpcProcedures.git.gitWatchWorktrees,
  gitUnwatchProject: groupedIpcProcedures.git.gitUnwatchProject,
  searchProjectFiles: groupedIpcProcedures.projectTree.searchProjectFiles,
  listProjectTree: groupedIpcProcedures.projectTree.listProjectTree,
  searchProjectTree: groupedIpcProcedures.projectTree.searchProjectTree,
  readProjectFile: groupedIpcProcedures.projectTree.readProjectFile,
  writeProjectFile: groupedIpcProcedures.projectTree.writeProjectFile,
  createProjectEntry: groupedIpcProcedures.projectTree.createProjectEntry,
  renameProjectEntry: groupedIpcProcedures.projectTree.renameProjectEntry,
  moveProjectEntry: groupedIpcProcedures.projectTree.moveProjectEntry,
  deleteProjectEntry: groupedIpcProcedures.projectTree.deleteProjectEntry,
  revealProjectEntry: groupedIpcProcedures.projectTree.revealProjectEntry,
  detectSetupScript: groupedIpcProcedures.projectTree.detectSetupScript,
  ghCheckAvailable: groupedIpcProcedures.github.ghCheckAvailable,
  ghCreatePr: groupedIpcProcedures.github.ghCreatePr,
  ghGetPrForBranch: groupedIpcProcedures.github.ghGetPrForBranch,
  ghMergePr: groupedIpcProcedures.github.ghMergePr,
  ghClosePr: groupedIpcProcedures.github.ghClosePr,
  ghReopenPr: groupedIpcProcedures.github.ghReopenPr,
  ghMarkPrReady: groupedIpcProcedures.github.ghMarkPrReady,
  ghGetPrChecks: groupedIpcProcedures.github.ghGetPrChecks,
  ghGetPrFiles: groupedIpcProcedures.github.ghGetPrFiles,
  ghGetPrDiff: groupedIpcProcedures.github.ghGetPrDiff,
  ghSubmitPrReview: groupedIpcProcedures.github.ghSubmitPrReview,
  ghUpdatePrBranch: groupedIpcProcedures.github.ghUpdatePrBranch,
  getSharedSettings: groupedIpcProcedures.settings.getSharedSettings,
  setSharedSettings: groupedIpcProcedures.settings.setSharedSettings,
  setWindowChrome: groupedIpcProcedures.settings.setWindowChrome,
  dbGetProjects: groupedIpcProcedures.db.dbGetProjects,
  dbGetThreads: groupedIpcProcedures.db.dbGetThreads,
  dbGetState: groupedIpcProcedures.db.dbGetState,
  dbSetState: groupedIpcProcedures.db.dbSetState,
  dbUpsertProject: groupedIpcProcedures.db.dbUpsertProject,
  dbUpsertThread: groupedIpcProcedures.db.dbUpsertThread,
  dbDeleteThread: groupedIpcProcedures.db.dbDeleteThread,
  dbDeleteProject: groupedIpcProcedures.db.dbDeleteProject,
  dbSyncAll: groupedIpcProcedures.db.dbSyncAll,
  dbGetThreadRuntimeItems: groupedIpcProcedures.db.dbGetThreadRuntimeItems,
  dbReplaceThreadRuntimeItems: groupedIpcProcedures.db.dbReplaceThreadRuntimeItems,
  checkForUpdate: groupedIpcProcedures.updates.checkForUpdate,
  startUpdateDownload: groupedIpcProcedures.updates.startUpdateDownload,
  installUpdate: groupedIpcProcedures.updates.installUpdate,
  lspStart: groupedIpcProcedures.lsp.lspStart,
  lspStop: groupedIpcProcedures.lsp.lspStop,
  lspSendMessage: groupedIpcProcedures.lsp.lspSendMessage,
} as const;

export type IpcProcedureMap = typeof ipcProcedureMap;
export type IpcProcedureName = keyof IpcProcedureMap;

type ProcedureArgs<Name extends IpcProcedureName> = IpcProcedureMap[Name]["__types"]["args"];

export type IpcProcedurePayload<Name extends IpcProcedureName> =
  IpcProcedureMap[Name]["__types"]["payload"];

export type IpcProcedureResult<Name extends IpcProcedureName> =
  IpcProcedureMap[Name]["__types"]["result"];

export const MAIN_LOCAL_PROCEDURE_NAMES = [
  "pickFolder",
  "pickFiles",
  "saveClipboardImage",
  "saveHandoffContext",
  "openExternal",
  "focusWindow",
  "revealProjectEntry",
  "getSharedSettings",
  "setSharedSettings",
  "setWindowChrome",
  "dbGetProjects",
  "dbGetThreads",
  "dbGetState",
  "dbSetState",
  "dbUpsertProject",
  "dbUpsertThread",
  "dbDeleteThread",
  "dbDeleteProject",
  "dbSyncAll",
  "dbGetThreadRuntimeItems",
  "dbReplaceThreadRuntimeItems",
  "checkForUpdate",
  "startUpdateDownload",
  "installUpdate",
] as const satisfies readonly IpcProcedureName[];

export type MainLocalProcedureName = (typeof MAIN_LOCAL_PROCEDURE_NAMES)[number];
export type SupervisorProcedureName = Exclude<IpcProcedureName, MainLocalProcedureName>;

export type LightcodeInvokeBridge = {
  [Name in IpcProcedureName]: (...args: ProcedureArgs<Name>) => Promise<IpcProcedureResult<Name>>;
};

export type LightcodeBridge = LightcodeInvokeBridge & {
  platform: NodeJS.Platform;
  appVersion: string;
  /** True in the `pnpm dev` build; false in packaged releases. */
  isDev: boolean;
  electronVersion: string;
  onSupervisorEvent(listener: (event: SupervisorEvent) => void): () => void;
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
};

export function createInvokeBridge(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
): LightcodeInvokeBridge {
  const bridge = {} as LightcodeInvokeBridge;
  const names = Object.keys(ipcProcedureMap) as IpcProcedureName[];
  for (const name of names) {
    const procedure = ipcProcedureMap[name];
    (bridge as Record<IpcProcedureName, unknown>)[name] = (...args: unknown[]) =>
      invoke(procedure.channel, ...args);
  }
  return bridge;
}

export function parseIpcProcedureArgs<Name extends IpcProcedureName>(
  name: Name,
  args: unknown[],
): IpcProcedurePayload<Name> {
  const procedure = ipcProcedureMap[name];
  return (procedure.parseArgs as (...args: unknown[]) => IpcProcedurePayload<Name>)(...args);
}

export type MainLocalIpcHandlerMap = {
  [Name in MainLocalProcedureName]: (
    payload: IpcProcedurePayload<Name>,
  ) => Promise<IpcProcedureResult<Name>> | IpcProcedureResult<Name>;
};

export type SupervisorIpcHandlerMap = {
  [Name in SupervisorProcedureName]: (
    payload: IpcProcedurePayload<Name>,
  ) => Promise<IpcProcedureResult<Name>> | IpcProcedureResult<Name>;
};

export function defineMainLocalIpcHandlers<THandlers extends MainLocalIpcHandlerMap>(
  handlers: THandlers,
): THandlers {
  return handlers;
}

export function defineSupervisorIpcHandlers<THandlers extends SupervisorIpcHandlerMap>(
  handlers: THandlers,
): THandlers {
  return handlers;
}

export const IPC_EVENT_CHANNELS = {
  supervisorEvent: createChannel("supervisorEvent"),
  updateStatus: createChannel("updateStatus"),
} as const;

export type SupervisorRequest = {
  [Name in SupervisorProcedureName]: {
    id: string;
    type: Name;
    payload: IpcProcedurePayload<Name>;
  };
}[SupervisorProcedureName];

export type SupervisorReply =
  | { replyTo: string; ok: true; data: unknown }
  | { replyTo: string; ok: false; error: string };

export type SupervisorEvent =
  | { type: "thread-reset"; threadId: string }
  | { type: "thread-output"; threadId: string; data: string; outputLength: number }
  | { type: "thread-runtime-event"; threadId: string; event: RuntimeEvent }
  | { type: "thread-runtime-events"; threadId: string; events: RuntimeEvent[] }
  | {
      /**
       * One IPC envelope carrying buffered runtime events for any number of
       * threads. Emitted by the supervisor when more than one thread's batch
       * is ready in the same flush window. Avoids the per-thread IPC fan-out
       * that becomes expensive with 6-8 concurrent streaming sessions.
       */
      type: "thread-runtime-events-multi";
      batches: ReadonlyArray<{ threadId: string; events: RuntimeEvent[] }>;
    }
  | {
      type: "thread-server-request";
      threadId: string;
      requestId: string | number;
      method: string;
      params: unknown;
    }
  | {
      type: "thread-state";
      threadId: string;
      status: ThreadStatus;
      attention: ThreadAttention;
      config?: ThreadConfig;
      sessionRef?: { providerSessionId: string; discoveredAt: string };
      canResumeWithConfig: boolean;
      errorMessage?: string;
      /** Terminal: structured CLI hook (L1) vs terminal parsing (L2); server agents: `server`. */
      threadStatusSource?: ThreadStatusSource;
    }
  | {
      /**
       * Single staged steer message (or `null` to clear). Renderer mirrors this
       * into `pendingSteerByThreadId`. Only emitted for GUI-presentation
       * threads — terminal threads never produce this event.
       */
      type: "thread-pending-steer";
      threadId: string;
      pending: PendingSteerState | null;
    }
  | { type: "thread-exited"; threadId: string; exitCode: number | null }
  | {
      type: "thread-osc-notification";
      threadId: string;
      title: string;
      body: string;
    }
  | {
      type: "thread-osc-shell";
      threadId: string;
      event: OscShellEvent;
    }
  | { type: "windows-agent-statuses"; statuses: AgentStatus[] }
  | { type: "wsl-agent-statuses"; statuses: AgentStatus[] }
  | { type: "git-changed"; projectId: string }
  | { type: "project-tree-changed"; projectId: string }
  | { type: "lsp-message"; sessionId: string; message: unknown }
  | {
      type: "lsp-status";
      sessionId: string;
      status: LspSessionStatus;
      languageId: string;
      error?: string;
    };

export type UpdateStatus =
  | { type: "checking" }
  | { type: "update-available"; version: string }
  | { type: "update-not-available" }
  | {
      type: "downloading";
      percent: number;
      bytesPerSecond: number;
      transferred: number;
      total: number;
    }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string };
