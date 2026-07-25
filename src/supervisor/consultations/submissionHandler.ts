import {
  isMentionParseError,
  parseMention,
  type ConsultationRole,
  type MentionParseErrorCode,
} from "@/shared/consultations";
import type { ModelAlias } from "@/shared/modelAliases";
import type {
  ConsultationFinalisePayload,
  ConsultationPanelMemberInput,
  ConsultationSubmitErrorCode,
  ConsultationSubmitPanelPayload,
  ConsultationSubmitPayload,
  ConsultationSubmitResult,
} from "@/shared/contracts";
import type { ConsultationCoordinator, PanelMemberSpec } from "./coordinator";
import type { ConsultationRepository } from "./repository";

/**
 * Production consultation submission handler (Part 2). The single trusted path
 * from a raw thread message to the coordinator: parse the mention (the shared
 * parser is the source of truth — mention parsing is NOT duplicated in the
 * renderer), resolve role/provider/mode, validate the campaign-thread context,
 * then route to the coordinator's standard / panel / finalise flow. Returns the
 * durable record, or a structured error the renderer can display verbatim.
 */

export interface SubmissionHandlerDeps {
  coordinator: ConsultationCoordinator;
  repository: ConsultationRepository;
  /** The actor recorded on created consultations (defaults to the local user). */
  actor?: string;
  /** User-defined @mention aliases from shared settings. */
  readModelAliases?: () => readonly ModelAlias[];
}

const DEFAULT_ACTOR = "poracode-user";

/** Default panel composition when the user invokes `@panel` without naming members. */
export const DEFAULT_PANEL_MEMBERS: PanelMemberSpec[] = [
  { role: "strategic_reviewer", requiredOrOptional: "required" },
  { role: "figures_auditor", requiredOrOptional: "required" },
  { role: "challenger", requiredOrOptional: "optional" },
];

function parserErrorToSubmitError(
  code: MentionParseErrorCode,
  message: string,
  token: string | null,
): ConsultationSubmitResult {
  const mapped: ConsultationSubmitErrorCode =
    code === "unknown_mention"
      ? "unknown_mention"
      : code === "missing_instruction"
        ? "missing_instruction"
        : code === "ambiguous_mention"
          ? "ambiguous_mention"
          : "unsupported_provider";
  return { ok: false, code: mapped, message, token };
}

export class ConsultationSubmissionHandler {
  private readonly actor: string;

  constructor(private readonly deps: SubmissionHandlerDeps) {
    this.actor = deps.actor ?? DEFAULT_ACTOR;
  }

  /** Primary composer path: parse the mention and route by its resolved mode. */
  async submit(payload: ConsultationSubmitPayload): Promise<ConsultationSubmitResult> {
    const contextCheck = this.validateCampaignContext(payload.campaignGroupId);
    if (contextCheck) return contextCheck;

    const parsed = parseMention(payload.message, {
      modelAliases: this.deps.readModelAliases?.() ?? [],
    });
    if (isMentionParseError(parsed)) {
      return parserErrorToSubmitError(parsed.code, parsed.message, parsed.token);
    }

    const base = {
      parentProjectId: payload.projectId,
      parentThreadId: payload.parentThreadId,
      campaignGroupId: payload.campaignGroupId,
      originalMention: parsed.originalMention,
      instruction: parsed.instruction,
      actor: this.actor,
    };

    try {
      if (parsed.consultationMode === "panel") {
        const consultation = await this.deps.coordinator.panel({
          ...base,
          members: this.panelMembers(parsed.requestedProvider, undefined),
        });
        return { ok: true, consultation };
      }
      if (parsed.consultationMode === "finalise") {
        return this.finaliseWithIds(base, parsed.requestedProvider, undefined);
      }
      const consultation = await this.deps.coordinator.submit({
        ...base,
        role: parsed.resolvedRole,
        mode: parsed.consultationMode,
        ...(parsed.requestedProvider ? { requestedProvider: parsed.requestedProvider } : {}),
        ...(parsed.requestedModel ? { requestedModel: parsed.requestedModel } : {}),
        ...(parsed.requestedEffort ? { requestedEffort: parsed.requestedEffort } : {}),
      });
      return { ok: true, consultation };
    } catch (error) {
      return {
        ok: false,
        code: "internal_error",
        message: error instanceof Error ? error.message : "Failed to start the consultation.",
        token: null,
      };
    }
  }

  /** Explicit panel submission (UI-controlled membership). */
  async submitPanel(payload: ConsultationSubmitPanelPayload): Promise<ConsultationSubmitResult> {
    const contextCheck = this.validateCampaignContext(payload.campaignGroupId);
    if (contextCheck) return contextCheck;

    const instruction = this.extractInstruction(payload.message);
    if (instruction.length === 0) {
      return {
        ok: false,
        code: "missing_instruction",
        message: "@panel requires an instruction describing what the panel should assess.",
        token: "panel",
      };
    }
    try {
      const consultation = await this.deps.coordinator.panel({
        parentProjectId: payload.projectId,
        parentThreadId: payload.parentThreadId,
        campaignGroupId: payload.campaignGroupId,
        originalMention: "@panel",
        instruction,
        actor: this.actor,
        members: this.panelMembers(null, payload.members),
      });
      return { ok: true, consultation };
    } catch (error) {
      return {
        ok: false,
        code: "internal_error",
        message: error instanceof Error ? error.message : "Failed to start the panel.",
        token: null,
      };
    }
  }

  /** Explicit finalise submission (UI-controlled selection). */
  async finalise(payload: ConsultationFinalisePayload): Promise<ConsultationSubmitResult> {
    const contextCheck = this.validateCampaignContext(payload.campaignGroupId);
    if (contextCheck) return contextCheck;

    const instruction = this.extractInstruction(payload.message);
    return this.finaliseWithIds(
      {
        parentProjectId: payload.projectId,
        parentThreadId: payload.parentThreadId,
        campaignGroupId: payload.campaignGroupId,
        originalMention: "@finalise",
        instruction:
          instruction.length > 0 ? instruction : "Synthesise the completed consultations.",
        actor: this.actor,
      },
      null,
      payload.consultationIds,
    );
  }

  private validateCampaignContext(campaignGroupId: string): ConsultationSubmitResult | null {
    if (!campaignGroupId || campaignGroupId.trim().length === 0) {
      return {
        ok: false,
        code: "not_a_campaign_thread",
        message: "This thread is not linked to a campaign group, so consultations are unavailable.",
        token: null,
      };
    }
    return null;
  }

  private extractInstruction(message: string): string {
    const parsed = parseMention(message, {
      modelAliases: this.deps.readModelAliases?.() ?? [],
    });
    if (!isMentionParseError(parsed)) return parsed.instruction;
    return message.trim();
  }

  private panelMembers(
    requestedProvider: string | null,
    explicit: readonly ConsultationPanelMemberInput[] | undefined,
  ): PanelMemberSpec[] {
    const normalized: PanelMemberSpec[] =
      explicit && explicit.length >= 2
        ? explicit.map((member) => ({
            role: member.role,
            ...(member.requiredOrOptional ? { requiredOrOptional: member.requiredOrOptional } : {}),
            ...(member.requestedProvider ? { requestedProvider: member.requestedProvider } : {}),
            ...(member.requestedModel ? { requestedModel: member.requestedModel } : {}),
          }))
        : DEFAULT_PANEL_MEMBERS;
    if (!requestedProvider) return normalized;
    return normalized.map((member) => ({ ...member, requestedProvider }));
  }

  private finaliseWithIds(
    base: {
      parentProjectId: string;
      parentThreadId: string;
      campaignGroupId: string;
      originalMention: string;
      instruction: string;
      actor: string;
    },
    _requestedProvider: string | null,
    explicitIds: string[] | undefined,
  ): Promise<ConsultationSubmitResult> {
    const consultationIds =
      explicitIds && explicitIds.length > 0
        ? explicitIds
        : this.deps.repository
            .listByParentThread(base.parentThreadId)
            .filter((record) => record.status === "completed")
            .map((record) => record.id);
    if (consultationIds.length === 0) {
      return Promise.resolve({
        ok: false,
        code: "internal_error",
        message: "There are no completed consultations in this thread to finalise yet.",
        token: null,
      });
    }
    return this.deps.coordinator
      .finalise({ ...base, consultationIds })
      .then((consultation) => ({ ok: true, consultation }) satisfies ConsultationSubmitResult)
      .catch(
        (error): ConsultationSubmitResult => ({
          ok: false,
          code: "internal_error",
          message: error instanceof Error ? error.message : "Failed to finalise consultations.",
          token: null,
        }),
      );
  }
}

export type { ConsultationRole };
