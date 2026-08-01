import { MessageCircle, Search, Settings, X } from "lucide-react";
import { type FormEvent, useState } from "react";

import { parsePubkey, truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { Channel } from "../channel-api";
import { ChannelMembersSection } from "./ChannelMembersSection";

function DialogFrame({
  open,
  title,
  icon,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      aria-label={title}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
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
  open,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (pubkeys: string[]) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const entries = value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const pubkeys = entries
    .map(parsePubkey)
    .filter((pubkey): pubkey is string => Boolean(pubkey));
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
          await onSubmit(pubkeys);
          setValue("");
        }}
      >
        <label className="text-sm font-medium" htmlFor="dm-participants">
          Participant public keys
        </label>
        <textarea
          className="mt-2 min-h-28 w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
          disabled={pending}
          id="dm-participants"
          placeholder="Paste one or more public keys"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Separate group participants with commas or spaces.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={
              pending || !pubkeys.length || pubkeys.length !== entries.length
            }
            type="submit"
          >
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
  content: string;
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
          placeholder="Search this workspace"
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
              {truncatePubkey(result.author)}
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
  onLeave: () => void;
  onArchive: () => void;
  onDelete: () => void;
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
  onLeave: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description);
  const [topic, setTopic] = useState(channel.topic ?? "");
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
      <ChannelMembersSection channel={channel} ownerPubkey={ownerPubkey} />
      <div className="mt-6 flex flex-wrap gap-2 border-t pt-4">
        <Button onClick={onLeave} variant="outline">
          Leave
        </Button>
        {channel.channelType !== "dm" ? (
          <Button onClick={onArchive} variant="outline">
            Archive
          </Button>
        ) : null}
        {channel.channelType !== "dm" ? (
          <Button onClick={onDelete} variant="destructive">
            Delete
          </Button>
        ) : null}
      </div>
    </DialogFrame>
  );
}
