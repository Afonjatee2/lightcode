/**
 * Public boundary for the Phase 4 consultation backend. The renderer/parser
 * (Worker 2) and the supervisor runtime import from here. Domain types live in
 * `@/shared/consultations`; this barrel exposes the coordinator API, ports,
 * persistence binding and test harness.
 */

export { ConsultationCoordinator } from "./coordinator";
export type {
  CoordinatorDeps,
  SubmitRequest,
  PanelRequest,
  PanelMemberSpec,
  FinaliseRequest,
  ReconciliationReport,
} from "./coordinator";

export type { ConsultationRepository } from "./repository";
export { SqliteConsultationRepository } from "./sqliteRepository";

export type {
  Clock,
  IdGenerator,
  ParentThreadPort,
  ChildExecutionPort,
  ChildLaunchInput,
  ChildOutcome,
  ChildOutcomeStatus,
  SummaryGenerator,
  ProviderCatalogPort,
} from "./ports";

export { ContextPacketBuilder } from "./contextPacketBuilder";
export type { ContextPacketBuilderDeps, BuildContextPacketInput, BuiltContextPacket } from "./contextPacketBuilder";

export { ThreadSummaryService } from "./threadSummaryService";
export type { ThreadSummaryServiceDeps } from "./threadSummaryService";

export { parseConsultationResult, ResultParseError } from "./resultParser";
export { buildConsultationPrompt } from "./prompt";
export { redactText, redactPacketBody, REDACTION_PLACEHOLDER } from "./redact";
export { contentHash } from "./hash";

export { panelCompletionMet, synthesisePanel } from "./panel";
export type { PanelMemberState, PanelMemberInput } from "./panel";
export type { PanelCompletionRule } from "@/shared/consultations";
export { synthesiseFinalise } from "./finalise";
export type { SynthesisBody, FinaliseInput } from "./finalise";

export { OrchestratorChildExecution } from "./orchestratorChildExecution";
export type { OrchestratorChildExecutionDeps } from "./orchestratorChildExecution";

export {
  SystemClock,
  UuidIdGenerator,
  CampaignAgentProviderCatalog,
  LoaderParentThreadPort,
  createSupervisorConsultationCoordinator,
} from "./supervisorAdapters";
export type { ParentThreadLoader, SupervisorConsultationWiring } from "./supervisorAdapters";

export {
  createParentThreadLoader,
  loadParentThreadMessages,
} from "./parentThreadLoader";

export { McpControlCentreGateway, CONTROL_CENTRE_MCP_SERVER_NAME } from "./controlCentreGateway";
export type { ControlCentreGateway, ControlCentreToolOutcome } from "./controlCentreGateway";

export {
  PoracodeCampaignContextProvider,
  ControlCentreUnavailableError,
} from "./poracodeCampaignContextProvider";

export { createResultAttacher, consultationResultItemId } from "./resultAttachment";
export type { ResultAttacherDeps } from "./resultAttachment";

export { ConsultationSubmissionHandler, DEFAULT_PANEL_MEMBERS } from "./submissionHandler";
export type { SubmissionHandlerDeps } from "./submissionHandler";

export {
  DeterministicClock,
  SequentialIdGenerator,
  FixtureChildExecution,
  FixtureParentThread,
  DeterministicSummaryGenerator,
  StaticProviderCatalog,
  InMemoryConsultationRepository,
  createTestCoordinator,
  waitForConsultation,
  waitForTerminal,
  WELL_FORMED_CHILD_OUTPUT,
} from "./testing";
