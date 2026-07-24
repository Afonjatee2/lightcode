import type { ConsultationContextPacketBody, RedactionMetadata } from "@/shared/consultations";

/**
 * Best-effort secret/credential redaction applied to every context packet
 * before it is persisted or handed to a consultant. Consultants are read-only
 * and must never see credentials, so anything that looks like a secret is
 * replaced with a stable placeholder and counted in the redaction metadata.
 */

export const REDACTION_PLACEHOLDER = "[REDACTED]";

interface SecretPattern {
  field: string;
  regex: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { field: "private_key_block", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { field: "aws_access_key_id", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { field: "github_token", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g },
  { field: "github_fine_grained_pat", regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { field: "slack_token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { field: "google_api_key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { field: "bearer_token", regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi },
  { field: "jwt", regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { field: "sk_secret_key", regex: /\bsk-(?:live|test|proj)-[A-Za-z0-9]{16,}\b/g },
  {
    field: "key_value_secret",
    regex:
      /\b(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|access[_-]?key|client[_-]?secret|authorization)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}["']?/gi,
  },
];

export interface RedactTextResult {
  text: string;
  redactedCount: number;
  redactedFields: string[];
}

/** Replace every secret-looking substring in `text` with the placeholder. */
export function redactText(text: string): RedactTextResult {
  let output = text;
  let redactedCount = 0;
  const fields = new Set<string>();
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    output = output.replace(pattern.regex, () => {
      redactedCount += 1;
      fields.add(pattern.field);
      return REDACTION_PLACEHOLDER;
    });
  }
  return { text: output, redactedCount, redactedFields: [...fields].sort() };
}

/**
 * Redact every string-bearing field of a packet body in place (returns a new
 * body). Arrays of objects are walked recursively for their string values. The
 * accumulated redaction metadata is returned alongside the cleaned body.
 */
export function redactPacketBody(body: ConsultationContextPacketBody): {
  body: ConsultationContextPacketBody;
  metadata: RedactionMetadata;
} {
  let total = 0;
  const fields = new Set<string>();

  const redactString = (value: string): string => {
    const result = redactText(value);
    total += result.redactedCount;
    for (const field of result.redactedFields) fields.add(field);
    return result.text;
  };

  const cleaned: ConsultationContextPacketBody = {
    ...body,
    parentRequest: redactString(body.parentRequest),
    explicitTask: redactString(body.explicitTask),
    durableThreadSummary: body.durableThreadSummary === null ? null : redactString(body.durableThreadSummary),
    relevantRecentConversation: body.relevantRecentConversation.map((turn) => ({
      ...turn,
      content: redactString(turn.content),
    })),
    permittedAttachments: body.permittedAttachments.map((attachment) => ({
      ...attachment,
      excerpt: redactString(attachment.excerpt),
    })),
    activeDecisions: body.activeDecisions.map((decision) => ({
      ...decision,
      statement: redactString(decision.statement),
      reason: decision.reason === null ? null : redactString(decision.reason),
    })),
    recentCampaignEvents: body.recentCampaignEvents.map((event) => ({
      ...event,
      description: redactString(event.description),
    })),
    alerts: body.alerts.map((alert) => ({ ...alert, title: redactString(alert.title) })),
  };

  const metadata: RedactionMetadata = {
    redactedCount: total,
    redactedFields: [...fields].sort(),
    appliedAt: body.createdAt,
  };
  return { body: cleaned, metadata };
}
