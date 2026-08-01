import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  BookMarked,
  Hash,
  LogOut,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import { listAgents } from "@/features/agents/agent-api";
import { OwnerConnection } from "@/features/agents/ui/OwnerConnection";
import { lockOwnerVault } from "@/features/owner-vault/lib/vault-worker-client";
import { relativeTime } from "@/shared/lib/relative-time";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import {
  type Channel,
  createChannel,
  ensureStarterChannels,
  joinChannel,
  listChannelMessages,
  sendChannelMessage,
} from "../channel-api";
import { CreateChannelDialog } from "./CreateChannelDialog";

export function ChannelsPage() {
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(null);
  if (!ownerPubkey) {
    return <OwnerConnection onConnected={setOwnerPubkey} />;
  }
  return (
    <ChannelsWorkspace
      ownerPubkey={ownerPubkey}
      onDisconnect={() => {
        void lockOwnerVault();
        setOwnerPubkey(null);
      }}
    />
  );
}

function ChannelsWorkspace({
  ownerPubkey,
  onDisconnect,
}: {
  ownerPubkey: string;
  onDisconnect: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const timelineEnd = useRef<HTMLDivElement>(null);
  const channelsQuery = useQuery({
    queryKey: ["channels", ownerPubkey],
    queryFn: () => ensureStarterChannels(ownerPubkey),
    staleTime: 5_000,
    retry: false,
  });
  const agentsQuery = useQuery({
    queryKey: ["managed-agents", ownerPubkey],
    queryFn: listAgents,
    staleTime: 10_000,
    retry: false,
  });
  const channels = channelsQuery.data ?? [];
  const selected =
    channels.find((channel) => channel.id === selectedId) ??
    channels[0] ??
    null;
  const messagesQuery = useQuery({
    queryKey: ["channel-messages", selected?.id],
    queryFn: () => listChannelMessages(selected?.id ?? ""),
    enabled: Boolean(selected),
    refetchInterval: 2_500,
    retry: false,
  });
  const lastMessageId = messagesQuery.data?.[messagesQuery.data.length - 1]?.id;

  useEffect(() => {
    if (!selectedId && channels[0]) setSelectedId(channels[0].id);
  }, [channels, selectedId]);
  useEffect(() => {
    if (!lastMessageId) return;
    timelineEnd.current?.scrollIntoView({ block: "end" });
  }, [lastMessageId]);

  const createMutation = useMutation({
    mutationFn: createChannel,
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({
        queryKey: ["channels", ownerPubkey],
      });
      setSelectedId(id);
      setCreateOpen(false);
      toast.success("Channel created");
    },
    onError: (error) =>
      toast.error("Could not create channel", { description: error.message }),
  });
  const joinMutation = useMutation({
    mutationFn: joinChannel,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["channels", ownerPubkey],
      });
      toast.success("Channel joined");
    },
    onError: (error) =>
      toast.error("Could not join channel", { description: error.message }),
  });
  const sendMutation = useMutation({
    mutationFn: sendChannelMessage,
    onSuccess: (message) => {
      queryClient.setQueryData(
        ["channel-messages", selected?.id],
        (current: typeof messagesQuery.data = []) =>
          current.some((item) => item.id === message.id)
            ? current
            : [...current, message],
      );
      setDraft("");
    },
    onError: (error) =>
      toast.error("Could not send message", { description: error.message }),
  });

  const authorNames = useMemo(() => {
    const names = new Map<string, string>([[ownerPubkey, "You"]]);
    for (const agent of agentsQuery.data ?? [])
      names.set(agent.agent_pubkey, agent.name);
    return names;
  }, [agentsQuery.data, ownerPubkey]);

  function submitMessage(event: FormEvent) {
    event.preventDefault();
    if (!selected || !draft.trim() || !selected.isMember) return;
    const lowerDraft = draft.toLowerCase();
    const mentions = (agentsQuery.data ?? [])
      .filter((agent) => lowerDraft.includes(`@${agent.name.toLowerCase()}`))
      .map((agent) => agent.agent_pubkey);
    sendMutation.mutate({
      channelId: selected.id,
      content: draft,
      mentionPubkeys: mentions,
    });
  }

  return (
    <div className="flex h-dvh min-h-0 bg-background">
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar p-3 md:flex md:flex-col">
        <Brand />
        <nav className="mt-4 space-y-1 text-sm">
          <SidebarLink href="/" icon={<BookMarked />} label="Repositories" />
          <SidebarLink
            active
            href="/channels"
            icon={<MessageSquare />}
            label="Channels"
          />
          <SidebarLink href="/agents" icon={<Bot />} label="Agents" />
        </nav>
        <OwnerButton ownerPubkey={ownerPubkey} onDisconnect={onDisconnect} />
      </aside>

      <aside className="hidden w-60 shrink-0 border-r border-border bg-background sm:flex sm:flex-col">
        <div className="flex h-16 items-center justify-between border-b px-4">
          <span className="font-semibold">Channels</span>
          <Button
            aria-label="Create channel"
            onClick={() => setCreateOpen(true)}
            size="icon"
            variant="ghost"
          >
            <Plus />
          </Button>
        </div>
        <ChannelList
          channels={channels}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 items-center gap-3 border-b px-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 font-semibold">
              <Hash className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{selected?.name ?? "Channels"}</span>
            </h1>
            {selected?.description ? (
              <p className="truncate text-xs text-muted-foreground">
                {selected.description}
              </p>
            ) : null}
          </div>
          <select
            aria-label="Channel"
            className="max-w-40 rounded-md border bg-background px-2 py-2 text-sm sm:hidden"
            value={selected?.id ?? ""}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}
              </option>
            ))}
          </select>
          <Button
            aria-label="Refresh messages"
            onClick={() => messagesQuery.refetch()}
            size="icon"
            variant="ghost"
          >
            <RefreshCw />
          </Button>
          <Button
            aria-label="Create channel"
            className="sm:hidden"
            onClick={() => setCreateOpen(true)}
            size="icon"
            variant="ghost"
          >
            <Plus />
          </Button>
        </header>

        <section
          aria-label="Messages"
          className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6"
        >
          {channelsQuery.isLoading ? (
            <CenteredMessage>Creating your starter channels…</CenteredMessage>
          ) : channelsQuery.error ? (
            <CenteredMessage>{channelsQuery.error.message}</CenteredMessage>
          ) : !selected ? (
            <CenteredMessage>No channels are available.</CenteredMessage>
          ) : messagesQuery.isLoading ? (
            <CenteredMessage>Loading messages…</CenteredMessage>
          ) : (messagesQuery.data?.length ?? 0) === 0 ? (
            <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Hash className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">
                Welcome to #{selected.name}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This is the start of the conversation.
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl space-y-5">
              {messagesQuery.data?.map((message) => (
                <article className="flex gap-3" key={message.id}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold">
                    {(
                      authorNames.get(message.pubkey)?.[0] ?? message.pubkey[0]
                    ).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-semibold">
                        {authorNames.get(message.pubkey) ??
                          truncatePubkey(message.pubkey)}
                      </span>
                      <time
                        className="text-xs text-muted-foreground"
                        dateTime={new Date(
                          message.createdAt * 1000,
                        ).toISOString()}
                      >
                        {relativeTime(message.createdAt)}
                      </time>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">
                      {message.content}
                    </p>
                  </div>
                </article>
              ))}
              <div ref={timelineEnd} />
            </div>
          )}
        </section>

        {selected ? (
          selected.isMember ? (
            <form className="border-t p-3 sm:p-4" onSubmit={submitMessage}>
              <div className="mx-auto flex max-w-4xl items-end gap-2 rounded-md border bg-background p-2 shadow-xs focus-within:ring-1 focus-within:ring-ring">
                <textarea
                  aria-label={`Message #${selected.name}`}
                  className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
                  disabled={sendMutation.isPending}
                  placeholder={`Message #${selected.name}`}
                  rows={1}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <Button
                  aria-label="Send message"
                  disabled={!draft.trim() || sendMutation.isPending}
                  size="icon"
                  type="submit"
                >
                  <Send />
                </Button>
              </div>
            </form>
          ) : (
            <div className="border-t p-4 text-center">
              <Button
                disabled={
                  joinMutation.isPending || selected.visibility !== "open"
                }
                onClick={() => joinMutation.mutate(selected.id)}
              >
                {joinMutation.isPending ? "Joining…" : "Join channel"}
              </Button>
            </div>
          )
        ) : null}
      </main>

      <CreateChannelDialog
        open={createOpen}
        pending={createMutation.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (input) => {
          await createMutation.mutateAsync(input);
        }}
      />
    </div>
  );
}

function ChannelList({
  channels,
  selectedId,
  onSelect,
}: {
  channels: Channel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
      {channels.map((channel) => (
        <button
          className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left ${selectedId === channel.id ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"}`}
          key={channel.id}
          onClick={() => onSelect(channel.id)}
          type="button"
        >
          <Hash className="h-4 w-4 shrink-0" />
          <span className="truncate">{channel.name}</span>
        </button>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-2 py-2">
      <div
        className="h-8 w-8 overflow-hidden bg-black"
        style={{ borderRadius: "22.37%" }}
      >
        <img alt="" className="h-full w-full" src={buzzAppIcon} />
      </div>
      <span className="font-semibold">Buzz</span>
    </div>
  );
}

function SidebarLink({
  href,
  icon,
  label,
  active = false,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <a
      className={`flex items-center gap-2 rounded-md px-2 py-2 ${active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent"}`}
      href={href}
    >
      <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      {label}
    </a>
  );
}

function OwnerButton({
  ownerPubkey,
  onDisconnect,
}: {
  ownerPubkey: string;
  onDisconnect: () => void;
}) {
  return (
    <div className="mt-auto border-t border-sidebar-border pt-3">
      <button
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-muted-foreground hover:bg-sidebar-accent"
        onClick={onDisconnect}
        type="button"
      >
        <LogOut className="h-4 w-4" />
        <span className="min-w-0 flex-1 truncate">
          {truncatePubkey(ownerPubkey)}
        </span>
      </button>
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
