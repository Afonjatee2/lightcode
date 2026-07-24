import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { GitBranch, Paperclip, Play } from "lucide-react";
import { AttachmentBar } from "@/renderer/components/composer/AttachmentBar";
import type { Attachment } from "@/renderer/components/composer/useAttachments";
import { Button, TextArea } from "@/renderer/components/common";

export function SwarmTaskPanel(props: {
  task: string;
  attachments: Attachment[];
  canStart: boolean;
  onTaskChange: (task: string) => void;
  onAttachFiles: () => Promise<void>;
  onRemoveAttachment: (id: string) => void;
  onStart: () => void;
}) {
  const { t } = useLingui();
  const [isPickingFiles, setIsPickingFiles] = useState(false);

  async function attachFiles() {
    if (isPickingFiles) return;
    setIsPickingFiles(true);
    try {
      await props.onAttachFiles();
    } finally {
      setIsPickingFiles(false);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--hairline)] bg-background p-4">
      <div className="mb-3 flex items-center gap-2">
        <GitBranch className="size-4 text-muted" />
        <h2 className="text-sm font-semibold">
          <Trans>Task</Trans>
        </h2>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-muted"
          isDisabled={isPickingFiles}
          aria-label={t`Attach files`}
          onPress={() => void attachFiles()}
        >
          <Paperclip className="size-3.5" />
          <Trans>Attach files</Trans>
        </Button>
      </div>
      <AttachmentBar
        attachments={props.attachments}
        onRemove={props.onRemoveAttachment}
        layout="flush"
      />
      <TextArea
        aria-label={t`Task for the swarm`}
        placeholder={t`Describe the outcome, constraints, and checks that define done…`}
        value={props.task}
        onChange={(event) => props.onTaskChange(event.target.value)}
        rows={7}
        className={props.attachments.length > 0 ? "mt-3 w-full" : "w-full"}
      />
      <div className="mt-4 flex flex-col gap-3 border-t border-[var(--hairline)] pt-4 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-xs leading-5 text-muted">
          <Trans>
            Worker branches remain available for inspection. You choose what to merge after the
            reviewer reports.
          </Trans>
        </p>
        <Button className="shrink-0" isDisabled={!props.canStart} onPress={props.onStart}>
          <Play className="size-3.5 fill-current" />
          <Trans>Start swarm</Trans>
        </Button>
      </div>
    </section>
  );
}
