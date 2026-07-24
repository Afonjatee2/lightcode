import type { ConsultationRole } from "./types";
import { CONSULTATION_ROLES } from "./types";

/**
 * The ONE central permission matrix for campaign consultations. Every
 * enforcement point (context construction, tool exposure, child launch, file
 * access, MCP access, proposal ops, shell/browser access) funnels through
 * {@link can} / {@link assertCan} so the rules can never drift apart.
 *
 * Default posture: campaign consultants are read-only. A small number of roles
 * earn narrowly-scoped extras (research may search the web; the handoff writer
 * may draft a proposal and write a handoff file). Two capabilities are denied
 * to EVERY consultant role unconditionally: `access_credentials` and
 * `perform_live_platform_action`. Proposal approval/application is likewise
 * never granted to a consultant — applying actions belongs to the human-gated
 * Control Centre proposal lifecycle, which we do not replicate.
 */

export const CONSULTATION_CAPABILITIES = [
  "read_campaign_context",
  "read_campaign_events",
  "read_plan",
  "read_repository_files",
  "read_selected_attachments",
  "search_web",
  "use_browser",
  "run_shell",
  "modify_repository",
  "create_proposal_draft",
  "approve_proposal",
  "apply_proposal",
  "access_credentials",
  "perform_live_platform_action",
] as const;
export type ConsultationCapability = (typeof CONSULTATION_CAPABILITIES)[number];

/** Denied to every consultant role regardless of any per-role grant. */
export const UNIVERSALLY_DENIED_CAPABILITIES: readonly ConsultationCapability[] = [
  "access_credentials",
  "perform_live_platform_action",
  "approve_proposal",
  "apply_proposal",
];

/** Read-only baseline shared by every consultant role. */
const READ_ONLY_BASE: readonly ConsultationCapability[] = [
  "read_campaign_context",
  "read_campaign_events",
  "read_plan",
  "read_selected_attachments",
];

const WITH_REPO_READ: readonly ConsultationCapability[] = [
  ...READ_ONLY_BASE,
  "read_repository_files",
];

/**
 * Per-role grants. Each list is the FULL set for the role (baseline + extras);
 * the universal deny list still wins over anything appearing here.
 */
const ROLE_GRANTS: Record<ConsultationRole, readonly ConsultationCapability[]> = {
  daily_operator: WITH_REPO_READ,
  strategic_reviewer: WITH_REPO_READ,
  figures_auditor: WITH_REPO_READ,
  challenger: WITH_REPO_READ,
  verifier: WITH_REPO_READ,
  finaliser: WITH_REPO_READ,
  researcher: [...WITH_REPO_READ, "search_web", "use_browser"],
  handoff_writer: [...WITH_REPO_READ, "create_proposal_draft", "modify_repository"],
  // The panel parent coordinates real member consultations; it does not itself
  // need broader access. Each member runs under its own role's grants.
  panel: READ_ONLY_BASE,
};

export class PermissionDeniedError extends Error {
  readonly role: ConsultationRole;
  readonly capability: ConsultationCapability;

  constructor(role: ConsultationRole, capability: ConsultationCapability) {
    super(`Role "${role}" is not permitted to use capability "${capability}"`);
    this.name = "PermissionDeniedError";
    this.role = role;
    this.capability = capability;
  }
}

const UNIVERSALLY_DENIED_SET: ReadonlySet<ConsultationCapability> = new Set(
  UNIVERSALLY_DENIED_CAPABILITIES,
);

const ROLE_CAPABILITY_SETS: Record<ConsultationRole, ReadonlySet<ConsultationCapability>> =
  buildRoleCapabilitySets();

function buildRoleCapabilitySets(): Record<ConsultationRole, ReadonlySet<ConsultationCapability>> {
  const sets = {} as Record<ConsultationRole, ReadonlySet<ConsultationCapability>>;
  for (const role of CONSULTATION_ROLES) {
    sets[role] = new Set(ROLE_GRANTS[role]);
  }
  return sets;
}

/** The full granted capability set for a role (universal denies removed). */
export function capabilitiesForRole(role: ConsultationRole): ConsultationCapability[] {
  return CONSULTATION_CAPABILITIES.filter(
    (capability) => ROLE_CAPABILITY_SETS[role].has(capability) && !UNIVERSALLY_DENIED_SET.has(capability),
  );
}

/** Central check: is `role` allowed to exercise `capability`? */
export function can(role: ConsultationRole, capability: ConsultationCapability): boolean {
  if (UNIVERSALLY_DENIED_SET.has(capability)) return false;
  return ROLE_CAPABILITY_SETS[role].has(capability);
}

/** Throw {@link PermissionDeniedError} unless the role may exercise the capability. */
export function assertCan(role: ConsultationRole, capability: ConsultationCapability): void {
  if (!can(role, capability)) throw new PermissionDeniedError(role, capability);
}

/**
 * Human-readable constraint lines folded into the context packet so the
 * consulted agent knows its own boundaries up front.
 */
export function describePermissionConstraints(role: ConsultationRole): string[] {
  const granted = capabilitiesForRole(role);
  const lines: string[] = [
    `You are operating as a campaign consultant in the "${role}" role under a read-only-first permission policy.`,
    `Permitted capabilities: ${granted.join(", ") || "none"}.`,
    "You may NOT access credentials or perform any live advertising-platform action.",
    "You may NOT approve or apply proposals; you may only suggest proposal inputs for a human to review.",
  ];
  if (!can(role, "run_shell")) lines.push("You may NOT run shell commands.");
  if (!can(role, "use_browser")) lines.push("You may NOT open a browser.");
  if (!can(role, "search_web")) lines.push("You may NOT search the web.");
  if (!can(role, "modify_repository")) lines.push("You may NOT modify repository files.");
  return lines;
}
