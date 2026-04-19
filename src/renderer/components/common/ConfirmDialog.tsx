import { AlertDialog } from "@heroui/react";
import { Button } from "./Button";

type ConfirmVariant = "danger" | "primary" | "secondary";

export function ConfirmDialog(props: {
  isOpen: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: ConfirmVariant;
  status?: "danger" | "warning";
  onConfirm: () => void;
  onClose: () => void;
}) {
  const {
    isOpen,
    title,
    body,
    confirmLabel,
    cancelLabel = "Cancel",
    confirmVariant = "danger",
    status = "danger",
    onConfirm,
    onClose,
  } = props;

  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialog.Container>
        <AlertDialog.Dialog>
          <AlertDialog.Header>
            <AlertDialog.Icon status={status} />
            <AlertDialog.Heading>{title}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>{body}</AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary">
              {cancelLabel}
            </Button>
            <Button variant={confirmVariant} onPress={onConfirm}>
              {confirmLabel}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
