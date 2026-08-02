import { Flag, X } from "lucide-react";
import { type FormEvent, useState } from "react";

import type { ReportType } from "@/features/settings/moderation-api";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import type { ChannelMessage } from "../channel-api";

export function ReportMessageDialog({
  message,
  pending,
  onClose,
  onSubmit,
}: {
  message: ChannelMessage | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: { reportType: ReportType; note: string }) => Promise<void>;
}) {
  const [reportType, setReportType] = useState<ReportType>("spam");
  const [note, setNote] = useState("");
  useEscapeSurface(Boolean(message), onClose, pending);
  if (!message) return null;
  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSubmit({ reportType, note });
    setNote("");
    setReportType("spam");
  }
  return (
    <div
      aria-label="Report message"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !pending) onClose();
      }}
    >
      <form
        className="w-full max-w-md rounded-lg bg-background p-6 shadow-2xl"
        onSubmit={submit}
      >
        <header className="flex items-start gap-3">
          <Flag className="mt-1 h-5 w-5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Report message</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Report content from {truncatePubkey(message.pubkey)} to community
              moderators.
            </p>
          </div>
          <Button
            aria-label="Close"
            disabled={pending}
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        <label className="mt-5 block text-sm font-medium" htmlFor="report-type">
          Reason
        </label>
        <select
          className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
          disabled={pending}
          id="report-type"
          value={reportType}
          onChange={(event) => setReportType(event.target.value as ReportType)}
        >
          <option value="spam">Spam</option>
          <option value="impersonation">Impersonation</option>
          <option value="profanity">Harassment or profanity</option>
          <option value="nudity">Nudity</option>
          <option value="malware">Malware or harmful link</option>
          <option value="illegal">Illegal content</option>
          <option value="other">Other</option>
        </select>
        <label className="mt-4 block text-sm font-medium" htmlFor="report-note">
          Details{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          className="mt-2 min-h-24 w-full rounded-md border bg-background p-3 text-sm"
          disabled={pending}
          id="report-note"
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="mt-6 flex justify-end gap-2">
          <Button
            disabled={pending}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={pending} type="submit">
            {pending ? "Submitting…" : "Submit report"}
          </Button>
        </div>
      </form>
    </div>
  );
}
