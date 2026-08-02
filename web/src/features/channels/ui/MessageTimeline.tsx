import {
  BellOff,
  BellRing,
  Download,
  Clock,
  Flag,
  MessageSquareReply,
  Pencil,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { relativeTime } from "@/shared/lib/relative-time";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import type { CustomEmoji } from "@/features/settings/custom-emoji-api";
import type { DmCandidate } from "../dm-candidates";
import { PresenceDot } from "@/features/profile/UserProfileDialog";
import type { PresenceStatus } from "@/features/presence/presence-api";
import type {
  Channel,
  ChannelMessage,
  MediaAttachment,
  UserProfile,
} from "../channel-api";
import { MessageComposer, type ComposerPayload } from "./MessageComposer";

export type MessageActions = {
  onReply: (message: ChannelMessage) => void;
  onEdit: (message: ChannelMessage, content: string) => Promise<void>;
  onDelete: (message: ChannelMessage) => void;
  onReport: (message: ChannelMessage) => void;
  onRemind: (message: ChannelMessage) => void;
  onOpenProfile: (pubkey: string) => void;
  onReact: (
    message: ChannelMessage,
    emoji: string,
    ownEventId: string | null,
    customEmojiUrl?: string,
  ) => void;
};

export function MessageTimeline({
  channel,
  messages,
  ownerPubkey,
  profiles,
  presence,
  agentNames,
  loading,
  selectedMessageId,
  customEmoji,
  actions,
}: {
  channel: Channel;
  messages: ChannelMessage[];
  ownerPubkey: string;
  profiles: Map<string, UserProfile>;
  presence: Map<string, PresenceStatus>;
  agentNames: Map<string, string>;
  loading: boolean;
  selectedMessageId?: string | null;
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
  const roots = messages.filter((message) => !message.parentId);

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
          agentNames={agentNames}
          forum={channel.channelType === "forum"}
          highlighted={selectedMessageId === message.id}
          customEmoji={customEmoji}
          key={message.id}
          message={message}
          ownerPubkey={ownerPubkey}
          profile={profiles.get(message.pubkey)}
          presence={presence.get(message.pubkey) ?? "offline"}
          replyCount={repliesByRoot.get(message.id) ?? 0}
        />
      ))}
    </div>
  );
}

function MessageRow({
  message,
  ownerPubkey,
  profile,
  presence,
  agentNames,
  replyCount,
  forum,
  highlighted,
  customEmoji,
  actions,
}: {
  message: ChannelMessage;
  ownerPubkey: string;
  profile?: UserProfile;
  presence: PresenceStatus;
  agentNames: Map<string, string>;
  replyCount: number;
  forum: boolean;
  highlighted: boolean;
  customEmoji: CustomEmoji[];
  actions: MessageActions;
}) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [reactionOpen, setReactionOpen] = useState(false);
  const author =
    message.pubkey === ownerPubkey
      ? "You"
      : (agentNames.get(message.pubkey) ??
        profile?.displayName ??
        truncatePubkey(message.pubkey));
  const initials = author.slice(0, 2).toUpperCase();

  return (
    <article
      className={`group relative flex gap-3 px-3 py-2 ${forum ? "rounded-md border bg-card py-4" : "rounded-md hover:bg-muted/40"} ${highlighted ? "bg-primary/10 ring-1 ring-primary/30" : ""}`}
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
        ) : editing ? (
          <form
            className="mt-2"
            onSubmit={async (event) => {
              event.preventDefault();
              await actions.onEdit(message, editContent);
              setEditing(false);
            }}
          >
            <textarea
              className="min-h-20 w-full rounded-md border bg-background p-2 text-sm"
              value={editContent}
              onChange={(event) => setEditContent(event.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <Button size="sm" type="submit">
                Save
              </Button>
              <Button
                onClick={() => setEditing(false)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="prose prose-sm mt-1 max-w-none break-words text-foreground dark:prose-invert prose-p:my-1 prose-pre:max-w-full prose-pre:overflow-x-auto">
              <ReactMarkdown
                components={{
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
                }}
                remarkPlugins={[remarkGfm]}
              >
                {expandCustomEmojiMarkdown(
                  renderSystemContent(message),
                  customEmoji,
                )}
              </ReactMarkdown>
            </div>
            <Attachments attachments={message.attachments} />
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
        {!message.deleted && replyCount ? (
          <button
            className="mt-2 text-xs font-medium text-primary hover:underline"
            onClick={() => actions.onReply(message)}
            type="button"
          >
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
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
          {message.pubkey === ownerPubkey ? (
            <>
              <Button
                aria-label="Edit message"
                onClick={() => setEditing(true)}
                size="icon"
                variant="ghost"
              >
                <Pencil />
              </Button>
              <Button
                aria-label="Delete message"
                onClick={() => actions.onDelete(message)}
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
    </article>
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
      {attachments.map((attachment) => {
        if (attachment.mimeType?.startsWith("image/"))
          return (
            <a
              href={attachment.url}
              key={attachment.url}
              rel="noreferrer"
              target="_blank"
            >
              <img
                alt={attachment.name ?? "Message attachment"}
                className="max-h-80 w-full rounded-md border object-contain"
                loading="lazy"
                src={attachment.thumbnailUrl ?? attachment.url}
              />
            </a>
          );
        if (attachment.mimeType?.startsWith("video/"))
          return (
            // User uploads do not currently carry WebVTT caption tracks.
            // biome-ignore lint/a11y/useMediaCaption: Render the user-provided media instead of hiding it.
            <video
              className="max-h-80 w-full rounded-md border"
              controls
              key={attachment.url}
              preload="metadata"
              src={attachment.url}
            />
          );
        if (attachment.mimeType?.startsWith("audio/"))
          return (
            // User uploads do not currently carry WebVTT caption tracks.
            // biome-ignore lint/a11y/useMediaCaption: Render the user-provided media instead of hiding it.
            <audio
              className="w-full"
              controls
              key={attachment.url}
              preload="metadata"
              src={attachment.url}
            />
          );
        return (
          <a
            className="flex items-center gap-3 rounded-md border p-3 text-sm hover:bg-muted"
            href={attachment.url}
            key={attachment.url}
            rel="noreferrer"
            target="_blank"
          >
            <Download className="h-5 w-5" />
            <span className="min-w-0 flex-1 truncate">
              {attachment.name ?? "Download attachment"}
            </span>
          </a>
        );
      })}
    </div>
  );
}

export function ThreadPanel({
  channel,
  root,
  messages,
  ownerPubkey,
  profiles,
  presence,
  agentNames,
  pending,
  actions,
  customEmoji,
  mentionCandidates,
  typingPubkeys,
  onClose,
  followed,
  onFollow,
  onUnfollow,
  onTyping,
  onSubmit,
}: {
  channel: Channel;
  root: ChannelMessage;
  messages: ChannelMessage[];
  ownerPubkey: string;
  profiles: Map<string, UserProfile>;
  presence: Map<string, PresenceStatus>;
  agentNames: Map<string, string>;
  pending: boolean;
  actions: MessageActions;
  customEmoji: CustomEmoji[];
  mentionCandidates: DmCandidate[];
  typingPubkeys: string[];
  onClose: () => void;
  followed: boolean;
  onFollow: () => void;
  onUnfollow: () => void;
  onTyping: () => void;
  onSubmit: (payload: ComposerPayload) => Promise<void>;
}) {
  const replies = messages.filter((message) => message.rootId === root.id);
  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col border-l bg-background lg:w-[28rem]">
      <header className="flex h-16 items-center border-b px-4">
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
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {[root, ...replies].map((message) => (
          <MessageRow
            actions={actions}
            customEmoji={customEmoji}
            agentNames={agentNames}
            forum={false}
            highlighted={false}
            key={message.id}
            message={message}
            ownerPubkey={ownerPubkey}
            profile={profiles.get(message.pubkey)}
            presence={presence.get(message.pubkey) ?? "offline"}
            replyCount={0}
          />
        ))}
      </div>
      <ThreadTypingLine profiles={profiles} pubkeys={typingPubkeys} />
      <MessageComposer
        channel={channel}
        customEmoji={customEmoji}
        mentionCandidates={mentionCandidates}
        ownerPubkey={ownerPubkey}
        parent={root}
        pending={pending}
        onSubmit={onSubmit}
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
