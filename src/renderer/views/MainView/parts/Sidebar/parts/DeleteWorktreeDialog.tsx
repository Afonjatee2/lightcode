import { useState } from "react";
import { AlertDialog, Checkbox } from "@heroui/react";
import { Button } from "@/renderer/components/common/Button";

const PREF_KEY = "lightcode-delete-worktree-pref";

export type WorktreeDeletePref = "thread-only" | "thread-and-worktree";

export function readWorktreeDeletePref(): WorktreeDeletePref | null {
  const raw = localStorage.getItem(PREF_KEY);
  if (raw === "thread-only" || raw === "thread-and-worktree") return raw;
  return null;
}

export function DeleteWorktreeDialog(props: {
  isOpen: boolean;
  worktreeBranch: string;
  onClose: () => void;
  onDeleteThreadOnly: (dontAskAgain: boolean) => void;
  onDeleteThreadAndWorktree: (dontAskAgain: boolean) => void;
}) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  function handleThreadOnly() {
    if (dontAskAgain) localStorage.setItem(PREF_KEY, "thread-only");
    props.onDeleteThreadOnly(dontAskAgain);
  }

  function handleThreadAndWorktree() {
    if (dontAskAgain) localStorage.setItem(PREF_KEY, "thread-and-worktree");
    props.onDeleteThreadAndWorktree(dontAskAgain);
  }

  return (
    <AlertDialog.Backdrop isOpen={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
      <AlertDialog.Container size="sm">
        <AlertDialog.Dialog className="sm:max-w-[420px] !p-4">
          <AlertDialog.Header className="gap-1">
            <AlertDialog.Heading>Delete thread?</AlertDialog.Heading>
            <p className="text-sm leading-5 text-muted">
              This thread uses worktree{" "}
              <strong className="font-medium text-foreground">{props.worktreeBranch}</strong>. Also
              remove the worktree directory?
            </p>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <Checkbox isSelected={dontAskAgain} onChange={setDontAskAgain}>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              Don&apos;t ask again
            </Checkbox>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="ghost" className="text-muted">
              Cancel
            </Button>
            <Button variant="tertiary" className="text-warning" onPress={handleThreadOnly}>
              Thread Only
            </Button>
            <Button variant="danger" onPress={handleThreadAndWorktree}>
              Thread + Worktree
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
