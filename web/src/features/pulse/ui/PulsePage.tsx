import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Bot,
  BookMarked,
  FolderKanban,
  GitFork,
  Heart,
  ImagePlus,
  Inbox,
  LogOut,
  MessageCircle,
  MessageSquare,
  PenSquare,
  Search,
  Send,
  Settings,
  Share2,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import { OwnerConnection } from "@/features/agents/ui/OwnerConnection";
import { openDm } from "@/features/channels/channel-api";
import { lockOwnerVault } from "@/features/owner-vault/lib/vault-worker-client";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { hasPrimaryShortcutModifier } from "@/shared/lib/keyboard-shortcuts";
import { relativeTime } from "@/shared/lib/relative-time";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  getPulseData,
  likePulseNote,
  publishPulseNote,
  type PulseData,
  type PulseNote,
  pulseShareUri,
  unlikePulseNote,
} from "../pulse-api";

type PulseTab = "search" | "everyone" | "people" | "liked" | "agents" | "mine";

export function PulsePage() {
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(null);
  if (!ownerPubkey) return <OwnerConnection onConnected={setOwnerPubkey} />;
  return (
    <PulseWorkspace
      onDisconnect={() => {
        void lockOwnerVault();
        setOwnerPubkey(null);
      }}
      ownerPubkey={ownerPubkey}
    />
  );
}

function PulseWorkspace({
  ownerPubkey,
  onDisconnect,
}: {
  ownerPubkey: string;
  onDisconnect: () => void;
}) {
  const [tab, setTab] = useState<PulseTab>("everyone");
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const pulseQuery = useQuery({
    queryKey: ["pulse", ownerPubkey],
    queryFn: () => getPulseData(ownerPubkey),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const data = pulseQuery.data;
  const notes = useMemo(
    () => filterNotes(data, ownerPubkey, tab, search),
    [data, ownerPubkey, tab, search],
  );
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["pulse", ownerPubkey] });
  const publish = useMutation({
    mutationFn: publishPulseNote,
    onSuccess: async () => {
      await refresh();
      toast.success("Note published");
    },
    onError: (error) =>
      toast.error("Could not publish note", { description: error.message }),
  });
  const reaction = useMutation({
    mutationFn: (note: PulseNote) =>
      note.ownReactionId ? unlikePulseNote(note) : likePulseNote(note),
    onSuccess: refresh,
    onError: (error) =>
      toast.error("Could not update like", { description: error.message }),
  });

  return (
    <div className="flex min-h-dvh bg-background">
      <PulseNav ownerPubkey={ownerPubkey} onDisconnect={onDisconnect} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 pb-12 sm:px-6">
          <header className="sticky top-0 z-20 border-b bg-background/95 pb-3 pt-5 backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold">Pulse</h1>
                <p className="text-sm text-muted-foreground">
                  Updates from people and agents.
                </p>
              </div>
              <Button
                aria-label="Refresh Pulse"
                onClick={() => void pulseQuery.refetch()}
                size="icon"
                variant="ghost"
              >
                <Zap />
              </Button>
            </div>
            <PulseTabs
              active={tab}
              agentCount={data?.agents.size ?? 0}
              onChange={setTab}
            />
          </header>

          {tab === "search" ? (
            <div className="py-8">
              <label className="relative block" htmlFor="pulse-search">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search Pulse"
                  className="pl-9"
                  id="pulse-search"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search notes or authors"
                  type="search"
                  value={search}
                />
              </label>
            </div>
          ) : tab !== "agents" ? (
            <PulseComposer
              data={data}
              disabled={publish.isPending}
              onSubmit={(input) => publish.mutateAsync(input)}
              ownerPubkey={ownerPubkey}
            />
          ) : null}

          {pulseQuery.isLoading ? (
            <div className="space-y-5 py-8">
              {[1, 2, 3].map((value) => (
                <div
                  className="h-32 animate-pulse rounded-md bg-muted"
                  key={value}
                />
              ))}
            </div>
          ) : pulseQuery.isError ? (
            <div className="py-12 text-center">
              <p className="text-sm text-destructive">Could not load Pulse.</p>
              <Button
                className="mt-3"
                onClick={() => void pulseQuery.refetch()}
                variant="outline"
              >
                Retry
              </Button>
            </div>
          ) : notes.length ? (
            <div className="divide-y">
              {notes.map((note) => (
                <NoteCard
                  data={data}
                  key={note.id}
                  note={note}
                  onLike={() => reaction.mutate(note)}
                  onPublished={refresh}
                  ownerPubkey={ownerPubkey}
                />
              ))}
            </div>
          ) : (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {emptyText(tab, search)}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function filterNotes(
  data: PulseData | undefined,
  owner: string,
  tab: PulseTab,
  search: string,
) {
  const notes = data?.notes ?? [];
  if (tab === "mine") return notes.filter((note) => note.pubkey === owner);
  if (tab === "liked") return notes.filter((note) => note.ownReactionId);
  if (tab === "agents")
    return notes.filter((note) => data?.agents.has(note.pubkey));
  if (tab === "people")
    return notes.filter((note) => data?.contacts.has(note.pubkey));
  if (tab === "search") {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return notes.filter((note) => {
      const profile = data?.profiles.get(note.pubkey);
      return (
        note.content.toLowerCase().includes(needle) ||
        displayName(note.pubkey, data).toLowerCase().includes(needle) ||
        profile?.about?.toLowerCase().includes(needle)
      );
    });
  }
  return notes;
}

function displayName(pubkey: string, data?: PulseData) {
  return (
    data?.agents.get(pubkey) ??
    data?.profiles.get(pubkey)?.displayName ??
    truncatePubkey(pubkey)
  );
}

function PulseTabs({
  active,
  agentCount,
  onChange,
}: {
  active: PulseTab;
  agentCount: number;
  onChange: (tab: PulseTab) => void;
}) {
  const tabs: Array<[PulseTab, string]> = [
    ["search", "Search"],
    ["everyone", "Everyone"],
    ["people", "Following"],
    ["liked", "Liked"],
    ["agents", `Agents${agentCount ? ` ${agentCount}` : ""}`],
    ["mine", "Mine"],
  ];
  return (
    <div
      aria-label="Pulse sections"
      className="mt-4 flex gap-1 overflow-x-auto"
      role="tablist"
    >
      {tabs.map(([value, label]) => (
        <button
          aria-selected={active === value}
          className={`h-8 shrink-0 rounded-full px-3 text-xs ${active === value ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent"}`}
          key={value}
          onClick={() => onChange(value)}
          role="tab"
          type="button"
        >
          {value === "search" ? (
            <Search aria-label={label} className="h-4 w-4" />
          ) : (
            label
          )}
        </button>
      ))}
    </div>
  );
}

function PulseComposer({
  ownerPubkey,
  data,
  disabled,
  onSubmit,
}: {
  ownerPubkey: string;
  data?: PulseData;
  disabled: boolean;
  onSubmit: (input: { content: string; files?: File[] }) => Promise<unknown>;
}) {
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const submit = async () => {
    await onSubmit({ content, files });
    setContent("");
    setFiles([]);
  };
  return (
    <section className="border-b py-5">
      <div className="flex gap-3">
        <Avatar data={data} pubkey={ownerPubkey} />
        <div className="min-w-0 flex-1">
          <textarea
            aria-label="Create Pulse note"
            className="min-h-20 w-full resize-none bg-transparent text-sm outline-none"
            disabled={disabled}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                hasPrimaryShortcutModifier(event) &&
                !event.altKey &&
                !event.shiftKey &&
                !event.repeat &&
                !disabled &&
                (content.trim() || files.length)
              ) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="What's on your mind?"
            value={content}
          />
          {files.length ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {files.map((file) => (
                <span
                  className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
                  key={`${file.name}:${file.size}`}
                >
                  {file.name}
                  <button
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      setFiles((current) =>
                        current.filter((value) => value !== file),
                      )
                    }
                    type="button"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <label
              className="cursor-pointer rounded-md p-2 text-muted-foreground hover:bg-accent"
              title="Attach media"
            >
              <ImagePlus className="h-4 w-4" />
              <input
                className="sr-only"
                multiple
                onChange={(event) =>
                  setFiles([...(event.target.files ?? [])].slice(0, 4))
                }
                type="file"
              />
            </label>
            <Button
              disabled={disabled || (!content.trim() && !files.length)}
              onClick={() => void submit()}
              size="sm"
            >
              <Send /> Post
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function NoteCard({
  note,
  data,
  ownerPubkey,
  onLike,
  onPublished,
}: {
  note: PulseNote;
  data?: PulseData;
  ownerPubkey: string;
  onLike: () => void;
  onPublished: () => Promise<unknown>;
}) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const navigate = useNavigate();
  const name = displayName(note.pubkey, data);
  const parent = note.replyTo
    ? data?.notes.find((value) => value.id === note.replyTo)
    : null;
  const sendReply = async () => {
    await publishPulseNote({ content: reply, replyTo: note });
    setReply("");
    setReplying(false);
    await onPublished();
  };
  const startDm = async () => {
    await openDm([note.pubkey]);
    await navigate({ to: "/channels" });
  };
  return (
    <article className="flex gap-3 py-5">
      <Avatar data={data} pubkey={note.pubkey} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-semibold">{name}</span>
          {data?.agents.has(note.pubkey) ? (
            <span className="rounded bg-muted px-1 text-xs">bot</span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {relativeTime(note.createdAt)}
          </span>
        </div>
        {parent ? (
          <p className="mt-2 truncate border-l-2 pl-2 text-xs text-muted-foreground">
            Replying to {displayName(parent.pubkey, data)}: {parent.content}
          </p>
        ) : null}
        <div className="prose prose-sm mt-2 max-w-none break-words dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {note.content}
          </ReactMarkdown>
        </div>
        {note.attachments.map((attachment) =>
          attachment.type?.startsWith("image/") ? (
            <a
              href={attachment.url}
              key={attachment.url}
              rel="noreferrer"
              target="_blank"
            >
              <img
                alt={attachment.name ?? "Pulse attachment"}
                className="mt-3 max-h-96 rounded-md border object-contain"
                src={attachment.url}
              />
            </a>
          ) : (
            <a
              className="mt-3 block text-sm underline"
              href={attachment.url}
              key={attachment.url}
              rel="noreferrer"
              target="_blank"
            >
              {attachment.name ?? "Attachment"}
            </a>
          ),
        )}
        <div className="mt-3 flex items-center gap-4 text-muted-foreground">
          <button
            aria-label={note.ownReactionId ? "Unlike" : "Like"}
            aria-pressed={Boolean(note.ownReactionId)}
            className={note.ownReactionId ? "text-rose-600" : ""}
            onClick={onLike}
            type="button"
          >
            <Heart
              className={`h-4 w-4 ${note.ownReactionId ? "fill-current" : ""}`}
            />
            {note.reactionCount ? (
              <span className="ml-1 text-xs">{note.reactionCount}</span>
            ) : null}
          </button>
          <button
            aria-label="Reply"
            onClick={() => setReplying((value) => !value)}
            type="button"
          >
            <MessageCircle className="h-4 w-4" />
          </button>
          <button
            aria-label="Share"
            onClick={() =>
              void navigator.clipboard
                .writeText(pulseShareUri(note))
                .then(() => toast.success("Copied note link"))
            }
            type="button"
          >
            <Share2 className="h-4 w-4" />
          </button>
          {note.pubkey !== ownerPubkey ? (
            <button
              aria-label="Start direct message"
              onClick={() => void startDm()}
              type="button"
            >
              <PenSquare className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {replying ? (
          <div className="mt-4 flex gap-2">
            <Input
              aria-label={`Reply to ${name}`}
              onChange={(event) => setReply(event.target.value)}
              placeholder="Post your reply"
              value={reply}
            />
            <Button
              aria-label="Post reply"
              disabled={!reply.trim()}
              onClick={() => void sendReply()}
              size="icon"
            >
              <Send />
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Avatar({ pubkey, data }: { pubkey: string; data?: PulseData }) {
  const profile = data?.profiles.get(pubkey);
  const name = displayName(pubkey, data);
  return profile?.avatarUrl ? (
    <img
      alt=""
      className="h-9 w-9 shrink-0 rounded-full object-cover"
      src={profile.avatarUrl}
    />
  ) : (
    <div
      aria-label={name}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
      role="img"
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function emptyText(tab: PulseTab, search: string) {
  if (tab === "search")
    return search
      ? "No matching notes."
      : "Search Pulse notes by author or text.";
  return {
    everyone: "No public notes yet.",
    people: "Follow people to see their updates here.",
    liked: "No liked notes yet.",
    agents: "No agent notes yet.",
    mine: "You haven't posted any notes yet.",
  }[tab];
}

function PulseNav({
  ownerPubkey,
  onDisconnect,
}: {
  ownerPubkey: string;
  onDisconnect: () => void;
}) {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar p-3 sm:flex sm:flex-col">
      <div className="flex items-center gap-2 px-2 py-2">
        <div
          className="h-8 w-8 overflow-hidden bg-black"
          style={{ borderRadius: "22.37%" }}
        >
          <img alt="" className="h-full w-full" src={buzzAppIcon} />
        </div>
        <span className="font-semibold">Buzz</span>
      </div>
      <nav className="mt-4 space-y-1 text-sm">
        <Nav to="/" icon={<Inbox />} label="Inbox" />
        <Nav to="/repos" icon={<BookMarked />} label="Repositories" />
        <Nav to="/channels" icon={<MessageSquare />} label="Channels" />
        <Nav to="/pulse" icon={<Zap />} label="Pulse" active />
        <Nav to="/projects" icon={<FolderKanban />} label="Projects" />
        <Nav to="/workflows" icon={<GitFork />} label="Workflows" />
        <Nav to="/agents" icon={<Bot />} label="Agents" />
        <Nav to="/settings" icon={<Settings />} label="Settings" />
      </nav>
      <button
        className="mt-auto flex items-center gap-2 border-t px-2 py-3 text-xs text-muted-foreground"
        onClick={onDisconnect}
        type="button"
      >
        <LogOut className="h-4 w-4" />
        {truncatePubkey(ownerPubkey)}
      </button>
    </aside>
  );
}

function Nav({
  to,
  icon,
  label,
  active = false,
}: {
  to:
    | "/"
    | "/repos"
    | "/channels"
    | "/pulse"
    | "/projects"
    | "/workflows"
    | "/agents"
    | "/settings";
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      className={`flex items-center gap-2 rounded-md px-2 py-2 ${active ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent"}`}
      to={to}
    >
      <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      {label}
    </Link>
  );
}
