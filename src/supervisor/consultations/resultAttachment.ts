import type { SupervisorEvent } from "@/shared/ipc/events";
import { buildPromptContentBlocks } from "@/shared/promptContent";
import type { ConsultationResultAttachment } from "@/shared/consultations";
import type { ConsultationRepository } from "./repository";

/**
 * Parent result attachment (Part 5). Writes a completed consultation's safe
 * result back into the initiating parent thread as a durable assistant message,
 * using Poracode's real `thread-runtime-event` mechanism (main persists it and
 * mirrors it to the renderer live). The item id is derived from the consultation
 * id and the runtime-item store inserts with `INSERT OR IGNORE`, so repeated
 * completion callbacks never create a duplicate parent message. The message
 * carries only the curated attachment fields — never hidden reasoning or raw
 * internal prompts.
 */

export interface ResultAttacherDeps {
  repository: ConsultationRepository;
  emit: (event: SupervisorEvent) => void;
}

export function consultationResultItemId(consultationId: string): string {
  return `consultation-result-${consultationId}`;
}

function bulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function formatResultMessage(attachment: ConsultationResultAttachment): string {
  const lines: string[] = [];
  const header = `Consultation result · ${attachment.consultantLabel}`;
  lines.push(`**${header}**`);
  lines.push("");

  if (attachment.status === "completed") {
    if (attachment.summary.trim().length > 0) {
      lines.push(attachment.summary);
      lines.push("");
    }
    if (attachment.keyFindings.length > 0) {
      lines.push("**Key findings**");
      lines.push(bulletList(attachment.keyFindings));
      lines.push("");
    }
    if (attachment.recommendedActions.length > 0) {
      lines.push("**Recommended actions**");
      lines.push(bulletList(attachment.recommendedActions));
      lines.push("");
    }
    if (attachment.evidenceReferences.length > 0) {
      lines.push("**Evidence**");
      lines.push(bulletList(attachment.evidenceReferences));
      lines.push("");
    }
    if (attachment.assumptions.length > 0) {
      lines.push("**Assumptions**");
      lines.push(bulletList(attachment.assumptions));
      lines.push("");
    }
    if (attachment.uncertainties.length > 0) {
      lines.push("**Uncertainties**");
      lines.push(bulletList(attachment.uncertainties));
      lines.push("");
    }
    if (attachment.suggestedProposalInputs.length > 0) {
      lines.push("**Suggested proposal inputs** (not applied)");
      lines.push(
        bulletList(
          attachment.suggestedProposalInputs.map(
            (input) => `${input.title}: ${input.suggestedChange}`,
          ),
        ),
      );
      lines.push("");
    }
    if (attachment.childThreadOrRunId) {
      lines.push(`Child thread: ${attachment.childThreadOrRunId}`);
    }
    if (attachment.completedAt) {
      lines.push(`Completed: ${attachment.completedAt}`);
    }
  } else if (attachment.status === "cancelled") {
    lines.push("_This consultation was cancelled before it produced a result._");
  } else {
    lines.push(
      attachment.safeFailureMessage
        ? `_This consultation failed: ${attachment.safeFailureMessage}_`
        : "_This consultation failed before it produced a result._",
    );
  }

  lines.push("");
  lines.push(`_Consultation ${attachment.consultationId}_`);
  return lines.join("\n").trim();
}

/**
 * Returns the `attachResult` callback bound into the coordinator. Resolves the
 * parent thread from the durable record and emits the result message into it.
 */
export function createResultAttacher(deps: ResultAttacherDeps): (attachment: ConsultationResultAttachment) => void {
  return (attachment) => {
    const record = deps.repository.getConsultation(attachment.consultationId);
    const parentThreadId = record?.parentThreadId;
    if (!parentThreadId) return;

    const itemId = consultationResultItemId(attachment.consultationId);
    const text = formatResultMessage(attachment);
    deps.emit({
      type: "thread-runtime-event",
      threadId: parentThreadId,
      event: {
        type: "item.started",
        threadId: parentThreadId,
        itemId,
        itemType: "assistant_message",
        payload: { content: buildPromptContentBlocks(text) },
      },
    });
    deps.emit({
      type: "thread-runtime-event",
      threadId: parentThreadId,
      event: { type: "item.completed", threadId: parentThreadId, itemId },
    });
  };
}
