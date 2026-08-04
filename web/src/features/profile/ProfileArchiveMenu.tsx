import { Archive, ArchiveRestore, Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { IdentityArchiveActions } from "@/features/identity-archive/use-identity-archive";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import { Button } from "@/shared/ui/button";

export function ProfileArchiveMenu({
  actions,
  isBot,
}: {
  actions: IdentityArchiveActions;
  isBot: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const visible = actions.canArchive && actions.isArchived !== undefined;
  useEscapeSurface(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  if (!visible) return null;
  const archiveLabel = isBot ? "Archive agent" : "Archive identity";
  const unarchiveLabel = isBot ? "Unarchive agent" : "Unarchive identity";

  return (
    <>
      <div className="relative" ref={root}>
        <Button
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Open profile settings"
          data-testid="user-profile-settings-menu-trigger"
          disabled={actions.isPending}
          onClick={() => setOpen((current) => !current)}
          size="icon"
          variant="ghost"
        >
          <Settings />
        </Button>
        {open ? (
          <div
            className="absolute right-0 top-full z-10 mt-1 w-52 rounded-md border bg-popover p-1 shadow-lg"
            role="menu"
          >
            {actions.isArchived ? (
              <MenuAction
                icon={<ArchiveRestore />}
                label={actions.isPending ? "Unarchiving..." : unarchiveLabel}
                onClick={() => {
                  setOpen(false);
                  actions.unarchive();
                }}
                testId="user-profile-unarchive-identity"
              />
            ) : (
              <MenuAction
                icon={<Archive />}
                label={actions.isPending ? "Archiving..." : archiveLabel}
                onClick={() => {
                  setOpen(false);
                  setConfirmOpen(true);
                }}
                testId="user-profile-archive-identity"
              />
            )}
          </div>
        ) : null}
      </div>
      <ArchiveConfirmDialog
        isBot={isBot}
        isPending={actions.isPending}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          actions.archive();
          setConfirmOpen(false);
        }}
        open={confirmOpen}
      />
    </>
  );
}

function MenuAction({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      className="flex h-9 w-full items-center gap-2 rounded px-2 text-sm hover:bg-accent"
      data-testid={testId}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      {label}
    </button>
  );
}

function ArchiveConfirmDialog({
  isBot,
  isPending,
  onClose,
  onConfirm,
  open,
}: {
  isBot: boolean;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
}) {
  useEscapeSurface(open, onClose, isPending);
  if (!open) return null;
  const subject = isBot ? "this agent" : "this person";
  return (
    <div
      aria-label={isBot ? "Archive this agent?" : "Archive this identity?"}
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
      data-testid="archive-confirm-dialog"
      role="dialog"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !isPending) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-background p-5 shadow-2xl">
        <header className="flex items-center gap-3">
          <Archive className="h-5 w-5 text-muted-foreground" />
          <h2 className="min-w-0 flex-1 text-lg font-semibold">
            {isBot ? "Archive this agent?" : "Archive this identity?"}
          </h2>
          <Button
            aria-label="Close"
            disabled={isPending}
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        <p className="mt-3 text-sm text-muted-foreground">
          Archiving hides {subject} from the space.
        </p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            They won't appear in search, autocomplete, or when adding members
          </li>
          <li>
            This only affects{" "}
            <span className="font-medium text-foreground">this space</span>, not
            their account anywhere else
          </li>
          <li>You can unarchive them at any time to restore them</li>
        </ul>
        {isBot ? (
          <p className="mt-3 text-sm text-muted-foreground">
            You can also delete this agent from its management controls if you
            want to remove it instead of hiding it.
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button disabled={isPending} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            data-testid="archive-confirm-action"
            disabled={isPending}
            onClick={onConfirm}
            variant="secondary"
          >
            {isPending ? "Archiving..." : "Archive"}
          </Button>
        </div>
      </div>
    </div>
  );
}
