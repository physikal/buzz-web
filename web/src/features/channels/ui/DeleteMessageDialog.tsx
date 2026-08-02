import { DestructiveConfirmDialog } from "@/shared/ui/destructive-confirm-dialog";

export function DeleteMessageDialog({
  open,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <DestructiveConfirmDialog
      confirmLabel="Delete"
      description="This will permanently delete this message and cannot be undone."
      onClose={onClose}
      onConfirm={onConfirm}
      open={open}
      pending={pending}
      pendingLabel="Deleting..."
      title="Delete message?"
    />
  );
}
