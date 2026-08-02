import {
  Archive,
  BellOff,
  Hash,
  LayoutList,
  Mail,
  MailOpen,
  MessageCircle,
  Plus,
  Star,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import type { Channel } from "../channel-api";

export function ChannelSidebar({
  channels,
  selectedId,
  unread,
  mutedChannelIds,
  starredChannelIds,
  onSelect,
  onCreate,
  onNewDm,
  onBrowse,
  onStarredChange,
  onMarkRead,
  onMarkUnread,
}: {
  channels: Channel[];
  selectedId: string | null;
  unread: Record<string, number>;
  mutedChannelIds: ReadonlySet<string>;
  starredChannelIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onNewDm: () => void;
  onBrowse: () => void;
  onStarredChange: (id: string, starred: boolean) => void;
  onMarkRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
}) {
  const streams = channels.filter(
    (channel) => channel.channelType === "stream",
  );
  const starred = streams.filter((channel) =>
    starredChannelIds.has(channel.id),
  );
  const shared = streams.filter(
    (channel) => !starredChannelIds.has(channel.id),
  );
  const forums = channels.filter((channel) => channel.channelType === "forum");
  const dms = channels.filter((channel) => channel.channelType === "dm");
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-background sm:flex sm:flex-col">
      <div className="flex h-16 items-center justify-between border-b px-4">
        <span className="font-semibold">Buzz</span>
        <Button
          aria-label="Create channel"
          onClick={onCreate}
          size="icon"
          variant="ghost"
        >
          <Plus />
        </Button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
        {starred.length ? (
          <>
            <SectionHeader label="Starred" />
            {starred.map((channel) => (
              <ChannelButton
                channel={channel}
                key={channel.id}
                muted={mutedChannelIds.has(channel.id)}
                onClick={() => onSelect(channel.id)}
                onReadChange={() =>
                  (unread[channel.id] ?? 0)
                    ? onMarkRead(channel.id)
                    : onMarkUnread(channel.id)
                }
                onStarredChange={() => onStarredChange(channel.id, false)}
                selected={selectedId === channel.id}
                starred
                unread={unread[channel.id] ?? 0}
              />
            ))}
            <div className="mt-5" />
          </>
        ) : null}
        <SectionHeader label="Channels" onAdd={onCreate} onBrowse={onBrowse} />
        {shared.map((channel) => (
          <ChannelButton
            channel={channel}
            key={channel.id}
            selected={selectedId === channel.id}
            muted={mutedChannelIds.has(channel.id)}
            onStarredChange={() => onStarredChange(channel.id, true)}
            unread={unread[channel.id] ?? 0}
            onClick={() => onSelect(channel.id)}
            onReadChange={() =>
              (unread[channel.id] ?? 0)
                ? onMarkRead(channel.id)
                : onMarkUnread(channel.id)
            }
          />
        ))}
        {forums.length ? (
          <div className="mt-5">
            <SectionHeader label="Forums" onAdd={onCreate} />
          </div>
        ) : null}
        {forums.map((channel) => (
          <ChannelButton
            channel={channel}
            key={channel.id}
            muted={mutedChannelIds.has(channel.id)}
            onClick={() => onSelect(channel.id)}
            onReadChange={() =>
              (unread[channel.id] ?? 0)
                ? onMarkRead(channel.id)
                : onMarkUnread(channel.id)
            }
            selected={selectedId === channel.id}
            unread={unread[channel.id] ?? 0}
          />
        ))}
        <div className="mt-5">
          <SectionHeader label="Direct messages" onAdd={onNewDm} />
        </div>
        {dms.map((channel) => (
          <ChannelButton
            channel={channel}
            key={channel.id}
            selected={selectedId === channel.id}
            muted={mutedChannelIds.has(channel.id)}
            unread={unread[channel.id] ?? 0}
            onClick={() => onSelect(channel.id)}
            onReadChange={() =>
              (unread[channel.id] ?? 0)
                ? onMarkRead(channel.id)
                : onMarkUnread(channel.id)
            }
          />
        ))}
        {!dms.length ? (
          <button
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-muted-foreground hover:bg-accent"
            onClick={onNewDm}
            type="button"
          >
            <MessageCircle className="h-4 w-4" />
            Start a conversation
          </button>
        ) : null}
      </nav>
    </aside>
  );
}

function SectionHeader({
  label,
  onAdd,
  onBrowse,
}: {
  label: string;
  onAdd?: () => void;
  onBrowse?: () => void;
}) {
  return (
    <div className="mb-1 flex items-center justify-between px-2 text-xs font-semibold uppercase text-muted-foreground">
      <span>{label}</span>
      <span className="flex items-center gap-0.5">
        {onBrowse ? (
          <button
            aria-label="Browse channels"
            className="rounded p-1 hover:bg-accent"
            onClick={onBrowse}
            title="Browse channels"
            type="button"
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {onAdd ? (
          <button
            aria-label={`Add ${label.toLowerCase()}`}
            className="rounded p-1 hover:bg-accent"
            onClick={onAdd}
            type="button"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </span>
    </div>
  );
}

function ChannelButton({
  channel,
  selected,
  unread,
  muted,
  starred = false,
  onClick,
  onStarredChange,
  onReadChange,
}: {
  channel: Channel;
  selected: boolean;
  unread: number;
  muted: boolean;
  starred?: boolean;
  onClick: () => void;
  onStarredChange?: () => void;
  onReadChange?: () => void;
}) {
  const Icon =
    channel.channelType === "forum"
      ? LayoutList
      : channel.channelType === "dm"
        ? MessageCircle
        : Hash;
  return (
    <div
      className={`group flex w-full items-center rounded-md ${selected ? "bg-accent font-medium" : unread ? "font-semibold text-foreground hover:bg-accent/70" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"}`}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
        onClick={onClick}
        type="button"
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{channel.name}</span>
        {muted ? (
          <BellOff aria-label="Muted" className="h-3.5 w-3.5 shrink-0" />
        ) : null}
        {unread ? (
          <span className="min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[0.65rem] text-primary-foreground">
            {Math.min(unread, 99)}
          </span>
        ) : null}
      </button>
      {onReadChange ? (
        <button
          aria-label={`${unread ? "Mark read" : "Mark unread"} #${channel.name}`}
          className="rounded p-1 opacity-0 hover:bg-background/70 group-hover:opacity-100 focus:opacity-100"
          onClick={onReadChange}
          title={unread ? "Mark read" : "Mark unread"}
          type="button"
        >
          {unread ? (
            <MailOpen className="h-3.5 w-3.5" />
          ) : (
            <Mail className="h-3.5 w-3.5" />
          )}
        </button>
      ) : null}
      {onStarredChange ? (
        <button
          aria-label={`${starred ? "Unstar" : "Star"} #${channel.name}`}
          className={`mr-1 rounded p-1 hover:bg-background/70 ${starred ? "text-amber-500" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
          onClick={onStarredChange}
          title={starred ? "Unstar channel" : "Star channel"}
          type="button"
        >
          <Star className={`h-3.5 w-3.5 ${starred ? "fill-current" : ""}`} />
        </button>
      ) : null}
    </div>
  );
}
