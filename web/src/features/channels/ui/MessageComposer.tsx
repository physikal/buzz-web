import { Pencil, Send, UploadCloud, X } from "lucide-react";
import {
  type DragEvent,
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import type { CustomEmoji } from "@/features/settings/custom-emoji-api";
import { Button } from "@/shared/ui/button";
import { hasPrimaryShortcutModifier } from "@/shared/lib/keyboard-shortcuts";
import {
  buildOutgoingAttachmentContent,
  stripTrailingAttachmentMarkdown,
} from "../attachment-markdown";
import {
  mediaImetaTag,
  type Channel,
  type ChannelMessage,
  type MediaAttachment,
  uploadMedia,
} from "../channel-api";
import { wrapComposerSelection } from "../composer-edit";
import { buildCustomEmojiTags } from "../custom-emoji-tags";
import {
  deleteDraft,
  type DraftAttachment,
  type DraftMentionRef,
  loadDraftState,
  saveDraft,
} from "../draft-store";
import { usePersistentAgentAudience } from "../persistent-agent-audience";
import { useChannelLinks } from "../use-channel-links";
import type { DmCandidate } from "../dm-candidates";
import {
  findMentionQuery,
  hasNamedMention,
  reconcileMentionRefs,
  resolveMentionPubkeys,
} from "../mention-routing";
import { ComposerToolbar } from "./ComposerToolbar";
import { ComposerAttachments } from "./ComposerAttachments";
import { ChannelAutocomplete } from "./ChannelAutocomplete";
import { MentionAutocomplete } from "./MentionAutocomplete";

export type ComposerPayload = {
  content: string;
  mediaTags: string[][];
  mentionPubkeys: string[];
};

function persistentPrefix(refs: readonly DraftMentionRef[]) {
  return (
    refs.map((ref) => `@${ref.displayName}`).join(" ") +
    (refs.length ? " " : "")
  );
}

const EMPTY_INITIAL_AGENT_REFS: readonly DraftMentionRef[] = [];

type ComposerSnapshot = {
  attachments: DraftAttachment[];
  draft: string;
  mentionRefs: DraftMentionRef[];
  originalAttachmentByUrl: Map<string, DraftAttachment>;
  spoileredAttachmentUrls: Set<string>;
};

function editableAttachment(attachment: MediaAttachment): DraftAttachment {
  return {
    url: attachment.url,
    sha256: attachment.sha256 ?? "",
    size: attachment.size ?? 0,
    type: attachment.mimeType ?? "application/octet-stream",
    uploaded: 0,
    ...(attachment.dimensions ? { dim: attachment.dimensions } : {}),
    ...(attachment.thumbnailUrl ? { thumb: attachment.thumbnailUrl } : {}),
    ...(attachment.name ? { filename: attachment.name } : {}),
  };
}

function isFileDrag(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function MessageComposer({
  className = "relative border-t p-3 sm:p-4",
  channel,
  channels = [],
  parent,
  ownerPubkey,
  customEmoji,
  mentionCandidates,
  initialAgentRefs = EMPTY_INITIAL_AGENT_REFS,
  pending,
  placeholder: placeholderOverride,
  submitLabel = "Send message",
  onTyping,
  onSubmit,
  editTarget = null,
  onCancelEdit,
  onEditLastOwnMessage,
  onEditSubmit,
}: {
  className?: string;
  channel: Channel;
  channels?: Channel[];
  parent?: ChannelMessage | null;
  ownerPubkey: string;
  customEmoji: CustomEmoji[];
  mentionCandidates: DmCandidate[];
  initialAgentRefs?: readonly DraftMentionRef[];
  pending: boolean;
  placeholder?: string;
  submitLabel?: string;
  onTyping?: () => void;
  onSubmit: (payload: ComposerPayload) => Promise<void>;
  editTarget?: ChannelMessage | null;
  onCancelEdit?: () => void;
  onEditLastOwnMessage?: () => boolean;
  onEditSubmit?: (
    target: ChannelMessage,
    payload: ComposerPayload,
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState(
    () => loadDraftState(ownerPubkey, channel.id, parent?.id).content,
  );
  const [attachments, setAttachments] = useState<DraftAttachment[]>(
    () => loadDraftState(ownerPubkey, channel.id, parent?.id).pendingImeta,
  );
  const [spoileredAttachmentUrls, setSpoileredAttachmentUrls] = useState<
    Set<string>
  >(
    () =>
      new Set(
        loadDraftState(ownerPubkey, channel.id, parent?.id)
          .spoileredAttachmentUrls,
      ),
  );
  const [originalAttachmentByUrl, setOriginalAttachmentByUrl] = useState<
    Map<string, DraftAttachment>
  >(() => new Map());
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
  const channelLinks = useChannelLinks(channels);
  const fileInput = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepthRef = useRef(0);
  const draftRef = useRef(draft);
  const spoileredAttachmentUrlsRef = useRef(spoileredAttachmentUrls);
  const editTargetRef = useRef(editTarget);
  const preEditSnapshotRef = useRef<ComposerSnapshot | null>(null);
  const previousEditTargetIdRef = useRef<string | null>(null);
  const pendingEditFocusRef = useRef<{
    content: string;
    targetId: string;
  } | null>(null);
  const contextKey = `${channel.id}:${parent?.id ?? "root"}`;
  const operationContextKey = `${contextKey}:${editTarget?.id ?? "compose"}`;
  const operationContextKeyRef = useRef(operationContextKey);
  draftRef.current = draft;
  spoileredAttachmentUrlsRef.current = spoileredAttachmentUrls;
  editTargetRef.current = editTarget;
  operationContextKeyRef.current = operationContextKey;
  const lastTypingSent = useRef(0);
  const persistentAudience = usePersistentAgentAudience({
    ownerPubkey,
    channelId: channel.id,
    threadRootId: parent?.id ?? null,
    initialRefs: initialAgentRefs,
  });
  function reconcilePersistentAudience(nextRefs: DraftMentionRef[]) {
    if (editTargetRef.current) return;
    if (!persistentAudience.enabled) return;
    const present = new Set(nextRefs.map((ref) => ref.pubkey));
    const retained = persistentAudience.refs.filter((ref) =>
      present.has(ref.pubkey),
    );
    if (retained.length !== persistentAudience.refs.length)
      persistentAudience.setRefs(retained);
  }
  useEffect(() => {
    if (editTargetRef.current) return;
    const saved = loadDraftState(ownerPubkey, channel.id, parent?.id);
    const hydrate =
      persistentAudience.enabled &&
      !saved.content.trim() &&
      persistentAudience.refs.length;
    setDraft(
      hydrate ? persistentPrefix(persistentAudience.refs) : saved.content,
    );
    setAttachments(saved.pendingImeta);
    setSpoileredAttachmentUrls(new Set(saved.spoileredAttachmentUrls));
    setOriginalAttachmentByUrl(new Map());
    setMentionRefs(hydrate ? [...persistentAudience.refs] : saved.mentionRefs);
    dragDepthRef.current = 0;
    setIsDragOver(false);
    setMentionAutocomplete(null);
    channelLinks.clear();
  }, [
    channel.id,
    ownerPubkey,
    parent?.id,
    persistentAudience.enabled,
    persistentAudience.refs,
    channelLinks.clear,
  ]);
  // Desktop edit mode temporarily takes over the composer, then restores the
  // exact in-progress draft after save or cancel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: target identity is the transition trigger.
  useLayoutEffect(() => {
    const targetId = editTarget?.id ?? null;
    const previousId = previousEditTargetIdRef.current;
    if (targetId && targetId !== previousId && editTarget) {
      if (!preEditSnapshotRef.current) {
        preEditSnapshotRef.current = {
          attachments: [...attachments],
          draft,
          mentionRefs: [...mentionRefs],
          originalAttachmentByUrl: new Map(originalAttachmentByUrl),
          spoileredAttachmentUrls: new Set(spoileredAttachmentUrls),
        };
      }
      const editableBody = stripTrailingAttachmentMarkdown(
        editTarget.content,
        editTarget.attachments,
      );
      const editableAttachments =
        editTarget.attachments.map(editableAttachment);
      const editableMentions = mentionCandidates
        .filter((candidate) =>
          hasNamedMention(editableBody, candidate.displayName),
        )
        .map((candidate) => ({
          displayName: candidate.displayName,
          pubkey: candidate.pubkey,
          isAgent: candidate.isAgent,
        }));
      setDraft(editableBody);
      setAttachments(editableAttachments);
      setMentionRefs(editableMentions);
      setOriginalAttachmentByUrl(new Map());
      setSpoileredAttachmentUrls(
        new Set(
          editTarget.attachments
            .filter((attachment) => attachment.spoilered)
            .map((attachment) => attachment.url),
        ),
      );
      setMentionAutocomplete(null);
      channelLinks.clear();
      pendingEditFocusRef.current = {
        content: editableBody,
        targetId: editTarget.id,
      };
    } else if (!targetId && previousId && preEditSnapshotRef.current) {
      const snapshot = preEditSnapshotRef.current;
      preEditSnapshotRef.current = null;
      setDraft(snapshot.draft);
      setAttachments(snapshot.attachments);
      setMentionRefs(snapshot.mentionRefs);
      setOriginalAttachmentByUrl(snapshot.originalAttachmentByUrl);
      setSpoileredAttachmentUrls(snapshot.spoileredAttachmentUrls);
      setMentionAutocomplete(null);
      channelLinks.clear();
    }
    previousEditTargetIdRef.current = targetId;
  }, [editTarget?.id]);
  useLayoutEffect(() => {
    const pendingFocus = pendingEditFocusRef.current;
    const textarea = textareaRef.current;
    if (
      !pendingFocus ||
      pendingFocus.targetId !== editTarget?.id ||
      draft !== pendingFocus.content ||
      textarea?.value !== pendingFocus.content
    )
      return;
    pendingEditFocusRef.current = null;
    textarea.focus();
    textarea.setSelectionRange(
      pendingFocus.content.length,
      pendingFocus.content.length,
    );
  }, [draft, editTarget?.id]);
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
    const uploadContextKey = operationContextKey;
    const uploadEditTargetId = editTargetRef.current?.id ?? null;
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
      if (operationContextKeyRef.current !== uploadContextKey) return;
      if (uploadEditTargetId) {
        setAttachments((current) => [...current, ...uploaded]);
      } else {
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

  function replaceAttachment(currentUrl: string, replacement: DraftAttachment) {
    const nextSpoilers = new Set(spoileredAttachmentUrlsRef.current);
    if (nextSpoilers.delete(currentUrl)) nextSpoilers.add(replacement.url);
    spoileredAttachmentUrlsRef.current = nextSpoilers;
    setSpoileredAttachmentUrls(nextSpoilers);
    setAttachments((current) => {
      const next = current.map((attachment) =>
        attachment.url === currentUrl ? replacement : attachment,
      );
      if (!editTargetRef.current)
        saveDraft(
          ownerPubkey,
          channel.id,
          parent?.id,
          draftRef.current,
          textareaRef.current?.selectionStart ?? draftRef.current.length,
          next,
          undefined,
          [...nextSpoilers],
        );
      return next;
    });
  }

  async function editAttachment(attachment: DraftAttachment, blob: Blob) {
    if (pending || uploading) return;
    const editContextKey = operationContextKey;
    setUploading(true);
    try {
      const baseName =
        attachment.filename?.replace(/\.[^.]+$/, "") || "attachment";
      const media = await uploadMedia(
        new File([blob], `${baseName}-annotated.png`, { type: "image/png" }),
      );
      const replacement: DraftAttachment = {
        url: media.url,
        sha256: media.sha256,
        size: media.size,
        type: media.type,
        uploaded: Math.floor(Date.now() / 1_000),
        dim: media.dimensions,
        thumb: media.thumbnailUrl,
        filename: `${baseName}-annotated.png`,
      };
      if (operationContextKeyRef.current !== editContextKey) return;
      setOriginalAttachmentByUrl((current) => {
        const next = new Map(current);
        next.set(replacement.url, current.get(attachment.url) ?? attachment);
        next.delete(attachment.url);
        return next;
      });
      replaceAttachment(attachment.url, replacement);
    } finally {
      setUploading(false);
    }
  }

  function revertAttachment(attachment: DraftAttachment) {
    const original = originalAttachmentByUrl.get(attachment.url);
    if (!original) return;
    replaceAttachment(attachment.url, original);
    setOriginalAttachmentByUrl((current) => {
      const next = new Map(current);
      next.delete(attachment.url);
      return next;
    });
  }

  function removeAttachment(index: number) {
    setAttachments((current) => {
      const removed = current[index];
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      const nextSpoilers = new Set(spoileredAttachmentUrlsRef.current);
      if (removed) nextSpoilers.delete(removed.url);
      spoileredAttachmentUrlsRef.current = nextSpoilers;
      setSpoileredAttachmentUrls(nextSpoilers);
      if (!editTargetRef.current)
        saveDraft(
          ownerPubkey,
          channel.id,
          parent?.id,
          draftRef.current,
          textareaRef.current?.selectionStart ?? draftRef.current.length,
          next,
          undefined,
          [...nextSpoilers],
        );
      if (removed) {
        setOriginalAttachmentByUrl((originals) => {
          const updated = new Map(originals);
          updated.delete(removed.url);
          return updated;
        });
      }
      return next;
    });
  }

  function toggleAttachmentSpoiler(url: string) {
    const attachment = attachments.find((item) => item.url === url);
    if (
      !attachment ||
      (!attachment.type.startsWith("image/") &&
        !attachment.type.startsWith("video/"))
    )
      return;
    const next = new Set(spoileredAttachmentUrlsRef.current);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    spoileredAttachmentUrlsRef.current = next;
    setSpoileredAttachmentUrls(next);
    if (!editTargetRef.current)
      saveDraft(
        ownerPubkey,
        channel.id,
        parent?.id,
        draftRef.current,
        textareaRef.current?.selectionStart ?? draftRef.current.length,
        attachments,
        mentionRefs,
        [...next],
      );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const activeEditTarget = editTargetRef.current;
    const submitContextKey = operationContextKey;
    if (
      (!activeEditTarget && !draft.trim() && !attachments.length) ||
      pending ||
      uploading
    )
      return;
    setUploading(true);
    try {
      const mentionPubkeys = resolveMentionPubkeys(
        draft,
        mentionRefs,
        mentionCandidates,
      );
      const content = buildOutgoingAttachmentContent(
        draft,
        attachments,
        spoileredAttachmentUrls,
      );
      const mediaTags = [
        ...attachments.map((attachment) =>
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
        ),
        ...buildCustomEmojiTags(content, customEmoji),
      ];
      if (activeEditTarget && onEditSubmit) {
        const originalBody = stripTrailingAttachmentMarkdown(
          activeEditTarget.content,
          activeEditTarget.attachments,
        );
        const originalMentions = new Set(
          resolveMentionPubkeys(originalBody, [], mentionCandidates),
        );
        await onEditSubmit(activeEditTarget, {
          content,
          mediaTags,
          mentionPubkeys: mentionPubkeys.filter(
            (pubkey) => pubkey !== ownerPubkey && !originalMentions.has(pubkey),
          ),
        });
        return;
      }
      const audienceGeneration = persistentAudience.generation;
      const audienceRevision = persistentAudience.revision;
      const explicitAgentRefs = mentionCandidates
        .filter(
          (candidate) =>
            candidate.isAgent && mentionPubkeys.includes(candidate.pubkey),
        )
        .map((candidate) => ({
          displayName: candidate.displayName,
          pubkey: candidate.pubkey,
          isAgent: true,
        }));
      await onSubmit({
        content,
        mediaTags,
        mentionPubkeys,
      });
      const retainedRefs = persistentAudience.promoteRefs({
        expectedGeneration: audienceGeneration,
        expectedRevision: audienceRevision,
        refs: explicitAgentRefs,
      });
      setDraft(persistentPrefix(retainedRefs));
      setAttachments([]);
      setSpoileredAttachmentUrls(new Set());
      setOriginalAttachmentByUrl(new Map());
      setMentionRefs([...retainedRefs]);
      setMentionAutocomplete(null);
      channelLinks.clear();
      deleteDraft(ownerPubkey, parent?.id ? `thread:${parent.id}` : channel.id);
      requestAnimationFrame(() => {
        if (operationContextKeyRef.current === submitContextKey)
          textareaRef.current?.focus();
      });
    } finally {
      setUploading(false);
    }
  }

  const placeholder = editTarget
    ? "Edit message"
    : (placeholderOverride ??
      (parent
        ? "Reply in thread"
        : channel.channelType === "forum"
          ? "Create a new post"
          : channel.channelType === "dm"
            ? `Message ${channel.name}`
            : `Message #${channel.name}`));
  const mentionSuggestions = mentionAutocomplete
    ? mentionCandidates
        .filter((candidate) =>
          candidate.displayName
            .toLowerCase()
            .includes(mentionAutocomplete.query.trim().toLowerCase()),
        )
        .slice(0, 20)
    : [];
  function updateAutocompletes(content: string, selection: number) {
    const mention = findMentionQuery(content, selection);
    const hasChannelQuery = channelLinks.update(content, selection);
    setMentionAutocomplete(
      mention && !hasChannelQuery ? { ...mention, selectedIndex: 0 } : null,
    );
  }
  function selectMention(candidate: DmCandidate) {
    if (!mentionAutocomplete) return;
    const selection = textareaRef.current?.selectionStart ?? draft.length;
    const insertText = `@${candidate.displayName} `;
    const next = `${draft.slice(0, mentionAutocomplete.start)}${insertText}${draft.slice(selection)}`;
    const nextSelection = mentionAutocomplete.start + insertText.length;
    const nextMentionRefs = reconcileMentionRefs(next, mentionRefs, candidate);
    reconcilePersistentAudience(nextMentionRefs);
    setDraft(next);
    setMentionRefs(nextMentionRefs);
    setMentionAutocomplete(null);
    channelLinks.clear();
    if (!editTargetRef.current)
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
  function selectChannelLink(selected: Pick<Channel, "name">) {
    if (!channelLinks.autocomplete) return;
    const selection = textareaRef.current?.selectionStart ?? draft.length;
    const insertText = `#${selected.name} `;
    const next = `${draft.slice(0, channelLinks.autocomplete.start)}${insertText}${draft.slice(selection)}`;
    const nextSelection = channelLinks.autocomplete.start + insertText.length;
    const nextMentionRefs = reconcileMentionRefs(next, mentionRefs);
    reconcilePersistentAudience(nextMentionRefs);
    setDraft(next);
    setMentionRefs(nextMentionRefs);
    setMentionAutocomplete(null);
    channelLinks.clear();
    if (!editTargetRef.current)
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
    reconcilePersistentAudience(nextMentionRefs);
    setDraft(edit.value);
    setMentionRefs(nextMentionRefs);
    setMentionAutocomplete(null);
    channelLinks.clear();
    if (!editTargetRef.current)
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
      className={className}
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
        {editTarget ? (
          <div className="flex min-h-10 items-center gap-2 border-b bg-muted/55 px-3 text-sm">
            <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-medium">
              Editing message
            </span>
            <Button
              aria-label="Cancel edit"
              onClick={onCancelEdit}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          </div>
        ) : null}
        <ChannelAutocomplete
          onSelect={selectChannelLink}
          selectedIndex={channelLinks.autocomplete?.selectedIndex ?? 0}
          suggestions={channelLinks.suggestions}
        />
        <MentionAutocomplete
          onSelect={selectMention}
          selectedIndex={mentionAutocomplete?.selectedIndex ?? 0}
          suggestions={
            channelLinks.suggestions.length ? [] : mentionSuggestions
          }
        />
        {attachments.length ? (
          <ComposerAttachments
            attachments={attachments}
            disabled={pending || uploading}
            onEdit={editAttachment}
            onRemove={removeAttachment}
            onRevert={revertAttachment}
            onToggleSpoiler={toggleAttachmentSpoiler}
            originalByUrl={originalAttachmentByUrl}
            spoileredUrls={spoileredAttachmentUrls}
          />
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
              reconcilePersistentAudience(nextMentionRefs);
              setDraft(event.target.value);
              setMentionRefs(nextMentionRefs);
              updateAutocompletes(
                event.target.value,
                event.target.selectionStart,
              );
              if (!editTargetRef.current)
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
                if (!editTargetRef.current) onTyping?.();
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
              const channelResult = channelLinks.handleKeyDown(event);
              if (channelResult.suggestion)
                selectChannelLink(channelResult.suggestion);
              if (channelResult.handled) return;
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
              if (event.key === "Escape" && editTargetRef.current) {
                event.preventDefault();
                onCancelEdit?.();
                return;
              }
              if (
                event.key === "ArrowUp" &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !event.shiftKey &&
                !mentionAutocomplete &&
                !channelLinks.autocomplete &&
                !editTargetRef.current &&
                draft.length === 0 &&
                onEditLastOwnMessage?.()
              ) {
                event.preventDefault();
                return;
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
              reconcilePersistentAudience(nextMentionRefs);
              setDraft(value);
              setMentionRefs(nextMentionRefs);
              if (selectedMention) setMentionAutocomplete(null);
              channelLinks.clear();
              if (!editTargetRef.current)
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
            aria-label={editTarget ? "Save edit" : submitLabel}
            disabled={
              (!editTarget && !draft.trim() && !attachments.length) ||
              pending ||
              uploading ||
              Boolean(editTarget && !onEditSubmit)
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
