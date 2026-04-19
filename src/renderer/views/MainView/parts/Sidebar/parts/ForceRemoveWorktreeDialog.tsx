import { ConfirmDialog } from "@/renderer/components/common";

export function ForceRemoveWorktreeDialog(props: {
  isOpen: boolean;
  worktreeBranch: string;
  errorMessage: string;
  onClose: () => void;
  onForceRemove: () => void;
}) {
  return (
    <ConfirmDialog
      isOpen={props.isOpen}
      title="Worktree removal failed"
      body={
        <>
          <p>
            Could not remove worktree <strong>{props.worktreeBranch}</strong>:
          </p>
          <p className="mt-1 text-sm text-muted">{props.errorMessage}</p>
          <p className="mt-2">Force remove? This cannot be undone.</p>
        </>
      }
      confirmLabel="Force Remove"
      onConfirm={props.onForceRemove}
      onClose={props.onClose}
    />
  );
}
