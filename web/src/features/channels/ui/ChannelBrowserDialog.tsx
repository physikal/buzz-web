import {
  ArrowLeft,
  Compass,
  Hash,
  ListFilter,
  Plus,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ChannelTemplate } from "@/features/channel-templates/channel-template-api";
import {
  canonicalChannelName,
  channelNamesMatch,
  filterBrowserChannels,
  sortBrowserChannels,
  type ChannelBrowserSort,
  type ChannelBrowserView,
} from "../channel-browser";
import type { Channel } from "../channel-api";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { DialogFrame } from "./ChannelDialogs";
import {
  CreateChannelForm,
  type CreateChannelInput,
} from "./CreateChannelDialog";

const SORT_OPTIONS: { label: string; value: ChannelBrowserSort }[] = [
  { label: "Alphabetical", value: "alpha" },
  { label: "Recent", value: "recent" },
  { label: "Most members", value: "members" },
];

export function ChannelBrowserDialog({
  channels,
  lastActivity,
  open,
  pendingChannelId,
  createPending,
  templates,
  onClose,
  onCreate,
  onJoin,
  onOpen,
  onRestore,
}: {
  channels: Channel[];
  lastActivity: Record<string, number>;
  open: boolean;
  pendingChannelId: string | null;
  createPending: boolean;
  templates: ChannelTemplate[];
  onClose: () => void;
  onCreate: (input: CreateChannelInput) => Promise<unknown>;
  onJoin: (channelId: string) => Promise<unknown>;
  onOpen: (channelId: string) => void;
  onRestore: (channelId: string) => Promise<unknown>;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ChannelBrowserView>("all");
  const [sort, setSort] = useState<ChannelBrowserSort>("alpha");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [mode, setMode] = useState<"browse" | "create">("browse");
  const [createInitialName, setCreateInitialName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmedQuery = canonicalChannelName(query);
  const lowerQuery = trimmedQuery.toLowerCase();
  const filtered = useMemo(
    () => filterBrowserChannels(channels, view, lowerQuery),
    [channels, lowerQuery, view],
  );
  const browserActivity = useMemo(
    () =>
      Object.fromEntries(
        channels.map((channel) => [
          channel.id,
          Math.max(lastActivity[channel.id] ?? 0, channel.lastMessageAt ?? 0),
        ]),
      ),
    [channels, lastActivity],
  );
  const visible = useMemo(
    () =>
      sortBrowserChannels(
        filtered.channels,
        sort,
        browserActivity,
        lowerQuery ? filtered.scores : undefined,
      ),
    [browserActivity, filtered, lowerQuery, sort],
  );
  const hasExactMatch = channels.some(
    (channel) =>
      channel.channelType === "stream" &&
      channelNamesMatch(channel.name, lowerQuery),
  );
  const showCreateRow = !hasExactMatch;
  const channelOffset = showCreateRow ? 1 : 0;
  const itemCount = visible.length + channelOffset;
  const createSelected = showCreateRow && selectedIndex === 0;

  useEffect(() => {
    if (open) return;
    setQuery("");
    setView("all");
    setSort("alpha");
    setSelectedIndex(null);
    setMode("browse");
    setCreateInitialName("");
  }, [open]);

  useEffect(() => {
    setSelectedIndex((current) =>
      current === null || itemCount === 0
        ? null
        : Math.min(current, itemCount - 1),
    );
  }, [itemCount]);

  function enterCreate() {
    setCreateInitialName(trimmedQuery);
    setMode("create");
  }

  function leaveCreate() {
    setMode("browse");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function activate(channel: Channel) {
    try {
      if (channel.archived) {
        await onRestore(channel.id);
        return;
      }
      if (!channel.isMember) {
        await onJoin(channel.id);
      }
      onOpen(channel.id);
    } catch {
      // Mutation handlers surface the relay error and leave the dialog open.
    }
  }

  function handleSearchKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && itemCount) {
      event.preventDefault();
      setSelectedIndex((current) =>
        current === null ? 0 : Math.min(current + 1, itemCount - 1),
      );
      return;
    }
    if (event.key === "ArrowUp" && itemCount) {
      event.preventDefault();
      setSelectedIndex((current) =>
        current === null ? itemCount - 1 : Math.max(current - 1, 0),
      );
      return;
    }
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (showCreateRow && (createSelected || visible.length === 0)) {
      event.preventDefault();
      enterCreate();
      return;
    }
    const selectedChannel =
      selectedIndex === null
        ? visible[0]
        : visible[selectedIndex - channelOffset];
    if (!selectedChannel) return;
    event.preventDefault();
    void activate(selectedChannel);
  }

  return (
    <DialogFrame
      closeBlocked={createPending || pendingChannelId !== null}
      icon={
        mode === "create" ? (
          <button
            aria-label="Back to search"
            data-testid="channel-browser-create-back"
            disabled={createPending}
            onClick={leaveCreate}
            type="button"
          >
            <ArrowLeft />
          </button>
        ) : (
          <Hash />
        )
      }
      onClose={onClose}
      open={open}
      testId="channel-browser-dialog"
      title={mode === "create" ? "New channel" : "Browse channels"}
    >
      {mode === "create" ? (
        <CreateChannelForm
          initialName={createInitialName}
          onCancel={leaveCreate}
          onSubmit={onCreate}
          pending={createPending}
          templates={templates}
        />
      ) : (
        <div className="mt-4 flex h-[min(65dvh,34rem)] flex-col">
          <div className="flex gap-2">
            <label
              className="relative min-w-0 flex-1"
              htmlFor="channel-browser-search"
            >
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                autoCapitalize="none"
                autoCorrect="off"
                autoFocus
                className="pl-9"
                data-testid="channel-browser-search"
                id="channel-browser-search"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedIndex(null);
                }}
                onKeyDown={handleSearchKey}
                placeholder="Search or create a channel"
                ref={inputRef}
                spellCheck={false}
                value={query}
              />
            </label>
            <div className="relative h-10 w-10 shrink-0">
              <Button
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                size="icon"
                tabIndex={-1}
                type="button"
                variant="outline"
              >
                <ListFilter />
              </Button>
              <select
                aria-label={`Sort channels: ${SORT_OPTIONS.find((item) => item.value === sort)?.label}`}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                data-testid="channel-browser-sort"
                onChange={(event) => {
                  setSort(event.target.value as ChannelBrowserSort);
                  setSelectedIndex(null);
                }}
                value={sort}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex shrink-0 border-b" role="tablist">
            {(
              [
                ["all", "All channels"],
                ["joined", "Joined"],
                ["archived", "Archived"],
              ] as const
            ).map(([value, label]) => (
              <button
                aria-selected={view === value}
                className={`border-b-2 px-3 py-2 text-sm font-medium ${view === value ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                key={value}
                onClick={() => {
                  setView(value);
                  setSelectedIndex(null);
                }}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-3">
            {showCreateRow ? (
              <button
                className={`mb-3 flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left ${createSelected ? "bg-muted" : "hover:bg-muted/60"}`}
                data-selected={createSelected}
                data-testid="channel-browser-create-row"
                onClick={enterCreate}
                type="button"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Plus className="h-4 w-4" />
                </span>
                <span className="min-w-0 truncate text-sm font-medium">
                  {trimmedQuery
                    ? `Create channel “${trimmedQuery}”`
                    : "Create a new channel"}
                </span>
              </button>
            ) : null}

            {visible.length ? (
              <div className="divide-y overflow-hidden rounded-md border">
                {visible.map((channel, index) => (
                  <ChannelBrowserRow
                    channel={channel}
                    key={channel.id}
                    onActivate={() => void activate(channel)}
                    pending={pendingChannelId === channel.id}
                    selected={selectedIndex === index + channelOffset}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center px-4 py-12 text-center">
                {lowerQuery ? (
                  <Search className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <Compass className="h-5 w-5 text-muted-foreground" />
                )}
                <p className="mt-3 text-sm font-semibold">
                  {lowerQuery
                    ? "No channels match your search"
                    : view === "joined"
                      ? "No joined channels"
                      : view === "archived"
                        ? "No archived channels"
                        : "No channels to browse"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {lowerQuery
                    ? "Try another keyword or create this channel."
                    : "Channels will appear here when they are available."}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </DialogFrame>
  );
}

function ChannelBrowserRow({
  channel,
  pending,
  selected,
  onActivate,
}: {
  channel: Channel;
  pending: boolean;
  selected: boolean;
  onActivate: () => void;
}) {
  const memberLabel = `${channel.memberCount} ${channel.memberCount === 1 ? "member" : "members"}`;
  const action = channel.archived
    ? pending
      ? "Restoring…"
      : "Restore"
    : channel.isMember
      ? "Open"
      : pending
        ? "Joining…"
        : "Join";
  return (
    <div
      className={`flex min-h-16 items-center gap-3 px-3 py-3 ${selected ? "bg-muted" : "hover:bg-muted/50"}`}
      data-testid={`browse-channel-${channel.name}`}
    >
      <button
        className="min-w-0 flex-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
        disabled={pending}
        onClick={onActivate}
        type="button"
      >
        <span className="block truncate text-sm font-medium">
          #{channel.name}
          {channel.archived ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              archived
            </span>
          ) : null}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {memberLabel}
          {channel.description ? ` · ${channel.description}` : ""}
        </span>
      </button>
      <Button
        disabled={pending}
        onClick={onActivate}
        size="sm"
        variant={channel.isMember ? "ghost" : "default"}
      >
        {action}
      </Button>
    </div>
  );
}
