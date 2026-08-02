import { Link } from "@tanstack/react-router";
import { FileText, Pencil, Trash2 } from "lucide-react";
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
          {draft.content}
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
}: {
  draft: WebDraft | null;
  channel?: Channel;
  mobileVisible: boolean;
  onBack: () => void;
  onDelete: (key: string) => void;
}) {
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
        </article>
      </div>
    </section>
  );
}
