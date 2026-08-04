import { Bot, Check, MessageCircle, Search, Settings, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { parsePubkey, truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { DestructiveConfirmDialog } from "@/shared/ui/destructive-confirm-dialog";
import { Input } from "@/shared/ui/input";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import type { Channel } from "../channel-api";
import type { DmCandidate } from "../dm-candidates";
import { ChannelCanvas } from "./ChannelCanvas";
import { ChannelMembersSection } from "./ChannelMembersSection";

export function DialogFrame({
  open,
  title,
  icon,
  onClose,
  children,
  closeBlocked = false,
  testId,
}: {
  open: boolean;
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  closeBlocked?: boolean;
  testId?: string;
}) {
  useEscapeSurface(open, onClose, closeBlocked);
  if (!open) return null;
  return (
    <div
      aria-label={title}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      data-testid={testId}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !closeBlocked) onClose();
      }}
    >
      <div className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-lg bg-background p-5 shadow-2xl">
        <header className="flex items-center gap-3">
          <span className="text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">
            {icon}
          </span>
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">
            {title}
          </h2>
          <Button
            aria-label="Close"
            disabled={closeBlocked}
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function NewDmDialog({
  candidates,
  open,
  ownerPubkey,
  pending,
  onClose,
  onSubmit,
}: {
  candidates: DmCandidate[];
  open: boolean;
  ownerPubkey: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (pubkeys: string[]) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [selected, setSelected] = useState<DmCandidate[]>([]);
  const entries = value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const parsedEntries = entries.map(parsePubkey);
  const pastedPubkeys = [
    ...new Set(
      parsedEntries.filter(
        (pubkey): pubkey is string =>
          Boolean(pubkey) &&
          pubkey !== ownerPubkey &&
          !selected.some((item) => item.pubkey === pubkey),
      ),
    ),
  ];
  const query = value.trim().toLowerCase();
  const visibleCandidates = candidates
    .filter(
      (candidate) =>
        candidate.pubkey !== ownerPubkey &&
        !selected.some((item) => item.pubkey === candidate.pubkey) &&
        (!query ||
          candidate.displayName.toLowerCase().includes(query) ||
          candidate.pubkey.includes(query)),
    )
    .slice(0, 30);
  const addPasted = () => {
    const byPubkey = new Map(candidates.map((item) => [item.pubkey, item]));
    setSelected((current) => [
      ...current,
      ...pastedPubkeys
        .filter((_, index) => index < 8 - current.length)
        .map(
          (pubkey) =>
            byPubkey.get(pubkey) ?? {
              pubkey,
              displayName: truncatePubkey(pubkey),
              avatarUrl: null,
              isAgent: false,
            },
        ),
    ]);
    setValue("");
  };
  useEffect(() => {
    if (open) return;
    setValue("");
    setSelected([]);
  }, [open]);
  return (
    <DialogFrame
      open={open}
      title="New message"
      icon={<MessageCircle />}
      onClose={onClose}
    >
      <form
        className="mt-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!selected.length) return;
          await onSubmit(selected.map((item) => item.pubkey));
          setValue("");
          setSelected([]);
        }}
      >
        <label className="text-sm font-medium" htmlFor="dm-participants">
          To
        </label>
        {selected.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {selected.map((candidate) => (
              <span
                className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs"
                key={candidate.pubkey}
              >
                <span className="truncate">{candidate.displayName}</span>
                <button
                  aria-label={`Remove ${candidate.displayName}`}
                  disabled={pending}
                  onClick={() =>
                    setSelected((current) =>
                      current.filter(
                        (item) => item.pubkey !== candidate.pubkey,
                      ),
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
        <Input
          aria-label="Find people and agents"
          className="mt-2"
          disabled={pending}
          id="dm-participants"
          placeholder="Search by name or paste an npub"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="mt-3 max-h-64 overflow-y-auto rounded-md border">
          {pastedPubkeys.length > 0 && parsedEntries.every(Boolean) ? (
            <button
              className="flex w-full items-center gap-3 border-b px-3 py-3 text-left hover:bg-muted/50"
              disabled={pending || selected.length >= 8}
              onClick={addPasted}
              type="button"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted font-mono text-xs">
                +
              </span>
              <span className="min-w-0 flex-1 text-sm">
                Add{" "}
                {pastedPubkeys.length === 1
                  ? "public key"
                  : `${pastedPubkeys.length} public keys`}
              </span>
              <Check className="h-4 w-4 text-muted-foreground" />
            </button>
          ) : null}
          {visibleCandidates.map((candidate) => (
            <button
              aria-label={`Add ${candidate.displayName}`}
              className="flex w-full items-center gap-3 border-b px-3 py-3 text-left last:border-b-0 hover:bg-muted/50"
              disabled={pending || selected.length >= 8}
              key={candidate.pubkey}
              onClick={() => {
                setSelected((current) => [...current, candidate]);
                setValue("");
              }}
              type="button"
            >
              {candidate.avatarUrl ? (
                <img
                  alt=""
                  className="h-8 w-8 rounded-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  src={candidate.avatarUrl}
                />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase">
                  {candidate.displayName.slice(0, 2)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {candidate.displayName}
                </span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {truncatePubkey(candidate.pubkey)}
                </span>
              </span>
              {candidate.isAgent ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Bot className="h-3.5 w-3.5" /> agent
                </span>
              ) : null}
            </button>
          ))}
          {!visibleCandidates.length && !pastedPubkeys.length ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {query ? "No matching people or agents" : "No contacts available"}
            </p>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Add up to eight people or agents. You can paste multiple public keys,
          separated by spaces.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button disabled={pending || !selected.length} type="submit">
            {pending ? "Opening…" : "Open conversation"}
          </Button>
        </div>
      </form>
    </DialogFrame>
  );
}

export type SearchResult = {
  id: string;
  channelId: string;
  channelName: string;
  author: string;
  authorName: string;
  content: string;
  createdAt: number;
  rootId: string | null;
};

export function SearchDialog({
  open,
  pending,
  results,
  onClose,
  onSearch,
  onSelect,
}: {
  open: boolean;
  pending: boolean;
  results: SearchResult[];
  onClose: () => void;
  onSearch: (query: string) => void;
  onSelect: (result: SearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    const timer = window.setTimeout(() => onSearch(query), 250);
    return () => window.clearTimeout(timer);
  }, [onSearch, open, query]);
  return (
    <DialogFrame
      open={open}
      title="Search messages"
      icon={<Search />}
      onClose={onClose}
    >
      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim()) onSearch(query);
        }}
      >
        <Input
          aria-label="Search query"
          autoFocus
          placeholder="Search Buzz"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button disabled={pending || !query.trim()} type="submit">
          Search
        </Button>
      </form>
      <div className="mt-4 space-y-1">
        {results.map((result) => (
          <button
            className="block w-full rounded-md px-3 py-3 text-left hover:bg-muted"
            key={result.id}
            onClick={() => onSelect(result)}
            type="button"
          >
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <strong className="text-foreground">#{result.channelName}</strong>
              {result.authorName}
              <time dateTime={new Date(result.createdAt * 1_000).toISOString()}>
                {new Intl.DateTimeFormat(undefined, {
                  month: "short",
                  day: "numeric",
                }).format(new Date(result.createdAt * 1_000))}
              </time>
            </span>
            <span className="mt-1 line-clamp-2 block text-sm">
              {result.content}
            </span>
          </button>
        ))}
        {!pending && query && !results.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No matching messages.
          </p>
        ) : null}
      </div>
    </DialogFrame>
  );
}

export function ChannelSettingsDialog({
  open,
  channel,
  pending,
  ownerPubkey,
  onClose,
  onSave,
  onLeave,
  onArchive,
  onDelete,
  isMuted,
  onMutedChange,
}: {
  open: boolean;
  channel: Channel | null;
  pending: boolean;
  ownerPubkey: string;
  onClose: () => void;
  onSave: (input: {
    name: string;
    description: string;
    topic: string;
  }) => Promise<void>;
  onLeave: () => Promise<void>;
  onArchive: () => void;
  onDelete: () => Promise<void>;
  isMuted: boolean;
  onMutedChange: (muted: boolean) => void;
}) {
  if (!channel) return null;
  return (
    <ChannelSettingsForm
      key={channel.id}
      {...{
        open,
        channel,
        pending,
        ownerPubkey,
        onClose,
        onSave,
        onLeave,
        onArchive,
        onDelete,
        isMuted,
        onMutedChange,
      }}
    />
  );
}

function ChannelSettingsForm({
  open,
  channel,
  pending,
  ownerPubkey,
  onClose,
  onSave,
  onLeave,
  onArchive,
  onDelete,
  isMuted,
  onMutedChange,
}: {
  open: boolean;
  channel: Channel;
  pending: boolean;
  ownerPubkey: string;
  onClose: () => void;
  onSave: (input: {
    name: string;
    description: string;
    topic: string;
  }) => Promise<void>;
  onLeave: () => Promise<void>;
  onArchive: () => void;
  onDelete: () => Promise<void>;
  isMuted: boolean;
  onMutedChange: (muted: boolean) => void;
}) {
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description);
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [confirmAction, setConfirmAction] = useState<"leave" | "delete" | null>(
    null,
  );
  return (
    <DialogFrame
      open={open}
      title="Channel settings"
      icon={<Settings />}
      onClose={onClose}
    >
      <form
        className="mt-5 space-y-4"
        onSubmit={async (event: FormEvent) => {
          event.preventDefault();
          await onSave({ name, description, topic });
        }}
      >
        <label className="block text-sm font-medium" htmlFor="settings-name">
          Name
          <Input
            className="mt-2"
            disabled={channel.channelType === "dm"}
            id="settings-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium" htmlFor="settings-topic">
          Topic
          <Input
            className="mt-2"
            id="settings-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          Description
          <textarea
            className="mt-2 min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="flex justify-end">
          <Button disabled={pending || !name.trim()} type="submit">
            Save changes
          </Button>
        </div>
      </form>
      <label className="mt-6 flex items-center justify-between gap-4 border-t pt-5">
        <span>
          <span className="block text-sm font-semibold">Mute channel</span>
          <span className="block text-sm text-muted-foreground">
            Suppress ordinary browser alerts. Direct mentions still notify you.
          </span>
        </span>
        <input
          aria-label="Mute channel"
          checked={isMuted}
          type="checkbox"
          onChange={(event) => onMutedChange(event.target.checked)}
        />
      </label>
      {channel.channelType !== "dm" ? (
        <section className="mt-6 border-t pt-5">
          <h3 className="mb-3 text-sm font-semibold">Canvas</h3>
          <ChannelCanvas channelId={channel.id} />
        </section>
      ) : null}
      <ChannelMembersSection channel={channel} ownerPubkey={ownerPubkey} />
      <div className="mt-6 flex flex-wrap gap-2 border-t pt-4">
        <Button onClick={() => setConfirmAction("leave")} variant="outline">
          Leave
        </Button>
        {channel.channelType !== "dm" ? (
          <Button onClick={onArchive} variant="outline">
            Archive
          </Button>
        ) : null}
        {channel.channelType !== "dm" ? (
          <Button
            onClick={() => setConfirmAction("delete")}
            variant="destructive"
          >
            Delete
          </Button>
        ) : null}
      </div>
      <DestructiveConfirmDialog
        confirmLabel={confirmAction === "leave" ? "Leave" : "Delete channel"}
        description={
          confirmAction === "leave"
            ? `Leave "${channel.name}"? You'll stop receiving its messages and can rejoin later.`
            : `Delete ${channel.name} from the community list. This action cannot be undone.`
        }
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          const action = confirmAction === "leave" ? onLeave : onDelete;
          void action()
            .then(() => setConfirmAction(null))
            .catch(() => {});
        }}
        open={confirmAction !== null}
        pending={pending}
        pendingLabel={confirmAction === "leave" ? "Leaving..." : "Deleting..."}
        title={confirmAction === "leave" ? "Leave channel" : "Delete channel?"}
      />
    </DialogFrame>
  );
}
