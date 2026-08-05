import {
  ArrowLeft,
  BellOff,
  BellRing,
  Download,
  Clock,
  Flag,
  HatGlasses,
  MessageSquareReply,
  Pencil,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { relativeTime } from "@/shared/lib/relative-time";
import remarkSpoilers from "@/shared/lib/remark-spoilers";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { spoilerComponent, SpoilerAwareAnchor } from "@/shared/ui/spoiler";
import type { CustomEmoji } from "@/features/settings/custom-emoji-api";
import type { DmCandidate } from "../dm-candidates";
import type { MessageEditScope } from "../use-message-edit-session";
import { stripTrailingAttachmentMarkdown } from "../attachment-markdown";
import { hasNamedMention } from "../mention-routing";
import { editLastOwnMessage } from "../message-management";
import { extractSupportedLinkPreviews } from "../link-preview";
import {
  type ResolvedMessageMentions,
  resolveMessageMentions,
} from "../message-mentions";
import remarkChannelLinks from "../remark-channel-links";
import remarkMentions from "../remark-mentions";
import { PresenceDot } from "@/features/presence/PresenceDot";
import type { PresenceStatus } from "@/features/presence/presence-api";
import type {
  Channel,
  ChannelMessage,
  MediaAttachment,
  UserProfile,
} from "../channel-api";
import { MessageComposer, type ComposerPayload } from "./MessageComposer";
import { DeleteMessageDialog } from "./DeleteMessageDialog";
import { MessageMoreActions } from "./MessageMoreActions";
import { LinkPreviewCards } from "./LinkPreviewCards";
import { WaveMessageAttachment } from "./WaveMessageAttachment";
import { parseWaveMessageContent } from "../wave-message";

const interactiveSpoilerComponent = spoilerComponent();

export type MessageActions = {
  canManage: (message: ChannelMessage) => boolean;
  onReply: (message: ChannelMessage) => void;
  onEdit: (message: ChannelMessage, scope: MessageEditScope) => void;
  onDelete: (message: ChannelMessage) => Promise<void>;
  deletePending: boolean;
  onReport: (message: ChannelMessage) => void;
  onRemind: (message: ChannelMessage) => void;
  isUnread: (message: ChannelMessage) => boolean;
  onMarkRead: (message: ChannelMessage) => void;
  onMarkUnread: (message: ChannelMessage) => void;
  onOpenChannel: (channelId: string) => void;
  onOpenProfile: (pubkey: string) => void;
  onReact: (
    message: ChannelMessage,
    emoji: string,
    ownEventId: string | null,
    customEmojiUrl?: string,
  ) => void;
  onStartHuddle?: () => void;
  huddlePending?: boolean;
};

export function MessageTimeline({
  channel,
  channels,
  messages,
  ownerPubkey,
  profiles,
  presence,
  agentNames,
  loading,
  selectedMessageId,
  matchingMessageIds,
  customEmoji,
  actions,
}: {
  channel: Channel;
  channels: Channel[];
  messages: ChannelMessage[];
  ownerPubkey: string;
  profiles: Map<string, UserProfile>;
  presence: Map<string, PresenceStatus>;
  agentNames: Map<string, string>;
  loading: boolean;
  selectedMessageId?: string | null;
  matchingMessageIds?: ReadonlySet<string>;
  customEmoji: CustomEmoji[];
  actions: MessageActions;
}) {
  const repliesByRoot = useMemo(() => {
    const counts = new Map<string, number>();
    for (const message of messages) {
      if (message.rootId)
        counts.set(message.rootId, (counts.get(message.rootId) ?? 0) + 1);
    }
    return counts;
  }, [messages]);
  const roots = messages.filter(
    (message) =>
      !message.parentId &&
      (channel.channelType !== "forum" || message.kind === 45001),
  );

  if (loading) return <CenteredMessage>Loading messages…</CenteredMessage>;
  if (!roots.length) {
    return (
      <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <MessageSquareReply className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">
          {channel.channelType === "dm"
            ? "Start the conversation"
            : `Welcome to #${channel.name}`}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {channel.channelType === "forum"
            ? "Create the first post in this forum."
            : "This is the start of the conversation."}
        </p>
      </div>
    );
  }
  return (
    <div
      className={`mx-auto max-w-4xl ${channel.channelType === "forum" ? "space-y-2" : "space-y-1"}`}
    >
      {roots.map((message) => (
        <MessageRow
          actions={actions}
          channelId={channel.id}
          channels={channels}
          agentNames={agentNames}
          forum={channel.channelType === "forum"}
          highlighted={selectedMessageId === message.id}
          matched={matchingMessageIds?.has(message.id) ?? false}
          customEmoji={customEmoji}
          key={message.id}
          message={message}
          ownerPubkey={ownerPubkey}
          profiles={profiles}
          presence={presence.get(message.pubkey) ?? "offline"}
          replyCount={repliesByRoot.get(message.id) ?? 0}
          scope="main"
        />
      ))}
    </div>
  );
}

function MessageRow({
  channelId,
  channels,
  message,
  ownerPubkey,
  profiles,
  presence,
  agentNames,
  replyCount,
  forum,
  highlighted,
  matched,
  customEmoji,
  actions,
  scope,
}: {
  channelId: string;
  channels: Channel[];
  message: ChannelMessage;
  ownerPubkey: string;
  profiles: Map<string, UserProfile>;
  presence: PresenceStatus;
  agentNames: Map<string, string>;
  replyCount: number;
  forum: boolean;
  highlighted: boolean;
  matched: boolean;
  customEmoji: CustomEmoji[];
  actions: MessageActions;
  scope: MessageEditScope;
}) {
  const [reactionOpen, setReactionOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const profile = profiles.get(message.pubkey);
  const mentions = useMemo(
    () => resolveMessageMentions(message, profiles, agentNames),
    [agentNames, message, profiles],
  );
  const channelNames = useMemo(
    () =>
      channels
        .filter((candidate) => candidate.channelType !== "dm")
        .map((candidate) => candidate.name),
    [channels],
  );
  const linkPreviews = useMemo(
    () =>
      message.kind === 40099
        ? []
        : extractSupportedLinkPreviews(message.content),
    [message.content, message.kind],
  );
  const waveMessage = useMemo(
    () => parseWaveMessageContent(message.content),
    [message.content],
  );
  const markdownComponents = {
    spoiler: interactiveSpoilerComponent,
    a: SpoilerAwareAnchor,
    "channel-link": ({ children }: { children?: React.ReactNode }) => (
      <ChannelLinkChip
        channels={channels}
        onOpenChannel={actions.onOpenChannel}
      >
        {children}
      </ChannelLinkChip>
    ),
    mention: ({ children }: { children?: React.ReactNode }) => (
      <MentionChip mentions={mentions} onOpenProfile={actions.onOpenProfile}>
        {children}
      </MentionChip>
    ),
    img: ({ alt, title, ...props }) => (
      <img
        {...props}
        alt={alt ?? ""}
        className={
          title === "buzz-custom-emoji"
            ? "not-prose mx-0.5 inline h-5 w-5 object-contain align-text-bottom"
            : undefined
        }
        title={title}
      />
    ),
  } as Components;
  const author =
    message.pubkey === ownerPubkey
      ? "You"
      : (agentNames.get(message.pubkey) ??
        profile?.displayName ??
        truncatePubkey(message.pubkey));
  const initials = author.slice(0, 2).toUpperCase();

  return (
    <article
      className={`group relative flex gap-3 px-3 py-2 ${forum ? "rounded-md border bg-card py-4" : "rounded-md hover:bg-muted/40"} ${matched ? "bg-amber-500/10" : ""} ${highlighted ? "bg-primary/10 ring-1 ring-primary/30" : ""}`}
      id={`message-${message.id}`}
    >
      <button
        aria-label={`Open ${author} profile`}
        className="relative h-9 w-9 shrink-0"
        onClick={() => actions.onOpenProfile(message.pubkey)}
        type="button"
      >
        {profile?.avatarUrl ? (
          <img
            alt=""
            className="h-9 w-9 rounded-md object-cover"
            src={profile.avatarUrl}
          />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-xs font-semibold">
            {initials}
          </span>
        )}
        <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-background bg-background">
          <PresenceDot status={presence} />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <button
            className="text-sm font-semibold hover:underline"
            onClick={() => actions.onOpenProfile(message.pubkey)}
            type="button"
          >
            {author}
          </button>
          <time
            className="text-xs text-muted-foreground"
            dateTime={new Date(message.createdAt * 1000).toISOString()}
          >
            {relativeTime(message.createdAt)}
          </time>
          {message.edited ? (
            <span className="text-xs text-muted-foreground">edited</span>
          ) : null}
        </div>
        {message.deleted ? (
          <p className="mt-1 text-sm italic text-muted-foreground">
            This message was deleted.
          </p>
        ) : waveMessage ? (
          <WaveMessageAttachment
            fallbackText={waveMessage.fallbackText}
            huddlePending={actions.huddlePending}
            onStartHuddle={actions.onStartHuddle}
          />
        ) : (
          <>
            <div className="prose prose-sm mt-1 max-w-none break-words text-foreground dark:prose-invert prose-p:my-1 prose-pre:max-w-full prose-pre:overflow-x-auto">
              <ReactMarkdown
                components={markdownComponents}
                remarkPlugins={[
                  remarkGfm,
                  remarkSpoilers,
                  [remarkMentions, { mentionNames: mentions.names }],
                  [remarkChannelLinks, { channelNames }],
                ]}
              >
                {expandCustomEmojiMarkdown(
                  stripTrailingAttachmentMarkdown(
                    renderSystemContent(message),
                    message.attachments,
                  ),
                  customEmoji,
                )}
              </ReactMarkdown>
            </div>
            <Attachments attachments={message.attachments} />
            <LinkPreviewCards previews={linkPreviews} />
          </>
        )}
        {!message.deleted && message.reactions.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.reactions.map((reaction) => (
              <button
                aria-label={`${reaction.emoji} reaction from ${reaction.count}`}
                className={`rounded-md border px-2 py-0.5 text-xs ${reaction.ownEventId ? "border-primary bg-primary/10" : "hover:bg-muted"}`}
                key={reaction.emoji}
                onClick={() =>
                  actions.onReact(message, reaction.emoji, reaction.ownEventId)
                }
                type="button"
              >
                <ReactionEmoji emoji={reaction.emoji} palette={customEmoji} />
                {reaction.count}
              </button>
            ))}
          </div>
        ) : null}
        {!message.deleted && (forum || replyCount > 0) ? (
          <button
            className="mt-2 text-xs font-medium text-primary hover:underline"
            onClick={() => actions.onReply(message)}
            type="button"
          >
            {replyCount > 0
              ? `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`
              : "View post"}
          </button>
        ) : null}
      </div>
      {!message.deleted ? (
        <div className="absolute right-2 top-1 hidden items-center rounded-md border bg-background shadow-sm group-hover:flex group-focus-within:flex">
          <Button
            aria-label="Reply"
            onClick={() => actions.onReply(message)}
            size="icon"
            variant="ghost"
          >
            <MessageSquareReply />
          </Button>
          <div className="relative">
            <Button
              aria-label="Add reaction"
              onClick={() => setReactionOpen((value) => !value)}
              size="icon"
              variant="ghost"
            >
              <SmilePlus />
            </Button>
            {reactionOpen ? (
              <div className="absolute right-0 top-9 z-20 flex max-w-72 flex-wrap rounded-md border bg-popover p-1 shadow-lg">
                {["👍", "❤️", "😂", "🎉", "👀"].map((emoji) => (
                  <button
                    className="rounded p-1.5 text-base hover:bg-muted"
                    key={emoji}
                    onClick={() => {
                      actions.onReact(message, emoji, null);
                      setReactionOpen(false);
                    }}
                    type="button"
                  >
                    {emoji}
                  </button>
                ))}
                {customEmoji.map((emoji) => (
                  <button
                    aria-label={`React with :${emoji.shortcode}:`}
                    className="rounded p-1.5 hover:bg-muted"
                    key={emoji.shortcode}
                    onClick={() => {
                      actions.onReact(
                        message,
                        `:${emoji.shortcode}:`,
                        null,
                        emoji.url,
                      );
                      setReactionOpen(false);
                    }}
                    type="button"
                  >
                    <img
                      alt=""
                      className="h-5 w-5 object-contain"
                      src={emoji.url}
                    />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <Button
            aria-label="Remind me later"
            onClick={() => actions.onRemind(message)}
            size="icon"
            variant="ghost"
          >
            <Clock />
          </Button>
          <MessageMoreActions
            channelId={channelId}
            message={message}
            onMarkRead={() => actions.onMarkRead(message)}
            onMarkUnread={() => actions.onMarkUnread(message)}
            unread={actions.isUnread(message)}
          />
          {actions.canManage(message) ? (
            <>
              <Button
                aria-label="Edit message"
                onClick={() => actions.onEdit(message, scope)}
                size="icon"
                variant="ghost"
              >
                <Pencil />
              </Button>
              <Button
                aria-label="Delete message"
                onClick={() => setDeleteOpen(true)}
                size="icon"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </>
          ) : (
            <Button
              aria-label="Report message"
              onClick={() => actions.onReport(message)}
              size="icon"
              variant="ghost"
            >
              <Flag />
            </Button>
          )}
        </div>
      ) : null}
      <DeleteMessageDialog
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          void actions
            .onDelete(message)
            .then(() => {
              setDeleteOpen(false);
            })
            .catch(() => {});
        }}
        open={deleteOpen}
        pending={actions.deletePending}
      />
    </article>
  );
}

function MentionChip({
  children,
  mentions,
  onOpenProfile,
}: {
  children?: React.ReactNode;
  mentions: ResolvedMessageMentions;
  onOpenProfile: (pubkey: string) => void;
}) {
  const mentionText = String(children ?? "");
  const name = mentionText.replace(/^@/u, "").trim();
  const normalizedName = name.toLowerCase();
  const pubkey = mentions.pubkeysByName.get(normalizedName);
  const isAgent =
    pubkey !== undefined &&
    mentions.agentPubkeysByName.get(normalizedName) === pubkey;
  const content = isAgent ? (
    name
  ) : (
    <>
      <span className="inline-block -translate-y-px">@</span>
      {name}
    </>
  );
  const className = `inline-flex min-h-5 items-center rounded-sm px-1 py-0.5 font-medium leading-none ${
    isAgent
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : "bg-primary/15 text-primary"
  }`;
  if (!pubkey)
    return (
      <span className={className} data-mention="">
        {content}
      </span>
    );
  return (
    <button
      className={`${className} cursor-pointer hover:bg-primary/25`}
      data-mention=""
      onClick={() => onOpenProfile(pubkey)}
      type="button"
    >
      {content}
    </button>
  );
}

function ChannelLinkChip({
  channels,
  children,
  onOpenChannel,
}: {
  channels: Channel[];
  children?: React.ReactNode;
  onOpenChannel: (channelId: string) => void;
}) {
  const text = String(children ?? "");
  const channelName = text.replace(/^#/u, "");
  const channel = channels.find(
    (candidate) =>
      candidate.channelType !== "dm" &&
      candidate.name.toLowerCase() === channelName.toLowerCase(),
  );
  const className =
    "inline-flex min-h-5 items-center rounded-sm bg-primary/15 px-1 py-0.5 font-medium leading-none text-primary";
  if (!channel)
    return (
      <span className={className} data-channel-link="">
        {text}
      </span>
    );
  return (
    <button
      aria-label={`Open channel ${channelName}`}
      className={`${className} cursor-pointer hover:bg-primary/25`}
      data-channel-link=""
      onClick={() => onOpenChannel(channel.id)}
      type="button"
    >
      {text}
    </button>
  );
}

function renderSystemContent(message: ChannelMessage): string {
  if (message.kind !== 40099) return message.content;
  try {
    const content = JSON.parse(message.content) as { type?: string };
    return content.type?.replace(/_/g, " ") ?? "Channel updated";
  } catch {
    return message.content;
  }
}

function expandCustomEmojiMarkdown(
  content: string,
  palette: CustomEmoji[],
): string {
  if (!palette.length || !content.includes(":")) return content;
  const byName = new Map(palette.map((emoji) => [emoji.shortcode, emoji.url]));
  return content
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part.replace(/:([a-z0-9_-]+):/gi, (match, rawName: string) => {
        const url = byName.get(rawName.toLowerCase());
        if (!url) return match;
        const safeUrl = url.replace(/\(/g, "%28").replace(/\)/g, "%29");
        return `![${match}](${safeUrl} "buzz-custom-emoji")`;
      });
    })
    .join("");
}

function Attachments({ attachments }: { attachments: MediaAttachment[] }) {
  if (!attachments.length) return null;
  return (
    <div className="mt-3 grid max-w-2xl gap-2 sm:grid-cols-2">
      {attachments.map((attachment) => (
        <MessageAttachment attachment={attachment} key={attachment.url} />
      ))}
    </div>
  );
}

function MessageAttachment({ attachment }: { attachment: MediaAttachment }) {
  const [revealed, setRevealed] = useState(!attachment.spoilered);
  useEffect(() => {
    setRevealed(!attachment.spoilered);
  }, [attachment.spoilered]);
  const mediaLabel = attachment.mimeType?.startsWith("video/")
    ? "video"
    : "image";

  if (attachment.mimeType?.startsWith("image/"))
    return (
      <div className="relative overflow-hidden rounded-md border">
        <a
          aria-label={`Open ${attachment.name ?? "message attachment"}`}
          href={attachment.url}
          rel="noreferrer"
          target="_blank"
        >
          <img
            alt={attachment.name ?? "Message attachment"}
            className={`max-h-80 w-full object-contain ${revealed ? "" : "blur-2xl brightness-75"}`}
            loading="lazy"
            src={attachment.thumbnailUrl ?? attachment.url}
          />
        </a>
        {!revealed ? (
          <SpoilerReveal
            label={mediaLabel}
            onReveal={() => setRevealed(true)}
          />
        ) : null}
      </div>
    );
  if (attachment.mimeType?.startsWith("video/"))
    return (
      <div className="relative overflow-hidden rounded-md border">
        {/* User uploads do not currently carry WebVTT caption tracks. */}
        {/* biome-ignore lint/a11y/useMediaCaption: Render the user-provided media instead of hiding it. */}
        <video
          className={`max-h-80 w-full ${revealed ? "" : "blur-2xl brightness-75"}`}
          controls={revealed}
          preload="metadata"
          src={attachment.url}
        />
        {!revealed ? (
          <SpoilerReveal
            label={mediaLabel}
            onReveal={() => setRevealed(true)}
          />
        ) : null}
      </div>
    );
  if (attachment.mimeType?.startsWith("audio/"))
    return (
      // User uploads do not currently carry WebVTT caption tracks.
      // biome-ignore lint/a11y/useMediaCaption: Render the user-provided media instead of hiding it.
      <audio
        className="w-full"
        controls
        preload="metadata"
        src={attachment.url}
      />
    );
  return (
    <a
      className="flex items-center gap-3 rounded-md border p-3 text-sm hover:bg-muted"
      href={attachment.url}
      rel="noreferrer"
      target="_blank"
    >
      <Download className="h-5 w-5" />
      <span className="min-w-0 flex-1 truncate">
        {attachment.name ?? "Download attachment"}
      </span>
    </a>
  );
}

function SpoilerReveal({
  label,
  onReveal,
}: {
  label: string;
  onReveal: () => void;
}) {
  return (
    <button
      aria-label={`Reveal spoilered ${label}`}
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/45 text-sm font-medium text-foreground"
      onClick={onReveal}
      type="button"
    >
      <HatGlasses className="h-6 w-6" />
      <span>Reveal spoiler</span>
    </button>
  );
}

export function ThreadPanel({
  channel,
  channels,
  root,
  messages,
  ownerPubkey,
  profiles,
  presence,
  agentNames,
  editTarget,
  pending,
  actions,
  customEmoji,
  mentionCandidates,
  typingPubkeys,
  onClose,
  onCancelEdit,
  onEditSubmit,
  followed,
  onFollow,
  onUnfollow,
  onTyping,
  onSubmit,
  selectedMessageId,
  matchingMessageIds,
  forum = false,
  layout = "split",
}: {
  channel: Channel;
  channels: Channel[];
  root: ChannelMessage;
  messages: ChannelMessage[];
  ownerPubkey: string;
  profiles: Map<string, UserProfile>;
  presence: Map<string, PresenceStatus>;
  agentNames: Map<string, string>;
  editTarget: ChannelMessage | null;
  pending: boolean;
  actions: MessageActions;
  customEmoji: CustomEmoji[];
  mentionCandidates: DmCandidate[];
  typingPubkeys: string[];
  onClose: () => void;
  onCancelEdit: () => void;
  onEditSubmit: (
    target: ChannelMessage,
    payload: ComposerPayload,
  ) => Promise<void>;
  followed: boolean;
  onFollow: () => void;
  onUnfollow: () => void;
  onTyping: () => void;
  onSubmit: (payload: ComposerPayload) => Promise<void>;
  selectedMessageId?: string | null;
  matchingMessageIds?: ReadonlySet<string>;
  forum?: boolean;
  layout?: "focus" | "split";
}) {
  const replies = messages.filter((message) => message.rootId === root.id);
  const initialAgentRefs = useMemo(() => {
    if (root.pubkey !== ownerPubkey) return [];
    const content = root.content.toLocaleLowerCase();
    return mentionCandidates
      .filter(
        (candidate) =>
          candidate.isAgent &&
          hasNamedMention(root.content, candidate.displayName) &&
          root.tags.some(
            (tag) => tag[0] === "p" && tag[1] === candidate.pubkey,
          ),
      )
      .map((candidate) => ({
        displayName: candidate.displayName,
        pubkey: candidate.pubkey,
        isAgent: true,
        position: content.indexOf(
          `@${candidate.displayName.toLocaleLowerCase()}`,
        ),
      }))
      .sort((left, right) => left.position - right.position)
      .filter(
        (candidate, index, candidates) =>
          candidates.findIndex((item) => item.pubkey === candidate.pubkey) ===
          index,
      )
      .map(({ position: _position, ...candidate }) => candidate);
  }, [mentionCandidates, ownerPubkey, root.content, root.pubkey, root.tags]);
  return (
    <aside
      aria-label={forum ? "Forum thread" : "Thread"}
      className={`flex min-h-0 w-full shrink-0 flex-col bg-background ${forum ? "flex-1" : layout === "focus" ? "h-full border-l" : "border-l lg:w-[28rem]"}`}
    >
      <header className="flex h-16 items-center border-b px-4">
        {forum ? (
          <Button
            className="gap-1.5 text-muted-foreground"
            onClick={onClose}
            size="sm"
            variant="ghost"
          >
            <ArrowLeft /> Back to posts
          </Button>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Thread</h2>
              <p className="truncate text-xs text-muted-foreground">
                #{channel.name}
              </p>
            </div>
            <Button
              aria-label={followed ? "Unfollow thread" : "Follow thread"}
              onClick={followed ? onUnfollow : onFollow}
              size="icon"
              title={followed ? "Unfollow thread" : "Follow thread"}
              variant="ghost"
            >
              {followed ? <BellOff /> : <BellRing />}
            </Button>
            <Button
              aria-label="Close thread"
              onClick={onClose}
              size="icon"
              variant="ghost"
            >
              <X />
            </Button>
          </>
        )}
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {[root, ...replies].map((message) => (
          <MessageRow
            actions={actions}
            channelId={channel.id}
            channels={channels}
            customEmoji={customEmoji}
            agentNames={agentNames}
            forum={false}
            highlighted={selectedMessageId === message.id}
            matched={matchingMessageIds?.has(message.id) ?? false}
            key={message.id}
            message={message}
            ownerPubkey={ownerPubkey}
            profiles={profiles}
            presence={presence.get(message.pubkey) ?? "offline"}
            replyCount={0}
            scope="thread"
          />
        ))}
      </div>
      <ThreadTypingLine profiles={profiles} pubkeys={typingPubkeys} />
      <MessageComposer
        channel={channel}
        channels={channels}
        customEmoji={customEmoji}
        editTarget={editTarget}
        initialAgentRefs={initialAgentRefs}
        mentionCandidates={mentionCandidates}
        ownerPubkey={ownerPubkey}
        parent={root}
        pending={pending}
        onSubmit={onSubmit}
        onCancelEdit={onCancelEdit}
        onEditLastOwnMessage={() =>
          editLastOwnMessage([root, ...replies], ownerPubkey, (message) =>
            actions.onEdit(message, "thread"),
          )
        }
        onEditSubmit={onEditSubmit}
        onTyping={onTyping}
      />
    </aside>
  );
}

function ThreadTypingLine({
  pubkeys,
  profiles,
}: {
  pubkeys: string[];
  profiles: Map<string, UserProfile>;
}) {
  if (!pubkeys.length) return null;
  const names = pubkeys.map(
    (pubkey) => profiles.get(pubkey)?.displayName || truncatePubkey(pubkey),
  );
  return (
    <p className="px-4 pt-2 text-xs text-muted-foreground" role="status">
      {names.length === 1
        ? `${names[0]} is typing…`
        : `${names.slice(0, 2).join(" and ")} are typing…`}
    </p>
  );
}

function ReactionEmoji({
  emoji,
  palette,
}: {
  emoji: string;
  palette: CustomEmoji[];
}) {
  if (emoji.startsWith(":") && emoji.endsWith(":")) {
    const custom = palette.find(
      (item) => item.shortcode === emoji.slice(1, -1),
    );
    if (custom)
      return (
        <img
          alt={emoji}
          className="mr-1 inline h-4 w-4 object-contain"
          src={custom.url}
        />
      );
  }
  return <span className="mr-1">{emoji}</span>;
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
