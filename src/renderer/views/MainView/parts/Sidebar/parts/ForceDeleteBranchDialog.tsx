import { ConfirmDialog } from "@/renderer/components/common";

export function ForceDeleteBranchDialog(props: {
  isOpen: boolean;
  branch: string;
  errorMessage: string;
  onClose: () => void;
  onForceDelete: () => void;
}) {
  return (
    <ConfirmDialog
      isOpen={props.isOpen}
      title="Branch not fully merged"
      body={
        <>
          <p>
            Branch <strong>{props.branch}</strong> has unmerged changes:
          </p>
          <p className="mt-1 text-sm text-muted">{props.errorMessage}</p>
          <p className="mt-2">Force delete? Unmerged changes will be lost.</p>
        </>
      }
      cancelLabel="Keep Branch"
      confirmLabel="Force Delete"
      onConfirm={props.onForceDelete}
      onClose={props.onClose}
    />
  );
}
