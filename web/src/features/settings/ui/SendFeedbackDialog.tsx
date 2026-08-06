import { Bug, ImageIcon, ThumbsUp, Wrench, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { FeedbackCategory } from "@/features/settings/feedback-api";
import { useSendFeedback } from "@/features/settings/use-send-feedback";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

const CATEGORIES = [
  { id: "bug", label: "Bug", icon: Bug },
  { id: "praise", label: "Praise", icon: ThumbsUp },
  { id: "needs-work", label: "Needs work", icon: Wrench },
] as const;

export function SendFeedbackDialog({
  onClose,
  open,
}: {
  onClose: () => void;
  open: boolean;
}) {
  const feedback = useSendFeedback();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false);
  const [message, setMessage] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const busy = feedback.isAttaching || feedback.isPending;

  const close = () => {
    if (busy) return;
    feedback.reset();
    setPreviewOpen(false);
    onClose();
  };
  useEscapeSurface(open, close, busy);
  useEscapeSurface(previewOpen, () => setPreviewOpen(false));

  useEffect(() => {
    if (open) return;
    setCategory(null);
    setError(null);
    setIncludeDiagnostics(false);
    setMessage("");
    setPreviewOpen(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() =>
      messageRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!message.trim() || busy) return;
    setError(null);
    try {
      await feedback.submit({
        category,
        includeDiagnostics,
        message: message.trim(),
      });
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to send feedback.",
      );
    }
  }

  return createPortal(
    <>
      <div
        aria-label="Send feedback"
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
        data-testid="send-feedback-dialog"
        onMouseDown={(event) => {
          if (event.currentTarget === event.target) close();
        }}
        role="dialog"
      >
        <form
          className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-lg bg-background p-6 shadow-2xl"
          onSubmit={submit}
        >
          <header className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Send feedback</h2>
              <p
                className="mt-1 text-sm text-muted-foreground"
                data-testid="feedback-privacy-disclosure"
              >
                Feedback is sent privately to this Buzz deployment and is not
                posted to a channel. Attachments are uploaded before you send.
              </p>
            </div>
            <Button
              aria-label="Close"
              disabled={busy}
              onClick={close}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          </header>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {CATEGORIES.map((entry) => {
              const Icon = entry.icon;
              const selected = category === entry.id;
              return (
                <button
                  aria-label={entry.label}
                  aria-pressed={selected}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
                    selected
                      ? "border-primary/60 bg-primary/10"
                      : "border-border bg-background hover:bg-muted/50",
                  )}
                  data-testid={`feedback-category-${entry.id}`}
                  disabled={feedback.isPending}
                  key={entry.id}
                  onClick={() => setCategory(selected ? null : entry.id)}
                  type="button"
                >
                  <Icon className="h-4 w-4" />
                  {entry.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col items-stretch gap-3 sm:flex-row">
            <textarea
              className="min-h-32 min-w-0 flex-1 resize-none rounded-md border bg-background p-3 text-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              data-testid="feedback-message"
              disabled={feedback.isPending}
              maxLength={20_000}
              onChange={(event) => {
                setMessage(event.target.value);
                setError(null);
              }}
              placeholder="Tell us what went wrong, or share general feedback."
              ref={messageRef}
              value={message}
            />

            {feedback.attachedImage ? (
              <div className="group relative flex min-h-32 w-full shrink-0 flex-col overflow-hidden rounded-md border bg-muted/40 sm:w-32">
                <button
                  aria-label="View attached image"
                  className="flex flex-col text-left"
                  data-testid="feedback-attachment-thumb"
                  onClick={() => setPreviewOpen(true)}
                  type="button"
                >
                  <img
                    alt="Attached"
                    className="h-24 w-full shrink-0 object-cover sm:h-20"
                    src={feedback.attachedImage.media.url}
                  />
                  <span className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground">
                    <ImageIcon className="h-3 w-3 shrink-0" />
                    <span className="truncate">Attached image</span>
                  </span>
                </button>
                <button
                  aria-label="Remove attachment"
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow hover:text-foreground"
                  data-testid="feedback-attachment-remove"
                  disabled={feedback.isPending}
                  onClick={feedback.removeImage}
                  type="button"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                aria-label="Attach image"
                className="flex min-h-24 w-full shrink-0 flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/20 p-3 text-center text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 sm:min-h-32 sm:w-32"
                data-testid="feedback-attach-image"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <ImageIcon className="h-5 w-5" />
                {feedback.isAttaching ? "Attaching…" : "Attach image"}
              </button>
            )}
            <input
              accept="image/*"
              className="hidden"
              data-testid="feedback-file-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setError(null);
                void feedback.attachImage(file).catch((cause) => {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Failed to attach image.",
                  );
                });
              }}
              ref={fileInputRef}
              type="file"
            />
          </div>

          <div className="mt-4 space-y-1.5">
            <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
              <input
                checked={includeDiagnostics}
                className="h-4 w-4"
                data-testid="feedback-include-logs"
                disabled={feedback.isPending}
                onChange={(event) =>
                  setIncludeDiagnostics(event.target.checked)
                }
                type="checkbox"
              />
              Attach diagnostics
            </label>
            <p className="pl-6 text-xs text-muted-foreground">
              Includes capture time, deployment version, origin, platform, user
              agent, and language. No application log lines are collected.
            </p>
          </div>

          {error ? (
            <p
              className="mt-4 text-sm text-destructive"
              data-testid="feedback-error"
            >
              {error}
            </p>
          ) : null}

          <footer className="mt-5 flex justify-end gap-2">
            <Button
              disabled={busy}
              onClick={close}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              data-testid="feedback-submit"
              disabled={busy || !message.trim()}
              type="submit"
            >
              {feedback.isPending ? "Sending…" : "Send feedback"}
            </Button>
          </footer>
        </form>
      </div>

      {previewOpen && feedback.attachedImage ? (
        <div
          aria-label="Attached image"
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3"
          data-testid="feedback-attachment-preview"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setPreviewOpen(false);
          }}
          role="dialog"
        >
          <Button
            aria-label="Close image preview"
            className="absolute right-4 top-4 bg-background/90"
            onClick={() => setPreviewOpen(false)}
            size="icon"
            type="button"
            variant="outline"
          >
            <X />
          </Button>
          <img
            alt="Attached"
            className="max-h-[85dvh] max-w-full rounded-md object-contain"
            src={feedback.attachedImage.media.url}
          />
        </div>
      ) : null}
    </>,
    document.body,
  );
}
