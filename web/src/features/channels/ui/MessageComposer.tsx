import { FileText, Send, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import type { CustomEmoji } from "@/features/settings/custom-emoji-api";
import { Button } from "@/shared/ui/button";
import {
  mediaImetaTag,
  type Channel,
  type ChannelMessage,
  uploadMedia,
} from "../channel-api";
import { deleteDraft, loadDraft, saveDraft } from "../draft-store";
import type { DmCandidate } from "../dm-candidates";
import { ComposerToolbar } from "./ComposerToolbar";

export type ComposerPayload = {
  content: string;
  mediaTags: string[][];
};

export function MessageComposer({
  channel,
  parent,
  ownerPubkey,
  customEmoji,
  mentionCandidates,
  pending,
  onTyping,
  onSubmit,
}: {
  channel: Channel;
  parent?: ChannelMessage | null;
  ownerPubkey: string;
  customEmoji: CustomEmoji[];
  mentionCandidates: DmCandidate[];
  pending: boolean;
  onTyping?: () => void;
  onSubmit: (payload: ComposerPayload) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() =>
    loadDraft(ownerPubkey, channel.id, parent?.id),
  );
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingSent = useRef(0);

  useEffect(() => {
    setDraft(loadDraft(ownerPubkey, channel.id, parent?.id));
    setFiles([]);
  }, [channel.id, ownerPubkey, parent?.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if ((!draft.trim() && !files.length) || pending || uploading) return;
    setUploading(true);
    try {
      const uploads = await Promise.all(
        files.map(async (file) =>
          mediaImetaTag(await uploadMedia(file), file.name),
        ),
      );
      await onSubmit({ content: draft, mediaTags: uploads });
      setDraft("");
      setFiles([]);
      deleteDraft(ownerPubkey, parent?.id ? `thread:${parent.id}` : channel.id);
    } finally {
      setUploading(false);
    }
  }

  const placeholder = parent
    ? "Reply in thread"
    : channel.channelType === "forum"
      ? "Create a new post"
      : channel.channelType === "dm"
        ? `Message ${channel.name}`
        : `Message #${channel.name}`;

  return (
    <form className="border-t p-3 sm:p-4" onSubmit={submit}>
      <div className="mx-auto max-w-4xl rounded-md border bg-background shadow-xs focus-within:ring-1 focus-within:ring-ring">
        {files.length ? (
          <div className="flex flex-wrap gap-2 border-b p-2">
            {files.map((file, index) => (
              <span
                className="flex max-w-full items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs"
                key={`${file.name}-${file.lastModified}`}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{file.name}</span>
                <button
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setFiles((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  type="button"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-1 p-2">
          <input
            className="hidden"
            multiple
            ref={fileInput}
            type="file"
            onChange={(event) => {
              const selected = [...(event.target.files ?? [])];
              setFiles((current) => [...current, ...selected].slice(0, 10));
              event.target.value = "";
            }}
          />
          <textarea
            aria-label={placeholder}
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
            disabled={pending || uploading}
            placeholder={placeholder}
            rows={1}
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              saveDraft(
                ownerPubkey,
                channel.id,
                parent?.id,
                event.target.value,
                event.target.selectionStart,
              );
              if (
                event.target.value.trim() &&
                Date.now() - lastTypingSent.current >= 3_000
              ) {
                lastTypingSent.current = Date.now();
                onTyping?.();
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </div>
        <div className="flex min-h-12 items-center justify-between gap-2 border-t px-2 py-1">
          <ComposerToolbar
            customEmoji={customEmoji}
            disabled={pending || uploading}
            key={`${channel.id}:${parent?.id ?? "root"}`}
            mentionCandidates={mentionCandidates}
            onAttach={() => fileInput.current?.click()}
            onValueChange={(value, selection) => {
              setDraft(value);
              saveDraft(ownerPubkey, channel.id, parent?.id, value, selection);
            }}
            textareaRef={textareaRef}
            value={draft}
          />
          <Button
            aria-label="Send message"
            disabled={(!draft.trim() && !files.length) || pending || uploading}
            size="icon"
            type="submit"
          >
            <Send />
          </Button>
        </div>
        {uploading ? (
          <p className="px-3 pb-2 text-xs text-muted-foreground">
            Uploading attachments…
          </p>
        ) : null}
      </div>
    </form>
  );
}
