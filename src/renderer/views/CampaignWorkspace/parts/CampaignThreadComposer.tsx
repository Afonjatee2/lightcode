import { useState, type KeyboardEvent } from "react";
import { useLingui } from "@lingui/react/macro";
import { Button, toast } from "@heroui/react";
import { Send } from "lucide-react";
import { submitConsultation } from "@/renderer/actions/consultationActions";
import { friendlyError } from "@/shared/messages";
import { routeCampaignComposerMessage } from "./campaignThreadComposerRouting";

const submittingThreads = new Set<string>();

export interface CampaignThreadComposerProps {
  projectId: string;
  parentThreadId: string | undefined;
  campaignGroupId: string;
  defaultProvider: string;
}

export function CampaignThreadComposer(props: CampaignThreadComposerProps) {
  const { t } = useLingui();
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = Boolean(props.parentThreadId) && input.trim().length > 0 && !isSubmitting;

  async function handleSubmit() {
    const threadId = props.parentThreadId;
    if (!threadId || isSubmitting) return;

    const route = routeCampaignComposerMessage(input, props.defaultProvider);
    if (route.kind === "empty") return;
    if (route.kind === "parse_error") {
      toast.warning(route.message);
      return;
    }
    if (submittingThreads.has(threadId)) return;

    submittingThreads.add(threadId);
    setIsSubmitting(true);
    try {
      const result = await submitConsultation({
        projectId: props.projectId,
        parentThreadId: threadId,
        campaignGroupId: props.campaignGroupId,
        message: route.message,
      });
      if (!result.ok) {
        toast.warning(result.message);
        return;
      }
      setInput("");
    } catch (error: unknown) {
      toast.warning(friendlyError(error));
    } finally {
      submittingThreads.delete(threadId);
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && canSubmit) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  return (
    <div className="flex shrink-0 items-end gap-2 border-t border-divider p-3">
      <textarea
        aria-label={t`Message composer`}
        placeholder={t`@codex check budget pacing, or type a message…`}
        rows={2}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={!props.parentThreadId || isSubmitting}
        className="flex-1 resize-none rounded-medium border border-divider bg-content1 px-3 py-2 text-small text-foreground placeholder:text-default-400 disabled:opacity-50"
      />
      <Button
        isIconOnly
        size="sm"
        variant="primary"
        isDisabled={!canSubmit}
        aria-label={t`Send message`}
        onPress={() => void handleSubmit()}
      >
        <Send className="size-4" />
      </Button>
    </div>
  );
}
