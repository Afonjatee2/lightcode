import { msg } from "@/shared/messages";
import type { ConsultationMode, ConsultationRole } from "./types";
import { CONSULTATION_MODES, CONSULTATION_ROLES } from "./types";

/**
 * Resolution mapping backend (NOT the mention parser — Worker 2 owns parsing).
 * The parser hands us normalized tokens; this module resolves a command token to
 * a role + mode, validates role ids, and resolves a requested provider/model
 * against the live catalog into the actual provider/model a child will run on.
 */

export interface ResolvedCommand {
  role: ConsultationRole;
  mode: ConsultationMode;
}

const ROLE_ALIASES: Record<string, ConsultationRole> = {
  daily_operator: "daily_operator",
  operator: "daily_operator",
  strategic_reviewer: "strategic_reviewer",
  strategist: "strategic_reviewer",
  strategy: "strategic_reviewer",
  figures_auditor: "figures_auditor",
  auditor: "figures_auditor",
  figures: "figures_auditor",
  researcher: "researcher",
  research: "researcher",
  challenger: "challenger",
  challenge: "challenger",
  verifier: "verifier",
  verify: "verifier",
  panel: "panel",
  finaliser: "finaliser",
  finalize: "finaliser",
  finalise: "finaliser",
  handoff_writer: "handoff_writer",
  handoff: "handoff_writer",
};

/** Commands whose role implies a non-standard execution mode. */
const MODE_FOR_ROLE: Partial<Record<ConsultationRole, ConsultationMode>> = {
  panel: "panel",
  finaliser: "finalise",
};

/** Validate a raw role id (no aliasing). */
export function resolveRole(roleId: string): ConsultationRole | null {
  const normalized = roleId.trim().toLowerCase();
  return (CONSULTATION_ROLES as readonly string[]).includes(normalized)
    ? (normalized as ConsultationRole)
    : null;
}

/**
 * Resolve a command token (role name, alias, or intent verb) to a role + mode.
 * Returns null when the token is not a recognised campaign command.
 */
export function resolveCommand(command: string): ResolvedCommand | null {
  const normalized = command.trim().toLowerCase().replace(/^@/, "");
  if (normalized.length === 0) return null;
  const role = ROLE_ALIASES[normalized];
  if (!role) return null;
  return { role, mode: MODE_FOR_ROLE[role] ?? "standard" };
}

export function isConsultationMode(value: string): value is ConsultationMode {
  return (CONSULTATION_MODES as readonly string[]).includes(value);
}

/** A provider entry the coordinator knows how to launch. */
export interface AvailableProvider {
  provider: string;
  models: string[];
  authenticated: boolean;
  /** Optional role hints; when present, role-aware resolution prefers matches. */
  roles?: ConsultationRole[];
}

export interface ProviderResolution {
  actualProvider: string;
  actualModel: string;
}

export type ProviderUnavailableReason = "warming_up" | "not_detected";

export class ProviderUnavailableError extends Error {
  readonly provider: string;
  readonly reason: ProviderUnavailableReason;

  constructor(provider: string, reason: ProviderUnavailableReason = "not_detected") {
    const message =
      reason === "warming_up"
        ? msg("consultation.providerWarmingUp", { provider })
        : msg("consultation.providerUnavailable", { provider });
    super(message);
    this.name = "ProviderUnavailableError";
    this.provider = provider;
    this.reason = reason;
  }
}

export class ProviderAuthError extends Error {
  constructor(provider: string) {
    super(`Provider "${provider}" is installed but not authenticated`);
    this.name = "ProviderAuthError";
  }
}

export class NoProviderForRoleError extends Error {
  constructor(role: ConsultationRole) {
    super(`No authenticated provider is available to fill the "${role}" role`);
    this.name = "NoProviderForRoleError";
  }
}

/**
 * Resolve the actual provider/model for a consultation.
 *
 * - With a requested provider: it must exist (else ProviderUnavailableError) and
 *   be authenticated (else ProviderAuthError); the requested model is used when
 *   available, otherwise the provider's first model.
 * - Without a requested provider: prefer an authenticated provider declaring the
 *   role, else the first authenticated provider; else NoProviderForRoleError.
 */
export function resolveProvider(input: {
  role: ConsultationRole;
  requestedProvider: string | null;
  requestedModel: string | null;
  catalog: AvailableProvider[];
  isWarmingUp?: boolean;
}): ProviderResolution {
  const { role, requestedProvider, requestedModel, catalog, isWarmingUp } = input;

  if (requestedProvider) {
    const match = catalog.find((entry) => entry.provider === requestedProvider);
    if (!match) {
      const reason: ProviderUnavailableReason =
        isWarmingUp || catalog.length === 0 ? "warming_up" : "not_detected";
      throw new ProviderUnavailableError(requestedProvider, reason);
    }
    if (!match.authenticated) throw new ProviderAuthError(requestedProvider);
    return { actualProvider: match.provider, actualModel: pickModel(match, requestedModel) };
  }

  const authenticated = catalog.filter((entry) => entry.authenticated && entry.models.length > 0);
  const roleMatch = authenticated.find((entry) => entry.roles?.includes(role));
  const chosen = roleMatch ?? authenticated[0];
  if (!chosen) {
    if (isWarmingUp || catalog.length === 0) {
      throw new ProviderUnavailableError("catalog", "warming_up");
    }
    throw new NoProviderForRoleError(role);
  }
  return { actualProvider: chosen.provider, actualModel: pickModel(chosen, requestedModel) };
}

function pickModel(entry: AvailableProvider, requestedModel: string | null): string {
  if (requestedModel && entry.models.includes(requestedModel)) return requestedModel;
  const first = entry.models[0];
  if (!first) throw new ProviderUnavailableError(entry.provider);
  return first;
}

/**
 * Resolve the active campaign-group ID from a project. Uses the Phase 3
 * `campaignExtension.campaignGroupId`. A project is a campaign workspace
 * when `purpose === "campaign"` and `campaignExtension` is present.
 * Returns undefined when the project is not a campaign workspace.
 */
export function resolveCampaignGroupId(project: {
  purpose?: "code" | "campaign" | "research" | "general" | undefined;
  campaignExtension?: { campaignGroupId: string } | null | undefined;
}): string | undefined {
  if (project.purpose !== "campaign") return undefined;
  return project.campaignExtension?.campaignGroupId;
}
