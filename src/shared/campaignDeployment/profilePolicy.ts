import type { DeploymentPolicy } from "./types";

// ---------------------------------------------------------------------------
// Campaign Deployment Profile Policy
//
// This is the single source of truth for what the Deployment profile allows
// and denies. It is pure (no side effects, no network, no DB) and testable
// in isolation.
//
// Design principles:
// 1. Operators MUST approve proposals — Poracode never writes directly to
//    advertising platforms.
// 2. The profile enables campaign context/evidence, proposal list/get,
//    approve/reject, and controlled plan proposal/approval flows.
// 3. Direct platform-write tool names are explicitly denied.
// 4. Unknown tool names that match platform-write patterns are denied by
//    policy defaults (deny by default for writes).
// ---------------------------------------------------------------------------

// Tool name patterns that indicate direct platform writes — always denied
const PLATFORM_WRITE_PATTERNS = [
  "apply_",
  "platform_write",
  "ad_platform.",
  "meta_ads.",
  "google_ads.",
  "tiktok_ads.",
  "linkedin_ads.",
  "snap_ads.",
  "campaign.create",
  "campaign.update",
  "campaign.delete",
  "budget.set",
  "budget.adjust",
  "creative.upload",
  "creative.create",
  "creative.update",
  "audience.create",
  "audience.update",
  "targeting.update",
  "bid.adjust",
  "ad.set",
  "ad.create",
  "ad.update",
  "ad.delete",
  "placement.update",
  "status.set",
  "schedule.set",
  "publish",
  "deploy",
  "launch",
] as const;

/** Read-only / safe proposal actions */
const ALLOWED_READ_PATTERNS = [
  "list_pending",
  "list_",
  "get_",
  "get_plan",
  "find_latest",
  "compare_",
  "ask_",
  "explain_",
  "record_campaign_note",
  "import_",
  "draft_email",
] as const;

/** Proposal creation and approval actions (require operator) */
const PROPOSAL_MANAGEMENT_PATTERNS = [
  "propose_",
  "create_action_proposal",
  "submit_action_proposal",
] as const;

/** Approval/rejection actions (require operator + strong confirmation for high-risk) */
const APPROVAL_PATTERNS = [
  "approve_action_proposal",
  "reject_action_proposal",
  "approve_plan_update_proposal",
] as const;

// ---------------------------------------------------------------------------
// Policy definition
// ---------------------------------------------------------------------------
export const CAMPAIGN_DEPLOYMENT_POLICY: DeploymentPolicy = {
  label: "Campaign Deployment",
  description:
    "Action proposals + operator-controlled approval. Operators must approve " +
    "every proposal before any platform change can be executed by the Control " +
    "Centre server. Poracode never writes directly to advertising platforms.",

  allowedToolPatterns: [
    ...ALLOWED_READ_PATTERNS,
    ...PROPOSAL_MANAGEMENT_PATTERNS,
    ...APPROVAL_PATTERNS,
  ],

  deniedToolPatterns: [...PLATFORM_WRITE_PATTERNS],

  approvalRequiredPatterns: [...APPROVAL_PATTERNS],

  allowsDirectPlatformWrite: false,
};

// ---------------------------------------------------------------------------
// Pure policy check functions — no side effects, no network, no DB
// ---------------------------------------------------------------------------

/** Result of a policy check */
export interface PolicyCheckResult {
  allowed: boolean;
  denied: boolean;
  reason: string | null;
  requiresApproval: boolean;
}

/**
 * Check whether a tool name is allowed under the Campaign Deployment policy.
 *
 * Always denies direct platform writes. Unknown tool names are denied by
 * default if they match write patterns; otherwise they are deferred
 * (allowed: false, denied: false) to let the MCP server make the final decision.
 */
export function checkToolPolicy(
  toolName: string,
  policy: DeploymentPolicy = CAMPAIGN_DEPLOYMENT_POLICY,
): PolicyCheckResult {
  // 1. Explicitly denied patterns always win
  for (const pattern of policy.deniedToolPatterns) {
    if (toolName.startsWith(pattern) || toolName === pattern) {
      return {
        allowed: false,
        denied: true,
        reason: `Tool "${toolName}" matches denied platform-write pattern "${pattern}". Poracode never writes directly to advertising platforms.`,
        requiresApproval: false,
      };
    }
  }

  // 2. Check allowed patterns
  let matchedAllowed = false;
  for (const pattern of policy.allowedToolPatterns) {
    if (toolName.startsWith(pattern) || toolName === pattern) {
      matchedAllowed = true;
      break;
    }
  }

  // 3. Check if approval is required (approval patterns are a subset of allowed)
  let requiresApproval = false;
  for (const pattern of policy.approvalRequiredPatterns) {
    if (toolName.startsWith(pattern) || toolName === pattern) {
      requiresApproval = true;
      break;
    }
  }

  if (matchedAllowed) {
    return {
      allowed: true,
      denied: false,
      reason: null,
      requiresApproval,
    };
  }

  // 4. Unknown tool — check if it looks like a write operation by heuristic
  if (looksLikePlatformWrite(toolName)) {
    return {
      allowed: false,
      denied: true,
      reason: `Unknown tool "${toolName}" matches platform-write heuristics. Denied by default.`,
      requiresApproval: false,
    };
  }

  // 5. Unknown non-write tool — defer to MCP server
  return {
    allowed: false,
    denied: false,
    reason: `Tool "${toolName}" is not in the Deployment profile allow-list. The MCP server will make the final decision.`,
    requiresApproval: false,
  };
}

/**
 * Heuristic: does the tool name look like a direct platform write?
 * Pure function, no external state.
 */
export function looksLikePlatformWrite(toolName: string): boolean {
  const writeKeywords = [
    "apply",
    "write",
    "create",
    "update",
    "delete",
    "mutate",
    "insert",
    "upsert",
    "set",
    "publish",
    "deploy",
    "launch",
    "push",
    "execute",
    "run_platform",
  ];

  const platformPrefixes = [
    "meta_",
    "google_",
    "tiktok_",
    "linkedin_",
    "snap_",
    "twitter_",
    "x_ads",
    "pinterest_",
    "reddit_ads",
    "ad_platform",
  ];

  const lower = toolName.toLowerCase();

  // Direct platform prefix
  for (const prefix of platformPrefixes) {
    if (lower.startsWith(prefix)) return true;
  }

  // Contains a write keyword
  for (const kw of writeKeywords) {
    if (lower.includes(kw)) return true;
  }

  return false;
}

/**
 * Check a batch of tool names and return only those allowed.
 */
export function filterAllowedTools(
  toolNames: string[],
  policy: DeploymentPolicy = CAMPAIGN_DEPLOYMENT_POLICY,
): { allowed: string[]; denied: { name: string; reason: string }[] } {
  const allowed: string[] = [];
  const denied: { name: string; reason: string }[] = [];

  for (const name of toolNames) {
    const result = checkToolPolicy(name, policy);
    if (result.allowed) {
      allowed.push(name);
    } else if (result.denied) {
      denied.push({ name, reason: result.reason! });
    }
    // Non-denied, non-allowed tools are silently skipped (deferred to server)
  }

  return { allowed, denied };
}

/**
 * Validate that no denied tools are present and return all explicitly allowed tools.
 * Throws if any denied tool is found — useful as a hard guard.
 */
export function requireApprovedTools(
  toolNames: string[],
  policy: DeploymentPolicy = CAMPAIGN_DEPLOYMENT_POLICY,
): string[] {
  const { allowed, denied } = filterAllowedTools(toolNames, policy);
  if (denied.length > 0) {
    const reasons = denied.map((d) => `  - ${d.name}: ${d.reason}`).join("\n");
    throw new Error(
      `The following tools are denied by the Campaign Deployment profile policy:\n${reasons}`,
    );
  }
  return allowed;
}
