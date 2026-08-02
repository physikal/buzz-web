import { Trash2, X } from "lucide-react";

import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import { Button } from "@/shared/ui/button";

export function DestructiveConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel = "Working...",
  pending = false,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel?: string;
  pending?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEscapeSurface(open, onClose, pending);
  if (!open) return null;
  return (
    <div
      aria-label={title}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="w-full max-w-sm rounded-lg bg-background p-5 shadow-2xl">
        <header className="flex items-center gap-3">
          <Trash2 className="h-5 w-5 text-destructive" />
          <h2 className="min-w-0 flex-1 text-lg font-semibold">{title}</h2>
          <Button
            aria-label="Close"
            disabled={pending}
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        <p className="mt-3 text-sm text-muted-foreground">{description}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button disabled={pending} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={pending} onClick={onConfirm} variant="destructive">
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
