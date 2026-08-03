import { FileText, Pencil, RotateCcw, X } from "lucide-react";
import { useState } from "react";

import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import { Button } from "@/shared/ui/button";
import type { DraftAttachment } from "../draft-store";
import { ComposerImageEditor } from "./ComposerImageEditor";

export function ComposerAttachments({
  attachments,
  disabled,
  originalByUrl,
  onEdit,
  onRemove,
  onRevert,
}: {
  attachments: DraftAttachment[];
  disabled: boolean;
  originalByUrl: ReadonlyMap<string, DraftAttachment>;
  onEdit: (attachment: DraftAttachment, blob: Blob) => Promise<void>;
  onRemove: (index: number) => void;
  onRevert: (attachment: DraftAttachment) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 border-b p-2">
      {attachments.map((attachment, index) =>
        attachment.type.startsWith("image/") ? (
          <ImageAttachment
            attachment={attachment}
            canRevert={originalByUrl.has(attachment.url)}
            disabled={disabled}
            key={attachment.url}
            onEdit={onEdit}
            onRemove={() => onRemove(index)}
            onRevert={() => onRevert(attachment)}
          />
        ) : (
          <span
            className="flex max-w-full items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs"
            key={attachment.url}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {attachment.filename ?? "Attachment"}
            </span>
            <button
              aria-label={`Remove ${attachment.filename ?? "attachment"}`}
              disabled={disabled}
              onClick={() => onRemove(index)}
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ),
      )}
    </div>
  );
}

function ImageAttachment({
  attachment,
  canRevert,
  disabled,
  onEdit,
  onRemove,
  onRevert,
}: {
  attachment: DraftAttachment;
  canRevert: boolean;
  disabled: boolean;
  onEdit: (attachment: DraftAttachment, blob: Blob) => Promise<void>;
  onRemove: () => void;
  onRevert: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const label = attachment.filename ?? "image attachment";
  useEscapeSurface(open, () => {
    if (editing) {
      if (!editorSaving) setEditing(false);
    } else setOpen(false);
  });

  return (
    <>
      <div className="group relative h-14 w-14 overflow-hidden rounded-md border bg-muted">
        <button
          aria-label={`Preview ${label}`}
          className="h-full w-full"
          disabled={disabled}
          onClick={() => setOpen(true)}
          type="button"
        >
          <img
            alt=""
            className="h-full w-full object-cover"
            src={attachment.thumb ?? attachment.url}
          />
        </button>
        <button
          aria-label={`Remove ${label}`}
          className="absolute right-0.5 top-0.5 rounded bg-black/65 p-0.5 text-white"
          disabled={disabled}
          onClick={onRemove}
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {open ? (
        <div
          aria-label={`${label} preview`}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3"
          role="dialog"
        >
          {editing ? (
            <ComposerImageEditor
              onCancel={() => setEditing(false)}
              onSave={async (blob) => {
                await onEdit(attachment, blob);
                setEditing(false);
                setOpen(false);
              }}
              onSavingChange={setEditorSaving}
              sourceUrl={attachment.url}
            />
          ) : (
            <>
              <button
                aria-label="Close image preview"
                className="absolute inset-0"
                onClick={() => setOpen(false)}
                type="button"
              />
              <img
                alt={label}
                className="relative max-h-[90dvh] max-w-[94vw] rounded-md object-contain"
                src={attachment.url}
              />
              <div className="absolute right-4 top-4 flex items-center gap-2">
                {canRevert ? (
                  <Button onClick={onRevert} size="sm" variant="secondary">
                    <RotateCcw /> Revert
                  </Button>
                ) : null}
                <Button
                  onClick={() => setEditing(true)}
                  size="sm"
                  variant="secondary"
                >
                  <Pencil /> Draw on image
                </Button>
                <Button
                  aria-label="Close image preview"
                  onClick={() => setOpen(false)}
                  size="icon"
                  variant="secondary"
                >
                  <X />
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
