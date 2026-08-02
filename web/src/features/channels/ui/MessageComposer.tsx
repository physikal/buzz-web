import { FileText, Send, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { CustomEmoji } from "@/features/settings/custom-emoji-api";
import { Button } from "@/shared/ui/button";
import {
  mediaImetaTag,
  type Channel,
  type ChannelMessage,
  uploadMedia,
} from "../channel-api";
import {
  deleteDraft,
  type DraftAttachment,
  type DraftMentionRef,
  loadDraftState,
  saveDraft,
} from "../draft-store";
import type { DmCandidate } from "../dm-candidates";
import {
  reconcileMentionRefs,
  resolveMentionPubkeys,
} from "../mention-routing";
import { ComposerToolbar } from "./ComposerToolbar";

export type ComposerPayload = {
  content: string;
  mediaTags: string[][];
  mentionPubkeys: string[];
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
  const [draft, setDraft] = useState(
    () => loadDraftState(ownerPubkey, channel.id, parent?.id).content,
  );
  const [attachments, setAttachments] = useState<DraftAttachment[]>(
    () => loadDraftState(ownerPubkey, channel.id, parent?.id).pendingImeta,
  );
  const [mentionRefs, setMentionRefs] = useState<DraftMentionRef[]>(
    () => loadDraftState(ownerPubkey, channel.id, parent?.id).mentionRefs,
  );
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  const contextKey = `${channel.id}:${parent?.id ?? "root"}`;
  const contextKeyRef = useRef(contextKey);
  draftRef.current = draft;
  contextKeyRef.current = contextKey;
  const lastTypingSent = useRef(0);

  useEffect(() => {
    const saved = loadDraftState(ownerPubkey, channel.id, parent?.id);
    setDraft(saved.content);
    setAttachments(saved.pendingImeta);
    setMentionRefs(saved.mentionRefs);
  }, [channel.id, ownerPubkey, parent?.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if ((!draft.trim() && !attachments.length) || pending || uploading) return;
    setUploading(true);
    try {
      const mediaTags = attachments.map((attachment) =>
        mediaImetaTag(
          {
            url: attachment.url,
            sha256: attachment.sha256,
            size: attachment.size,
            type: attachment.type,
            dimensions: attachment.dim,
            thumbnailUrl: attachment.thumb,
          },
          attachment.filename ?? "attachment",
        ),
      );
      await onSubmit({
        content: draft,
        mediaTags,
        mentionPubkeys: resolveMentionPubkeys(
          draft,
          mentionRefs,
          mentionCandidates,
        ),
      });
      setDraft("");
      setAttachments([]);
      setMentionRefs([]);
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
        {attachments.length ? (
          <div className="flex flex-wrap gap-2 border-b p-2">
            {attachments.map((attachment, index) => (
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
                  onClick={() => {
                    setAttachments((current) => {
                      const next = current.filter(
                        (_, itemIndex) => itemIndex !== index,
                      );
                      saveDraft(
                        ownerPubkey,
                        channel.id,
                        parent?.id,
                        draftRef.current,
                        textareaRef.current?.selectionStart ??
                          draftRef.current.length,
                        next,
                      );
                      return next;
                    });
                  }}
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
            onChange={async (event) => {
              const selected = [...(event.target.files ?? [])].slice(
                0,
                Math.max(0, 10 - attachments.length),
              );
              event.target.value = "";
              if (!selected.length) return;
              const uploadChannelId = channel.id;
              const uploadParentId = parent?.id;
              const uploadContextKey = contextKey;
              setUploading(true);
              try {
                const uploaded = await Promise.all(
                  selected.map(async (file): Promise<DraftAttachment> => {
                    const media = await uploadMedia(file);
                    return {
                      url: media.url,
                      sha256: media.sha256,
                      size: media.size,
                      type: media.type,
                      uploaded: Math.floor(Date.now() / 1_000),
                      dim: media.dimensions,
                      thumb: media.thumbnailUrl,
                      filename: file.name,
                    };
                  }),
                );
                const saved = loadDraftState(
                  ownerPubkey,
                  uploadChannelId,
                  uploadParentId,
                );
                const next = [...saved.pendingImeta, ...uploaded].slice(0, 10);
                saveDraft(
                  ownerPubkey,
                  uploadChannelId,
                  uploadParentId,
                  saved.content,
                  saved.content.length,
                  next,
                );
                if (contextKeyRef.current === uploadContextKey) {
                  setAttachments(next);
                }
              } catch (error) {
                toast.error("Could not upload attachment", {
                  description:
                    error instanceof Error ? error.message : "Upload failed.",
                });
              } finally {
                setUploading(false);
              }
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
              const nextMentionRefs = reconcileMentionRefs(
                event.target.value,
                mentionRefs,
              );
              setDraft(event.target.value);
              setMentionRefs(nextMentionRefs);
              saveDraft(
                ownerPubkey,
                channel.id,
                parent?.id,
                event.target.value,
                event.target.selectionStart,
                attachments,
                nextMentionRefs,
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
            onValueChange={(value, selection, selectedMention) => {
              const nextMentionRefs = reconcileMentionRefs(
                value,
                mentionRefs,
                selectedMention,
              );
              setDraft(value);
              setMentionRefs(nextMentionRefs);
              saveDraft(
                ownerPubkey,
                channel.id,
                parent?.id,
                value,
                selection,
                attachments,
                nextMentionRefs,
              );
            }}
            textareaRef={textareaRef}
            value={draft}
          />
          <Button
            aria-label="Send message"
            disabled={
              (!draft.trim() && !attachments.length) || pending || uploading
            }
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
