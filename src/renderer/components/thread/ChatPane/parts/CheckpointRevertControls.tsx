import {
  AlertDialog,
  Checkbox,
  Description,
  Label,
  Radio,
  RadioGroup,
  Tooltip,
} from "@heroui/react";
import { RotateCcw } from "lucide-react";
import type { FileCheckpointRecord } from "@/shared/contracts";
import { Button } from "@/renderer/components/common/Button";

export interface CheckpointGuard {
  scopeLabel: string;
  hasSharedTree: boolean;
  sharedThreadCount: number;
}

export type RevertScope = "transcript" | "files";

export const DEFAULT_CHECKPOINT_GUARD: CheckpointGuard = {
  scopeLabel: "this tree",
  hasSharedTree: false,
  sharedThreadCount: 0,
};

export function CheckpointRevertButton(props: {
  itemId: string;
  onRequestRevert: (itemId: string) => void;
}) {
  return (
    <Tooltip delay={300}>
      <Tooltip.Trigger>
        <button
          type="button"
          aria-label="Revert to this checkpoint"
          className="absolute right-1 top-1 z-10 flex size-6 items-center justify-center rounded text-muted/70 opacity-0 transition-colors transition-opacity hover:bg-foreground/5 hover:text-foreground group-hover/checkpoint:opacity-100 focus-visible:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            props.onRequestRevert(props.itemId);
          }}
        >
          <RotateCcw className="size-3.5" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content>Revert to this checkpoint</Tooltip.Content>
    </Tooltip>
  );
}

export function RevertCheckpointDialog(props: {
  isOpen: boolean;
  dontAskAgain: boolean;
  revertScope: RevertScope;
  checkpointGuard: CheckpointGuard;
  fileCheckpoint?: FileCheckpointRecord | undefined;
  canRestoreFiles: boolean;
  onDontAskAgainChange: (value: boolean) => void;
  onRevertScopeChange: (value: RevertScope) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const filesDisabled = !props.canRestoreFiles;
  return (
    <AlertDialog.Backdrop isOpen={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
      <AlertDialog.Container>
        <AlertDialog.Dialog>
          <AlertDialog.Header>
            <AlertDialog.Icon status="warning" />
            <AlertDialog.Heading>Revert to checkpoint?</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p>Choose what to revert for this checkpoint.</p>
            <RadioGroup
              aria-label="Revert scope"
              className="mt-3 gap-2"
              value={props.revertScope}
              onChange={(value) => props.onRevertScopeChange(value as RevertScope)}
            >
              <Radio value="transcript" className="items-start">
                <Radio.Control className="mt-0.5">
                  <Radio.Indicator />
                </Radio.Control>
                <Radio.Content>
                  <Label className="text-sm font-medium">Chat only</Label>
                  <Description className="text-xs text-muted">
                    Remove later messages from this chat. Workspace files are not changed.
                  </Description>
                </Radio.Content>
              </Radio>
              <Radio value="files" className="items-start" isDisabled={filesDisabled}>
                <Radio.Control className="mt-0.5">
                  <Radio.Indicator />
                </Radio.Control>
                <Radio.Content>
                  <Label className="text-sm font-medium">Chat and files</Label>
                  <Description className="text-xs text-muted">
                    {props.fileCheckpoint
                      ? `Restore ${props.checkpointGuard.scopeLabel} to this checkpoint snapshot.`
                      : "No file checkpoint is stored for this message."}
                  </Description>
                </Radio.Content>
              </Radio>
            </RadioGroup>
            {props.checkpointGuard.hasSharedTree ? (
              <div className="mt-3 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                {props.checkpointGuard.sharedThreadCount === 1
                  ? "Another chat uses this same tree. File restore could overwrite that chat's changes."
                  : `${props.checkpointGuard.sharedThreadCount} other chats use this same tree. File restore could overwrite their changes.`}
              </div>
            ) : null}
            <div className="mt-3">
              <Checkbox isSelected={props.dontAskAgain} onChange={props.onDontAskAgainChange}>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                Don&apos;t ask again
              </Checkbox>
            </div>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary">
              Cancel
            </Button>
            <Button variant="danger" onPress={props.onConfirm}>
              Revert
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
