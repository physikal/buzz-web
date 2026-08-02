import { Link } from "@tanstack/react-router";
import { FileText, Pencil, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Channel } from "@/features/channels/channel-api";
import type { WebDraft } from "@/features/channels/draft-store";
import { relativeTime } from "@/shared/lib/relative-time";
import { Button } from "@/shared/ui/button";

export function HomeDraftRow({
  draft,
  channel,
  selected,
  onSelect,
}: {
  draft: WebDraft;
  channel?: Channel;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={`flex w-full gap-3 border-b px-4 py-3 text-left hover:bg-muted/50 ${selected ? "bg-muted/50" : ""}`}
      onClick={onSelect}
      type="button"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <FileText className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <strong className="min-w-0 flex-1 truncate text-sm">
            {channel?.channelType === "dm"
              ? channel.name
              : `#${channel?.name ?? "Unknown channel"}`}
          </strong>
          <time className="shrink-0 text-xs text-muted-foreground">
            {relativeTime(Math.floor(Date.parse(draft.updatedAt) / 1_000))}
          </time>
        </span>
        <span className="mt-0.5 block text-xs font-medium text-muted-foreground">
          {draft.parentId ? "Thread draft" : "Draft"}
        </span>
        <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">
          {draft.content ||
            `${draft.attachments.length} attachment${draft.attachments.length === 1 ? "" : "s"}`}
        </span>
      </span>
    </button>
  );
}

export function HomeDraftDetail({
  draft,
  channel,
  mobileVisible,
  onBack,
  onDelete,
  canSend,
  pending,
  onSend,
}: {
  draft: WebDraft | null;
  channel?: Channel;
  mobileVisible: boolean;
  onBack: () => void;
  onDelete: (key: string) => void;
  canSend: boolean;
  pending: boolean;
  onSend: (draft: WebDraft) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!draft)
    return (
      <section className="hidden min-w-0 flex-1 items-center justify-center sm:flex">
        <div className="text-center text-sm text-muted-foreground">
          <FileText className="mx-auto mb-3 h-8 w-8" />
          Select a draft
        </div>
      </section>
    );
  return (
    <section
      className={`${mobileVisible ? "flex" : "hidden"} min-w-0 flex-1 flex-col sm:flex`}
    >
      <header className="flex min-h-16 items-center gap-3 border-b px-4 sm:px-6">
        <Button className="sm:hidden" onClick={onBack} variant="ghost">
          Back
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">
            {channel?.channelType === "dm"
              ? channel.name
              : `#${channel?.name ?? "Unknown channel"}`}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {draft.parentId ? "Thread draft" : "Draft"}
          </p>
        </div>
        {channel ? (
          <Button asChild variant="outline">
            <Link
              search={{
                channel: channel.id,
                message: draft.parentId ?? undefined,
              }}
              to="/channels"
            >
              <Pencil /> Open draft
            </Link>
          </Button>
        ) : null}
        <Button
          aria-label="Send draft"
          disabled={!canSend || pending}
          onClick={() => setConfirming(true)}
          size="icon"
          title={canSend ? "Send draft" : "Open this draft before sending it"}
          variant="ghost"
        >
          <Send />
        </Button>
        <Button
          aria-label="Delete draft"
          onClick={() => onDelete(draft.key)}
          size="icon"
          variant="ghost"
        >
          <Trash2 />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-10">
        <article className="prose prose-sm mx-auto max-w-3xl dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {draft.content}
          </ReactMarkdown>
          {draft.attachments.length ? (
            <div className="not-prose mt-6 space-y-2">
              {draft.attachments.map((attachment) => (
                <a
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
                  href={attachment.url}
                  key={attachment.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {attachment.filename ?? "Attachment"}
                  </span>
                </a>
              ))}
            </div>
          ) : null}
        </article>
      </div>
      {confirming ? (
        <div
          aria-label="Send draft"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
        >
          <div className="w-full max-w-sm rounded-lg bg-background p-5 shadow-2xl">
            <h3 className="font-semibold">Send this draft?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              It will be posted to{" "}
              {channel?.channelType === "dm"
                ? channel.name
                : `#${channel?.name ?? "the channel"}`}
              .
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                disabled={pending}
                onClick={() => setConfirming(false)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={pending}
                onClick={async () => {
                  try {
                    await onSend(draft);
                    setConfirming(false);
                  } catch {
                    // The mutation surfaces the actionable error toast.
                  }
                }}
              >
                <Send /> {pending ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
