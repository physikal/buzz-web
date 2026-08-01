import { Hash, LayoutList, MessageCircle, Plus } from "lucide-react";

import { Button } from "@/shared/ui/button";
import type { Channel } from "../channel-api";

export function ChannelSidebar({
  channels,
  selectedId,
  unread,
  onSelect,
  onCreate,
  onNewDm,
}: {
  channels: Channel[];
  selectedId: string | null;
  unread: Record<string, number>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onNewDm: () => void;
}) {
  const shared = channels.filter((channel) => channel.channelType !== "dm");
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
        <SectionHeader label="Channels" onAdd={onCreate} />
        {shared.map((channel) => (
          <ChannelButton
            channel={channel}
            key={channel.id}
            selected={selectedId === channel.id}
            unread={unread[channel.id] ?? 0}
            onClick={() => onSelect(channel.id)}
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
            unread={unread[channel.id] ?? 0}
            onClick={() => onSelect(channel.id)}
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

function SectionHeader({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="mb-1 flex items-center justify-between px-2 text-xs font-semibold uppercase text-muted-foreground">
      <span>{label}</span>
      <button
        aria-label={`Add ${label.toLowerCase()}`}
        className="rounded p-1 hover:bg-accent"
        onClick={onAdd}
        type="button"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ChannelButton({
  channel,
  selected,
  unread,
  onClick,
}: {
  channel: Channel;
  selected: boolean;
  unread: number;
  onClick: () => void;
}) {
  const Icon =
    channel.channelType === "forum"
      ? LayoutList
      : channel.channelType === "dm"
        ? MessageCircle
        : Hash;
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left ${selected ? "bg-accent font-medium" : unread ? "font-semibold text-foreground hover:bg-accent/70" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"}`}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{channel.name}</span>
      {unread ? (
        <span className="min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[0.65rem] text-primary-foreground">
          {Math.min(unread, 99)}
        </span>
      ) : null}
    </button>
  );
}
