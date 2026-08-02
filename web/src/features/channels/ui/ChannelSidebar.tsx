import {
  Archive,
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  BellOff,
  Clock3,
  FolderPlus,
  Hash,
  LayoutList,
  Mail,
  MailOpen,
  MessageCircle,
  Plus,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/ui/button";
import type { Channel } from "../channel-api";
import type { ChannelSortGroup, ChannelSortMode } from "../use-channel-sort";
import type { ChannelSection } from "../use-channel-sections";
import { ChannelSectionDialog } from "./ChannelSectionDialog";

export function ChannelSidebar({
  channels,
  selectedId,
  unread,
  mutedChannelIds,
  starredChannelIds,
  lastActivity,
  sortModeFor,
  onSelect,
  onCreate,
  onNewDm,
  onBrowse,
  onStarredChange,
  onMarkRead,
  onMarkUnread,
  onSortModeChange,
  sections,
  assignments,
  onCreateSection,
  onRenameSection,
  onDeleteSection,
  onAssignChannel,
  onMoveSection,
}: {
  channels: Channel[];
  selectedId: string | null;
  unread: Record<string, number>;
  mutedChannelIds: ReadonlySet<string>;
  starredChannelIds: ReadonlySet<string>;
  lastActivity: Record<string, number>;
  sortModeFor: (group: ChannelSortGroup) => ChannelSortMode;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onNewDm: () => void;
  onBrowse: () => void;
  onStarredChange: (id: string, starred: boolean) => void;
  onMarkRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onSortModeChange: (group: ChannelSortGroup, mode: ChannelSortMode) => void;
  sections: ChannelSection[];
  assignments: Record<string, string>;
  onCreateSection: (name: string, icon?: string) => ChannelSection;
  onRenameSection: (id: string, name: string, icon?: string) => void;
  onDeleteSection: (id: string) => void;
  onAssignChannel: (channelId: string, sectionId: string | null) => void;
  onMoveSection: (id: string, direction: -1 | 1) => void;
}) {
  const [sectionDialog, setSectionDialog] = useState<{
    open: boolean;
    section: ChannelSection | null;
  }>({ open: false, section: null });
  const streams = channels.filter(
    (channel) => channel.channelType === "stream",
  );
  const starred = streams.filter((channel) =>
    starredChannelIds.has(channel.id),
  );
  const shared = streams.filter(
    (channel) => !starredChannelIds.has(channel.id) && !assignments[channel.id],
  );
  const forums = channels.filter((channel) => channel.channelType === "forum");
  const dms = channels.filter((channel) => channel.channelType === "dm");
  const sorted = (items: Channel[], group: ChannelSortGroup) =>
    sortChannels(items, sortModeFor(group), lastActivity);
  const starredChannels = sorted(starred, "starred");
  const sharedChannels = sorted(shared, "channels");
  const forumChannels = sorted(forums, "forums");
  const directMessages = sorted(dms, "dms");
  const sectionChannels = (sectionId: string) =>
    sorted(
      streams.filter(
        (channel) =>
          !starredChannelIds.has(channel.id) &&
          assignments[channel.id] === sectionId,
      ),
      `section:${sectionId}`,
    );
  return (
    <>
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
          <Button
            aria-label="Create section"
            onClick={() => setSectionDialog({ open: true, section: null })}
            size="icon"
            variant="ghost"
          >
            <FolderPlus />
          </Button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
          {starredChannels.length ? (
            <>
              <SectionHeader
                group="starred"
                label="Starred"
                onSortModeChange={onSortModeChange}
                sortMode={sortModeFor("starred")}
              />
              {starredChannels.map((channel) => (
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
                  sections={sections}
                  assignedSectionId={assignments[channel.id]}
                  onAssignSection={(sectionId) =>
                    onAssignChannel(channel.id, sectionId)
                  }
                  selected={selectedId === channel.id}
                  starred
                  unread={unread[channel.id] ?? 0}
                />
              ))}
              <div className="mt-5" />
            </>
          ) : null}
          {sections.map((section, index) => {
            const sectionItems = sectionChannels(section.id);
            return (
              <div className="mb-5" key={section.id}>
                <SectionHeader
                  group={`section:${section.id}`}
                  label={`${section.icon ? `${section.icon} ` : ""}${section.name}`}
                  onDelete={() => {
                    if (window.confirm(`Delete section "${section.name}"?`))
                      onDeleteSection(section.id);
                  }}
                  onMoveDown={
                    index < sections.length - 1
                      ? () => onMoveSection(section.id, 1)
                      : undefined
                  }
                  onMoveUp={
                    index > 0 ? () => onMoveSection(section.id, -1) : undefined
                  }
                  onRename={() => setSectionDialog({ open: true, section })}
                  onSortModeChange={onSortModeChange}
                  sortMode={sortModeFor(`section:${section.id}`)}
                />
                {sectionItems.map((channel) => (
                  <ChannelButton
                    assignedSectionId={section.id}
                    channel={channel}
                    key={channel.id}
                    muted={mutedChannelIds.has(channel.id)}
                    onAssignSection={(sectionId) =>
                      onAssignChannel(channel.id, sectionId)
                    }
                    onClick={() => onSelect(channel.id)}
                    onReadChange={() =>
                      (unread[channel.id] ?? 0)
                        ? onMarkRead(channel.id)
                        : onMarkUnread(channel.id)
                    }
                    onStarredChange={() => onStarredChange(channel.id, true)}
                    sections={sections}
                    selected={selectedId === channel.id}
                    unread={unread[channel.id] ?? 0}
                  />
                ))}
              </div>
            );
          })}
          <SectionHeader
            group="channels"
            label="Channels"
            onAdd={onCreate}
            onBrowse={onBrowse}
            onSortModeChange={onSortModeChange}
            sortMode={sortModeFor("channels")}
          />
          {sharedChannels.map((channel) => (
            <ChannelButton
              channel={channel}
              key={channel.id}
              selected={selectedId === channel.id}
              muted={mutedChannelIds.has(channel.id)}
              onStarredChange={() => onStarredChange(channel.id, true)}
              sections={sections}
              assignedSectionId={assignments[channel.id]}
              onAssignSection={(sectionId) =>
                onAssignChannel(channel.id, sectionId)
              }
              unread={unread[channel.id] ?? 0}
              onClick={() => onSelect(channel.id)}
              onReadChange={() =>
                (unread[channel.id] ?? 0)
                  ? onMarkRead(channel.id)
                  : onMarkUnread(channel.id)
              }
            />
          ))}
          {forumChannels.length ? (
            <div className="mt-5">
              <SectionHeader
                group="forums"
                label="Forums"
                onAdd={onCreate}
                onSortModeChange={onSortModeChange}
                sortMode={sortModeFor("forums")}
              />
            </div>
          ) : null}
          {forumChannels.map((channel) => (
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
            <SectionHeader
              group="dms"
              label="Direct messages"
              onAdd={onNewDm}
              onSortModeChange={onSortModeChange}
              sortMode={sortModeFor("dms")}
            />
          </div>
          {directMessages.map((channel) => (
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
      <ChannelSectionDialog
        onClose={() => setSectionDialog({ open: false, section: null })}
        onSave={(name, icon) => {
          if (sectionDialog.section)
            onRenameSection(sectionDialog.section.id, name, icon);
          else onCreateSection(name, icon);
          setSectionDialog({ open: false, section: null });
        }}
        open={sectionDialog.open}
        section={sectionDialog.section}
      />
    </>
  );
}

function SectionHeader({
  label,
  onAdd,
  onBrowse,
  group,
  sortMode,
  onSortModeChange,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  label: string;
  onAdd?: () => void;
  onBrowse?: () => void;
  group: ChannelSortGroup;
  sortMode: ChannelSortMode;
  onSortModeChange: (group: ChannelSortGroup, mode: ChannelSortMode) => void;
  onRename?: () => void;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  return (
    <div className="mb-1 flex items-center justify-between px-2 text-xs font-semibold uppercase text-muted-foreground">
      <span>{label}</span>
      <span className="flex items-center gap-0.5">
        {onMoveUp ? (
          <button
            aria-label={`Move ${label} up`}
            className="rounded p-1 hover:bg-accent"
            onClick={onMoveUp}
            type="button"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {onMoveDown ? (
          <button
            aria-label={`Move ${label} down`}
            className="rounded p-1 hover:bg-accent"
            onClick={onMoveDown}
            type="button"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {onRename ? (
          <button
            aria-label={`Rename ${label}`}
            className="rounded p-1 hover:bg-accent"
            onClick={onRename}
            type="button"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {onDelete ? (
          <button
            aria-label={`Delete ${label}`}
            className="rounded p-1 hover:bg-accent"
            onClick={onDelete}
            type="button"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          aria-label={`Sort ${label} ${sortMode === "alpha" ? "by recent activity" : "alphabetically"}`}
          className="rounded p-1 hover:bg-accent"
          onClick={() =>
            onSortModeChange(group, sortMode === "alpha" ? "recent" : "alpha")
          }
          title={
            sortMode === "alpha"
              ? "Sort by recent activity"
              : "Sort alphabetically"
          }
          type="button"
        >
          {sortMode === "alpha" ? (
            <Clock3 className="h-3.5 w-3.5" />
          ) : (
            <ArrowDownAZ className="h-3.5 w-3.5" />
          )}
        </button>
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

function sortChannels(
  channels: Channel[],
  mode: ChannelSortMode,
  lastActivity: Record<string, number>,
) {
  return [...channels].sort((left, right) => {
    if (mode === "recent") {
      const activityDelta =
        (lastActivity[right.id] ?? 0) - (lastActivity[left.id] ?? 0);
      if (activityDelta) return activityDelta;
    }
    return (
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    );
  });
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
  sections,
  assignedSectionId,
  onAssignSection,
}: {
  channel: Channel;
  selected: boolean;
  unread: number;
  muted: boolean;
  starred?: boolean;
  onClick: () => void;
  onStarredChange?: () => void;
  onReadChange?: () => void;
  sections?: ChannelSection[];
  assignedSectionId?: string;
  onAssignSection?: (sectionId: string | null) => void;
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
      {sections?.length && onAssignSection ? (
        <select
          aria-label={`Move #${channel.name} to section`}
          className="h-6 w-6 cursor-pointer bg-transparent text-xs opacity-0 group-hover:opacity-100 focus:opacity-100"
          onChange={(event) => onAssignSection(event.target.value || null)}
          title="Move to section"
          value={assignedSectionId ?? ""}
        >
          <option value="">Channels</option>
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </select>
      ) : null}
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
