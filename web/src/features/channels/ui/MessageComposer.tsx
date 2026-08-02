import { FileText, Send, UploadCloud, X } from "lucide-react";
import {
  type DragEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import type { CustomEmoji } from "@/features/settings/custom-emoji-api";
import { Button } from "@/shared/ui/button";
import { hasPrimaryShortcutModifier } from "@/shared/lib/keyboard-shortcuts";
import {
  mediaImetaTag,
  type Channel,
  type ChannelMessage,
  uploadMedia,
} from "../channel-api";
import { wrapComposerSelection } from "../composer-edit";
import {
  deleteDraft,
  type DraftAttachment,
  type DraftMentionRef,
  loadDraftState,
  saveDraft,
} from "../draft-store";
import type { DmCandidate } from "../dm-candidates";
import {
  findMentionQuery,
  reconcileMentionRefs,
  resolveMentionPubkeys,
} from "../mention-routing";
import { ComposerToolbar } from "./ComposerToolbar";

export type ComposerPayload = {
  content: string;
  mediaTags: string[][];
  mentionPubkeys: string[];
};

function isFileDrag(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

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
  const [isDragOver, setIsDragOver] = useState(false);
  const [mentionAutocomplete, setMentionAutocomplete] = useState<{
    query: string;
    start: number;
    selectedIndex: number;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepthRef = useRef(0);
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
    dragDepthRef.current = 0;
    setIsDragOver(false);
    setMentionAutocomplete(null);
  }, [channel.id, ownerPubkey, parent?.id]);

  useEffect(() => {
    const resetDragState = () => {
      dragDepthRef.current = 0;
      setIsDragOver(false);
    };
    window.addEventListener("drop", resetDragState);
    window.addEventListener("dragend", resetDragState);
    return () => {
      window.removeEventListener("drop", resetDragState);
      window.removeEventListener("dragend", resetDragState);
    };
  }, []);

  async function uploadFiles(selected: File[]) {
    if (!selected.length || pending || uploading) return;
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
      const next = [...saved.pendingImeta, ...uploaded];
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
        description: error instanceof Error ? error.message : "Upload failed.",
      });
    } finally {
      setUploading(false);
    }
  }

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
      setMentionAutocomplete(null);
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
  const mentionSuggestions = mentionAutocomplete
    ? mentionCandidates
        .filter((candidate) =>
          candidate.displayName
            .toLowerCase()
            .includes(mentionAutocomplete.query.trim().toLowerCase()),
        )
        .slice(0, 20)
    : [];

  function updateMentionAutocomplete(content: string, selection: number) {
    const query = findMentionQuery(content, selection);
    setMentionAutocomplete(query ? { ...query, selectedIndex: 0 } : null);
  }

  function selectMention(candidate: DmCandidate) {
    if (!mentionAutocomplete) return;
    const selection = textareaRef.current?.selectionStart ?? draft.length;
    const insertText = `@${candidate.displayName} `;
    const next = `${draft.slice(0, mentionAutocomplete.start)}${insertText}${draft.slice(selection)}`;
    const nextSelection = mentionAutocomplete.start + insertText.length;
    const nextMentionRefs = reconcileMentionRefs(next, mentionRefs, candidate);
    setDraft(next);
    setMentionRefs(nextMentionRefs);
    setMentionAutocomplete(null);
    saveDraft(
      ownerPubkey,
      channel.id,
      parent?.id,
      next,
      nextSelection,
      attachments,
      nextMentionRefs,
    );
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextSelection, nextSelection);
    });
  }

  function applyFormattingShortcut(
    before: string,
    after: string,
    placeholder: string,
  ) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? draft.length;
    const end = textarea?.selectionEnd ?? start;
    const edit = wrapComposerSelection(
      draft,
      start,
      end,
      before,
      after,
      placeholder,
    );
    const nextMentionRefs = reconcileMentionRefs(edit.value, mentionRefs);
    setDraft(edit.value);
    setMentionRefs(nextMentionRefs);
    setMentionAutocomplete(null);
    saveDraft(
      ownerPubkey,
      channel.id,
      parent?.id,
      edit.value,
      edit.selectionEnd,
      attachments,
      nextMentionRefs,
    );
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(
        edit.selectionStart,
        edit.selectionEnd,
      );
    });
  }

  return (
    <form
      className="relative border-t p-3 sm:p-4"
      onDragEnter={(event) => {
        if (!isFileDrag(event) || pending || uploading) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        if (dragDepthRef.current === 1) setIsDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDragOver(false);
      }}
      onDragOver={(event) => {
        if (!isFileDrag(event) || pending || uploading) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        if (!isFileDrag(event) || pending || uploading) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setIsDragOver(false);
        void uploadFiles(Array.from(event.dataTransfer.files));
      }}
      onSubmit={submit}
    >
      {isDragOver ? (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/10">
          <span className="flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background shadow-sm">
            <UploadCloud className="h-4 w-4" />
            <span>Drop files to upload</span>
          </span>
        </div>
      ) : null}
      <div className="relative mx-auto max-w-4xl rounded-md border bg-background shadow-xs focus-within:ring-1 focus-within:ring-ring">
        {mentionAutocomplete && mentionSuggestions.length ? (
          <div
            aria-label="Mention suggestions"
            className="absolute bottom-full left-2 z-20 mb-2 max-h-64 w-[min(24rem,calc(100vw-3rem))] overflow-y-auto rounded-md border bg-popover p-2 text-popover-foreground shadow-lg"
            role="listbox"
          >
            {mentionSuggestions.map((candidate, index) => (
              <button
                aria-label={`Mention ${candidate.displayName}`}
                aria-selected={index === mentionAutocomplete.selectedIndex}
                className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted ${
                  index === mentionAutocomplete.selectedIndex ? "bg-muted" : ""
                }`}
                key={candidate.pubkey}
                onClick={() => selectMention(candidate)}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
                type="button"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {candidate.displayName}
                </span>
                {candidate.isAgent ? (
                  <span className="text-xs text-muted-foreground">agent</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
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
              const selected = [...(event.target.files ?? [])];
              event.target.value = "";
              await uploadFiles(selected);
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
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.items)
                .filter((item) => item.kind === "file")
                .map((item) => item.getAsFile())
                .filter((file): file is File => file !== null);
              if (!files.length || pending || uploading) return;
              event.preventDefault();
              void uploadFiles(files);
            }}
            onChange={(event) => {
              const nextMentionRefs = reconcileMentionRefs(
                event.target.value,
                mentionRefs,
              );
              setDraft(event.target.value);
              setMentionRefs(nextMentionRefs);
              updateMentionAutocomplete(
                event.target.value,
                event.target.selectionStart,
              );
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
              if (
                hasPrimaryShortcutModifier(event) &&
                !event.altKey &&
                !event.repeat
              ) {
                const key = event.key.toLowerCase();
                if (key === "b" && !event.shiftKey) {
                  event.preventDefault();
                  applyFormattingShortcut("**", "**", "bold text");
                  return;
                }
                if (key === "i" && !event.shiftKey) {
                  event.preventDefault();
                  applyFormattingShortcut("_", "_", "italic text");
                  return;
                }
                if (key === "x" && event.shiftKey) {
                  event.preventDefault();
                  applyFormattingShortcut("~~", "~~", "text");
                  return;
                }
                if (key === "e" && !event.shiftKey) {
                  event.preventDefault();
                  applyFormattingShortcut("`", "`", "code");
                  return;
                }
                if (
                  key === "k" &&
                  !event.shiftKey &&
                  event.currentTarget.selectionStart !==
                    event.currentTarget.selectionEnd
                ) {
                  event.preventDefault();
                  applyFormattingShortcut("[", "](https://)", "link text");
                  return;
                }
              }
              if (mentionAutocomplete && mentionSuggestions.length) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const direction = event.key === "ArrowDown" ? 1 : -1;
                  setMentionAutocomplete((current) =>
                    current
                      ? {
                          ...current,
                          selectedIndex:
                            (current.selectedIndex +
                              direction +
                              mentionSuggestions.length) %
                            mentionSuggestions.length,
                        }
                      : null,
                  );
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  selectMention(
                    mentionSuggestions[mentionAutocomplete.selectedIndex],
                  );
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setMentionAutocomplete(null);
                  return;
                }
              }
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
              if (selectedMention) setMentionAutocomplete(null);
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
