import {
  PERMISSION_POLICY_VERSION,
  ProviderAuthError,
  assertCan,
  buildResultAttachment,
  canTransition,
  isTerminalStatus,
  resolveProvider,
  transition,
  type ConsultationMode,
  type ConsultationRecord,
  type ConsultationResultAttachment,
  type ConsultationResultRecord,
  type ConsultationRole,
  type ConsultationStatus,
  type PanelCompletionRule,
  type PanelMembershipRecord,
  type ProviderResolution,
} from "@/shared/consultations";
import { buildConsultationPrompt } from "./prompt";
import { redactText } from "./redact";
import { parseConsultationResult } from "./resultParser";
import type {
  ChildExecutionPort,
  ChildOutcome,
  Clock,
  IdGenerator,
  ProviderCatalogPort,
} from "./ports";
import type { ConsultationRepository } from "./repository";
import type { ContextPacketBuilder, BuiltContextPacket } from "./contextPacketBuilder";
import { panelCompletionMet, synthesisePanel } from "./panel";
import { synthesiseFinalise } from "./finalise";

/**
 * The ONE central consultation coordinator (Part 8). Owns the full lifecycle:
 * create queued → build+persist context → resolve provider/model → validate
 * permissions → launch the real child run → observe → capture a safe structured
 * result → persist → attach to the parent → complete. Also handles cancellation
 * (via the real child-cancel mechanism), linked retries, duplicate completion
 * events, panel/finalise orchestration and restart reconciliation.
 */
export interface CoordinatorDeps {
  repository: ConsultationRepository;
  contextPacketBuilder: ContextPacketBuilder;
  childExecution: ChildExecutionPort;
  providerCatalog: ProviderCatalogPort;
  clock: Clock;
  idGenerator: IdGenerator;
  attachResult?: (attachment: ConsultationResultAttachment) => void;
  panelPollIntervalMs?: number;
  panelMaxWaitMs?: number;
}

export interface SubmitRequest {
  parentProjectId: string;
  parentThreadId: string;
  campaignGroupId: string;
  role: ConsultationRole;
  originalMention: string;
  instruction: string;
  actor: string;
  requestedProvider?: string;
  requestedModel?: string;
  requestedEffort?: string;
  mode?: ConsultationMode;
}

export interface PanelMemberSpec {
  role: ConsultationRole;
  requiredOrOptional?: "required" | "optional";
  requestedProvider?: string;
  requestedModel?: string;
}

export interface PanelRequest {
  parentProjectId: string;
  parentThreadId: string;
  campaignGroupId: string;
  originalMention: string;
  instruction: string;
  actor: string;
  members: PanelMemberSpec[];
  completionRule?: PanelCompletionRule;
}

export interface FinaliseRequest {
  parentProjectId: string;
  parentThreadId: string;
  campaignGroupId: string;
  originalMention: string;
  instruction: string;
  actor: string;
  consultationIds: string[];
}

export interface ReconciliationReport {
  resumed: string[];
  markedOrphaned: string[];
  markedInterrupted: string[];
  cancelled: string[];
  preservedCompleted: number;
}

const ACTIVE_STATUSES: readonly ConsultationStatus[] = [
  "queued",
  "building_context",
  "ready",
  "running",
  "awaiting_input",
  "cancel_requested",
];

export class ConsultationCoordinator {
  private readonly inflight = new Map<string, AbortController>();
  private readonly pendingEffortByConsultationId = new Map<string, string>();
  private readonly attached = new Set<string>();
  private readonly listeners = new Set<(record: ConsultationRecord) => void>();
  private readonly panelPollIntervalMs: number;
  private readonly panelMaxWaitMs: number;
  private reconcileState: "not_started" | "running" | "completed" = "not_started";
  private reconcilePromise: Promise<ReconciliationReport> | null = null;

  constructor(private readonly deps: CoordinatorDeps) {
    this.panelPollIntervalMs = deps.panelPollIntervalMs ?? 25;
    this.panelMaxWaitMs = deps.panelMaxWaitMs ?? 60_000;
  }

  /** Subscribe to consultation status changes (the UI's live-update channel). */
  subscribe(listener: (record: ConsultationRecord) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get(id: string): ConsultationRecord | null {
    return this.deps.repository.getConsultation(id);
  }

  private emit(record: ConsultationRecord): void {
    for (const listener of this.listeners) listener(record);
  }

  /** Submit a standard (single-consultant) consultation; runs asynchronously. */
  async submit(request: SubmitRequest): Promise<ConsultationRecord> {
    const record = this.newRecord(request, request.role, request.mode ?? "standard", null);
    if (request.requestedEffort) {
      this.pendingEffortByConsultationId.set(record.id, request.requestedEffort);
    }
    this.save(record);
    void this.driveStandard(record.id);
    return record;
  }

  /** Cancel a consultation using the real child-run cancellation mechanism. */
  async cancel(id: string): Promise<ConsultationRecord | null> {
    const record = this.deps.repository.getConsultation(id);
    if (!record) return null;
    if (isTerminalStatus(record.status)) return record;

    const next = canTransition(record.status, "cancel_requested")
      ? transition(record, "cancel_requested", this.deps.clock.now())
      : transition(record, "cancelled", this.deps.clock.now());
    this.save(next);

    this.inflight.get(id)?.abort();
    if (next.childThreadOrRunId) {
      await this.cancelChildBestEffort(next.childThreadOrRunId);
    }
    if (next.consultationMode === "panel") {
      for (const member of this.deps.repository.listPanelMembers(id)) {
        await this.cancel(member.childConsultationId);
      }
    }
    if (next.status === "cancelled") this.attachToParent(next, null);
    return next;
  }

  /** Retry a failed/cancelled consultation as a NEW linked record (never mutates the original).
   * Panels retry as full panels with members, rules, and the original instruction intact. */
  async retry(id: string): Promise<ConsultationRecord | null> {
    const original = this.deps.repository.getConsultation(id);
    if (!original) return null;
    if (original.status !== "failed" && original.status !== "cancelled") return original;

    const now = this.deps.clock.now();
    if (original.consultationMode === "panel") {
      const originalMembers = this.deps.repository.listPanelMembers(id);
      return this.retryAsPanel(original, originalMembers);
    }
    return this.retryAsStandard(original, now);
  }

  private retryAsStandard(original: ConsultationRecord, now: string): ConsultationRecord {
    const retryRecord: ConsultationRecord = {
      id: this.deps.idGenerator.next(),
      parentProjectId: original.parentProjectId,
      parentThreadId: original.parentThreadId,
      campaignGroupId: original.campaignGroupId,
      childThreadOrRunId: null,
      originalMention: original.originalMention,
      originalInstruction: original.originalInstruction,
      resolvedRole: original.resolvedRole,
      requestedProvider: original.requestedProvider,
      actualProvider: null,
      requestedModel: original.requestedModel,
      actualModel: null,
      consultationMode:
        original.consultationMode === "panel" ? "standard" : original.consultationMode,
      status: "queued",
      contextPacketId: null,
      permissionPolicyVersion: original.permissionPolicyVersion,
      actor: original.actor,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      failureCode: null,
      safeFailureMessage: null,
      resultSummaryId: null,
      retryOfConsultationId: original.id,
    };
    this.save(retryRecord);
    void this.driveStandard(retryRecord.id);
    return retryRecord;
  }

  private retryAsPanel(
    original: ConsultationRecord,
    originalMembers: PanelMembershipRecord[],
  ): ConsultationRecord {
    const rule: PanelCompletionRule = original.panelCompletionRule ?? { kind: "all_required" };
    const panelRecord: ConsultationRecord = {
      ...this.newRecord(
        {
          parentProjectId: original.parentProjectId,
          parentThreadId: original.parentThreadId,
          campaignGroupId: original.campaignGroupId,
          originalMention: original.originalMention,
          instruction: original.originalInstruction,
          actor: original.actor,
        },
        "panel",
        "panel",
        original.id,
      ),
      panelCompletionRule: rule,
    };

    if (originalMembers.length < 2) {
      this.save(panelRecord);
      this.fail(
        panelRecord,
        "internal_error",
        "The original panel definition is incomplete and cannot be retried safely.",
      );
      return this.deps.repository.getConsultation(panelRecord.id) ?? panelRecord;
    }

    const members: PanelMemberSpec[] = [];
    for (const membership of originalMembers) {
      const child = this.deps.repository.getConsultation(membership.childConsultationId);
      if (!child) {
        this.save(panelRecord);
        this.fail(
          panelRecord,
          "internal_error",
          "A panel member record is missing, so the panel cannot be retried safely.",
        );
        return this.deps.repository.getConsultation(panelRecord.id) ?? panelRecord;
      }
      members.push({
        role: membership.memberRole,
        requiredOrOptional: membership.requiredOrOptional,
        ...(child.requestedProvider ? { requestedProvider: child.requestedProvider } : {}),
        ...(child.requestedModel ? { requestedModel: child.requestedModel } : {}),
      });
    }

    const request: PanelRequest = {
      parentProjectId: original.parentProjectId,
      parentThreadId: original.parentThreadId,
      campaignGroupId: original.campaignGroupId,
      originalMention: original.originalMention,
      instruction: original.originalInstruction,
      actor: original.actor,
      members,
      completionRule: rule,
    };
    this.save(panelRecord);
    // runPanel is the one canonical path that creates member records.
    void this.runPanel(panelRecord.id, request);
    return panelRecord;
  }

  /** Create a durable panel consultation backed by two or more REAL child consultations. */
  async panel(request: PanelRequest): Promise<ConsultationRecord> {
    if (request.members.length < 2) {
      throw new Error("A panel requires at least two member consultants");
    }
    const rule: PanelCompletionRule = request.completionRule ?? { kind: "all_required" };
    const record: ConsultationRecord = {
      ...this.newRecord(request, "panel", "panel", null),
      panelCompletionRule: rule,
    };
    this.save(record);
    void this.runPanel(record.id, { ...request, completionRule: rule });
    return record;
  }

  /** Synthesise already-completed consultations into one finalised record. */
  async finalise(request: FinaliseRequest): Promise<ConsultationRecord> {
    const record = this.newRecord(request, "finaliser", "finalise", null);
    this.save(record);
    void this.runFinalise(record.id, request);
    return record;
  }

  /**
   * Restart reconciliation (Part 13). Compares persisted records with actual
   * child state: resumes safe queued work, preserves completed work, marks
   * orphaned runs, and never double-launches a child or double-attaches a result.
   * Concurrent calls share the same promise. If reconciliation throws, the state
   * resets so the next call retries rather than silently skipping.
   */
  async reconcileOnStartup(): Promise<ReconciliationReport> {
    if (this.reconcileState === "completed") {
      return {
        resumed: [],
        markedOrphaned: [],
        markedInterrupted: [],
        cancelled: [],
        preservedCompleted: 0,
      };
    }
    if (this.reconcileState === "running" && this.reconcilePromise) {
      return this.reconcilePromise;
    }
    this.reconcileState = "running";
    this.reconcilePromise = this.runReconciliation();
    try {
      const report = await this.reconcilePromise;
      this.reconcileState = "completed";
      return report;
    } catch {
      this.reconcileState = "not_started";
      this.reconcilePromise = null;
      throw new Error("Consultation startup reconciliation failed and is retryable.");
    }
  }

  private async runReconciliation(): Promise<ReconciliationReport> {
    const report: ReconciliationReport = {
      resumed: [],
      markedOrphaned: [],
      markedInterrupted: [],
      cancelled: [],
      preservedCompleted: 0,
    };
    const active = this.deps.repository.listByStatuses(ACTIVE_STATUSES);
    for (const record of active) {
      switch (record.status) {
        case "queued":
          if (!this.inflight.has(record.id)) {
            report.resumed.push(record.id);
            void this.driveStandard(record.id);
          }
          break;
        case "building_context":
        case "ready":
          report.markedInterrupted.push(record.id);
          this.fail(
            record,
            "internal_error",
            "Interrupted by a restart before the child launched; retry to resume.",
          );
          break;
        case "running":
        case "awaiting_input":
          await this.reconcileRunning(record, report);
          break;
        case "cancel_requested": {
          if (record.childThreadOrRunId)
            await this.cancelChildBestEffort(record.childThreadOrRunId);
          const cancelled = transition(record, "cancelled", this.deps.clock.now());
          this.save(cancelled);
          this.attachToParent(cancelled, null);
          report.cancelled.push(record.id);
          break;
        }
        default:
          break;
      }
    }
    report.preservedCompleted = this.deps.repository.listByStatuses(["completed"]).length;
    return report;
  }

  private async reconcileRunning(
    record: ConsultationRecord,
    report: ReconciliationReport,
  ): Promise<void> {
    if (!record.childThreadOrRunId) {
      report.markedOrphaned.push(record.id);
      this.fail(
        record,
        "execution_failed",
        "Child run reference was lost across a restart (orphaned).",
      );
      return;
    }
    const state = await this.deps.childExecution.inspect(record.childThreadOrRunId);
    if (state === "active") {
      if (!this.inflight.has(record.id)) {
        report.resumed.push(record.id);
        void this.resumeObservation(record.id, record.childThreadOrRunId);
      }
    } else {
      report.markedOrphaned.push(record.id);
      this.fail(
        record,
        "execution_failed",
        "Child run was no longer present after a restart (orphaned).",
      );
    }
  }

  private newRecord(
    request: {
      parentProjectId: string;
      parentThreadId: string;
      campaignGroupId: string;
      originalMention: string;
      instruction: string;
      actor: string;
      requestedProvider?: string;
      requestedModel?: string;
    },
    role: ConsultationRole,
    mode: ConsultationMode,
    retryOf: string | null,
  ): ConsultationRecord {
    return {
      id: this.deps.idGenerator.next(),
      parentProjectId: request.parentProjectId,
      parentThreadId: request.parentThreadId,
      campaignGroupId: request.campaignGroupId,
      childThreadOrRunId: null,
      originalMention: request.originalMention,
      originalInstruction: request.instruction,
      resolvedRole: role,
      requestedProvider: request.requestedProvider ?? null,
      actualProvider: null,
      requestedModel: request.requestedModel ?? null,
      actualModel: null,
      consultationMode: mode,
      status: "queued",
      contextPacketId: null,
      permissionPolicyVersion: PERMISSION_POLICY_VERSION,
      actor: request.actor,
      createdAt: this.deps.clock.now(),
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      failureCode: null,
      safeFailureMessage: null,
      resultSummaryId: null,
      retryOfConsultationId: retryOf,
    };
  }

  private save(record: ConsultationRecord): void {
    this.deps.repository.saveConsultation(record);
    this.emit(record);
  }

  private persistTransition(
    record: ConsultationRecord,
    to: ConsultationStatus,
  ): ConsultationRecord {
    // Honour a concurrent cancellation/terminal state instead of overwriting it
    // with a stale in-flight copy (cancel() may have landed mid-step).
    const latest = this.deps.repository.getConsultation(record.id);
    if (latest && (latest.status === "cancel_requested" || isTerminalStatus(latest.status))) {
      return latest;
    }
    const next = transition(record, to, this.deps.clock.now());
    this.save(next);
    return next;
  }

  private async driveStandard(id: string): Promise<void> {
    if (this.inflight.has(id)) return;
    const controller = new AbortController();
    this.inflight.set(id, controller);
    try {
      await this.runStandard(id, controller.signal);
    } catch (error) {
      const record = this.deps.repository.getConsultation(id);
      if (record && !isTerminalStatus(record.status)) {
        this.fail(record, "internal_error", safeMessage(error));
      }
    } finally {
      this.inflight.delete(id);
    }
  }

  private async runStandard(id: string, signal: AbortSignal): Promise<void> {
    let record = this.deps.repository.getConsultation(id);
    if (!record || isTerminalStatus(record.status)) return;

    record = this.persistTransition(record, "building_context");
    let built: BuiltContextPacket;
    try {
      built = await this.deps.contextPacketBuilder.build({
        consultationId: id,
        parentProjectId: record.parentProjectId,
        parentThreadId: record.parentThreadId,
        campaignGroupId: record.campaignGroupId,
        role: record.resolvedRole,
        originalMention: record.originalMention,
        explicitTask: record.originalInstruction,
        signal,
      });
    } catch (error) {
      this.fail(record, "context_retrieval_failed", safeMessage(error));
      return;
    }
    record = { ...record, contextPacketId: built.record.id };
    record = this.persistTransition(record, "ready");

    let resolution: ProviderResolution;
    try {
      const catalog = await this.deps.providerCatalog.list();
      resolution = resolveProvider({
        role: record.resolvedRole,
        requestedProvider: record.requestedProvider,
        requestedModel: record.requestedModel,
        catalog,
      });
    } catch (error) {
      const code = error instanceof ProviderAuthError ? "auth_failure" : "provider_unavailable";
      this.fail(record, code, safeMessage(error));
      return;
    }
    record = {
      ...record,
      actualProvider: resolution.actualProvider,
      actualModel: resolution.actualModel,
    };
    this.save(record);

    try {
      assertCan(record.resolvedRole, "read_campaign_context");
    } catch (error) {
      this.fail(record, "permission_denied", safeMessage(error));
      return;
    }

    // Cancellation may have landed while we were building context / resolving the
    // provider. Bail before launching a child we would immediately have to cancel.
    if (signal.aborted) {
      this.settleCancelled(record);
      return;
    }

    let childThreadOrRunId: string;
    try {
      const prompt = buildConsultationPrompt({
        role: record.resolvedRole,
        mode: record.consultationMode,
        instruction: record.originalInstruction,
        body: built.body,
      });
      const effort = this.pendingEffortByConsultationId.get(id);
      this.pendingEffortByConsultationId.delete(id);
      const launched = await this.deps.childExecution.launch({
        parentThreadId: record.parentThreadId,
        provider: resolution.actualProvider,
        model: resolution.actualModel,
        prompt,
        title: `Consultation · ${record.resolvedRole}`,
        ...(effort ? { effort } : {}),
      });
      childThreadOrRunId = launched.childThreadOrRunId;
    } catch (error) {
      this.fail(record, "child_launch_failed", safeMessage(error));
      return;
    }
    record = { ...record, childThreadOrRunId };
    record = this.persistTransition(record, "running");

    await this.observeAndFinalize(record, childThreadOrRunId, signal);
  }

  private async resumeObservation(id: string, childThreadOrRunId: string): Promise<void> {
    if (this.inflight.has(id)) return;
    const controller = new AbortController();
    this.inflight.set(id, controller);
    try {
      const record = this.deps.repository.getConsultation(id);
      if (!record || isTerminalStatus(record.status)) return;
      await this.observeAndFinalize(record, childThreadOrRunId, controller.signal);
    } catch (error) {
      const record = this.deps.repository.getConsultation(id);
      if (record && !isTerminalStatus(record.status)) {
        this.fail(record, "internal_error", safeMessage(error));
      }
    } finally {
      this.inflight.delete(id);
    }
  }

  private async observeAndFinalize(
    record: ConsultationRecord,
    childThreadOrRunId: string,
    signal: AbortSignal,
  ): Promise<void> {
    let outcome: ChildOutcome;
    try {
      outcome = await this.deps.childExecution.awaitOutcome(childThreadOrRunId, signal);
    } catch (error) {
      if (signal.aborted) {
        this.settleCancelled(record);
        return;
      }
      this.fail(record, "execution_failed", safeMessage(error));
      return;
    }

    if (signal.aborted || outcome.status === "cancelled") {
      this.settleCancelled(record);
      return;
    }
    if (outcome.status === "failed") {
      this.fail(
        record,
        "execution_failed",
        safeMessage(outcome.errorMessage ?? "Child run failed"),
      );
      return;
    }

    let result: ConsultationResultRecord;
    try {
      result = parseConsultationResult({
        id: this.deps.idGenerator.next(),
        consultationId: record.id,
        rawOutput: outcome.rawOutput,
        completedAt: this.deps.clock.now(),
      });
    } catch (error) {
      this.fail(record, "result_parse_failed", safeMessage(error));
      return;
    }
    this.deps.repository.saveResult(result);
    let completed: ConsultationRecord = { ...record, resultSummaryId: result.id };
    completed = this.persistTransition(completed, "completed");
    this.attachToParent(completed, result);
  }

  private settleCancelled(record: ConsultationRecord): void {
    const current = this.deps.repository.getConsultation(record.id) ?? record;
    if (isTerminalStatus(current.status)) return;
    const cancelled = transition(current, "cancelled", this.deps.clock.now());
    this.save(cancelled);
    this.attachToParent(cancelled, null);
  }

  private fail(
    record: ConsultationRecord,
    code: ConsultationRecord["failureCode"],
    message: string,
  ): void {
    const current = this.deps.repository.getConsultation(record.id) ?? record;
    if (isTerminalStatus(current.status)) return;
    // A concurrent cancellation wins over a failure arriving at the same moment.
    if (current.status === "cancel_requested") {
      this.settleCancelled(current);
      return;
    }
    const withFailure: ConsultationRecord = {
      ...current,
      failureCode: code,
      safeFailureMessage: message,
    };
    const failed = transition(withFailure, "failed", this.deps.clock.now());
    this.save(failed);
    this.attachToParent(failed, null);
  }

  private attachToParent(
    record: ConsultationRecord,
    result: ConsultationResultRecord | null,
  ): void {
    if (!this.deps.attachResult) return;
    if (this.attached.has(record.id)) return;
    this.attached.add(record.id);
    this.deps.attachResult(buildResultAttachment(record, result));
  }

  private async cancelChildBestEffort(childThreadOrRunId: string): Promise<void> {
    try {
      await this.deps.childExecution.cancel(childThreadOrRunId);
    } catch {
      // Cancellation is best-effort; the child may already be gone.
    }
  }

  private async runPanel(panelId: string, request: PanelRequest): Promise<void> {
    let panel = this.deps.repository.getConsultation(panelId);
    if (!panel) return;
    panel = this.persistTransition(panel, "building_context");

    const rule: PanelCompletionRule = panel.panelCompletionRule ??
      request.completionRule ?? { kind: "all_required" };
    let sequence = 0;
    for (const spec of request.members) {
      const memberRecord = this.newRecord(
        {
          parentProjectId: request.parentProjectId,
          parentThreadId: request.parentThreadId,
          campaignGroupId: request.campaignGroupId,
          originalMention: request.originalMention,
          instruction: request.instruction,
          actor: request.actor,
          ...(spec.requestedProvider ? { requestedProvider: spec.requestedProvider } : {}),
          ...(spec.requestedModel ? { requestedModel: spec.requestedModel } : {}),
        },
        spec.role,
        "standard",
        null,
      );
      this.save(memberRecord);
      this.deps.repository.savePanelMembership({
        parentPanelConsultationId: panelId,
        childConsultationId: memberRecord.id,
        memberRole: spec.role,
        requiredOrOptional: spec.requiredOrOptional ?? "required",
        sequenceOrWeight: sequence,
      });
      sequence += 1;
      void this.driveStandard(memberRecord.id);
    }

    panel = this.persistTransition(panel, "ready");
    panel = this.persistTransition(panel, "running");

    const controller = new AbortController();
    this.inflight.set(panelId, controller);
    try {
      await this.waitForPanelCompletion(panelId, rule, controller.signal);
    } finally {
      this.inflight.delete(panelId);
    }

    panel = this.deps.repository.getConsultation(panelId);
    if (!panel || isTerminalStatus(panel.status)) return;
    if (controller.signal.aborted || panel.status === "cancel_requested") {
      const cancelled = transition(panel, "cancelled", this.deps.clock.now());
      this.save(cancelled);
      this.attachToParent(cancelled, null);
      return;
    }

    const members = this.deps.repository.listPanelMembers(panelId);
    const memberInputs = members.map((membership) => {
      const memberRecord = this.deps.repository.getConsultation(membership.childConsultationId);
      const result = memberRecord?.resultSummaryId
        ? this.deps.repository.getResult(memberRecord.resultSummaryId)
        : null;
      return { membership, record: memberRecord, result };
    });

    const synthesis = synthesisePanel({ instruction: request.instruction, members: memberInputs });
    const resultRecord: ConsultationResultRecord = {
      id: this.deps.idGenerator.next(),
      consultationId: panelId,
      ...synthesis,
      completedAt: this.deps.clock.now(),
    };
    this.deps.repository.saveResult(resultRecord);
    panel = { ...panel, resultSummaryId: resultRecord.id };
    panel = this.persistTransition(panel, "completed");
    this.attachToParent(panel, resultRecord);
  }

  private async waitForPanelCompletion(
    panelId: string,
    rule: PanelCompletionRule,
    signal: AbortSignal,
  ): Promise<void> {
    const deadline = Date.now() + this.panelMaxWaitMs;
    for (;;) {
      if (signal.aborted) return;
      const members = this.deps.repository.listPanelMembers(panelId).map((membership) => {
        const record = this.deps.repository.getConsultation(membership.childConsultationId);
        return { record, requiredOrOptional: membership.requiredOrOptional };
      });
      if (panelCompletionMet(members, rule)) return;
      if (Date.now() >= deadline) return;
      await sleep(this.panelPollIntervalMs);
    }
  }

  private async runFinalise(id: string, request: FinaliseRequest): Promise<void> {
    let record = this.deps.repository.getConsultation(id);
    if (!record) return;
    record = this.persistTransition(record, "building_context");

    const selected: Array<{ record: ConsultationRecord; result: ConsultationResultRecord | null }> =
      [];
    const skippedNonCompleted: Array<{ id: string; status: ConsultationStatus }> = [];
    for (const consultationId of request.consultationIds) {
      const consultation = this.deps.repository.getConsultation(consultationId);
      if (!consultation) continue;
      if (consultation.status !== "completed") {
        skippedNonCompleted.push({ id: consultationId, status: consultation.status });
        continue;
      }
      const result = consultation.resultSummaryId
        ? this.deps.repository.getResult(consultation.resultSummaryId)
        : null;
      selected.push({ record: consultation, result });
    }

    if (selected.length === 0) {
      this.fail(record, "internal_error", "No completed consultations were provided to finalise.");
      return;
    }

    record = this.persistTransition(record, "ready");
    record = this.persistTransition(record, "running");

    const synthesis = synthesiseFinalise({
      instruction: request.instruction,
      consultations: selected,
      skippedNonCompleted,
    });
    const resultRecord: ConsultationResultRecord = {
      id: this.deps.idGenerator.next(),
      consultationId: id,
      ...synthesis,
      completedAt: this.deps.clock.now(),
    };
    this.deps.repository.saveResult(resultRecord);
    record = { ...record, resultSummaryId: resultRecord.id };
    record = this.persistTransition(record, "completed");
    this.attachToParent(record, resultRecord);
  }
}

function safeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactText(raw).text.slice(0, 400);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
