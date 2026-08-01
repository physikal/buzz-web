import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Bot,
  BookMarked,
  Circle,
  Hash,
  LayoutList,
  LogOut,
  MessageCircle,
  MessageSquare,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import { listAgents } from "@/features/agents/agent-api";
import { OwnerConnection } from "@/features/agents/ui/OwnerConnection";
import { lockOwnerVault } from "@/features/owner-vault/lib/vault-worker-client";
import { getCustomEmoji } from "@/features/settings/custom-emoji-api";
import { submitModerationReport } from "@/features/settings/moderation-api";
import { subscribeEvents } from "@/shared/lib/nostr-client";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { Button } from "@/shared/ui/button";
import {
  addReaction,
  archiveChannel,
  createChannel,
  deleteChannel,
  deleteMessage,
  editMessage,
  ensureStarterChannels,
  joinChannel,
  leaveChannel,
  listChannelMessages,
  listProfiles,
  openDm,
  removeReaction,
  searchMessages,
  sendPresence,
  sendChannelMessage,
  sendTypingIndicator,
  updateChannel,
  type ChannelMessage,
} from "../channel-api";
import { useLiveChannels } from "../use-live-channels";
import { useTypingIndicators } from "../use-typing";
import { ChannelSidebar } from "./ChannelSidebar";
import {
  ChannelSettingsDialog,
  NewDmDialog,
  SearchDialog,
  type SearchResult,
} from "./ChannelDialogs";
import { CreateChannelDialog } from "./CreateChannelDialog";
import { MessageComposer, type ComposerPayload } from "./MessageComposer";
import {
  type MessageActions,
  MessageTimeline,
  ThreadPanel,
} from "./MessageTimeline";
import { ReportMessageDialog } from "./ReportMessageDialog";

export function ChannelsPage() {
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(null);
  if (!ownerPubkey) return <OwnerConnection onConnected={setOwnerPubkey} />;
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
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<ChannelMessage | null>(null);

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
  const customEmojiQuery = useQuery({
    queryKey: ["custom-emoji", ownerPubkey],
    queryFn: () => getCustomEmoji(ownerPubkey),
    staleTime: 30_000,
    retry: false,
  });
  const channels = channelsQuery.data ?? [];
  const selected =
    channels.find((channel) => channel.id === selectedId) ??
    channels[0] ??
    null;
  const messagesQuery = useQuery({
    queryKey: ["channel-messages", selected?.id, ownerPubkey],
    queryFn: () => listChannelMessages(selected?.id ?? "", ownerPubkey),
    enabled: Boolean(selected),
    refetchInterval: 30_000,
    retry: false,
  });
  const messages = messagesQuery.data ?? [];
  const typingEntries = useTypingIndicators({
    channelId: selected?.id ?? null,
    channelType: selected?.channelType ?? null,
    ownerPubkey,
  });

  const handleLiveChannelEvent = useCallback(
    (channelId: string) => {
      void queryClient.invalidateQueries({
        queryKey: ["channel-messages", channelId, ownerPubkey],
      });
      void queryClient.invalidateQueries({
        queryKey: ["channels", ownerPubkey],
      });
    },
    [ownerPubkey, queryClient],
  );
  const { status: liveStatus, unread } = useLiveChannels({
    ownerPubkey,
    channels,
    selectedChannelId: selected?.id ?? null,
    onChannelEvent: handleLiveChannelEvent,
  });

  const reactionEventIds = useMemo(
    () => messages.map((message) => message.id),
    [messages],
  );
  const selectedChannelId = selected?.id ?? null;
  useEffect(() => {
    if (!selectedChannelId || !reactionEventIds.length) return;
    const subscription = subscribeEvents(
      relayWsUrl(),
      { kinds: [5, 7], "#e": reactionEventIds },
      () => handleLiveChannelEvent(selectedChannelId),
      { requireNip07: true },
    );
    return subscription.close;
  }, [handleLiveChannelEvent, reactionEventIds, selectedChannelId]);
  useEffect(() => {
    const subscription = subscribeEvents(
      relayWsUrl(),
      { kinds: [30030], "#d": ["buzz:custom-emoji"] },
      () => {
        void queryClient.invalidateQueries({
          queryKey: ["custom-emoji", ownerPubkey],
        });
      },
      { requireNip07: true },
    );
    return subscription.close;
  }, [ownerPubkey, queryClient]);
  useEffect(() => {
    const update = () => {
      void sendPresence(document.hidden ? "away" : "online").catch(() => {});
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      void sendPresence("offline").catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!selectedId && channels[0]) setSelectedId(channels[0].id);
  }, [channels, selectedId]);
  useEffect(() => {
    if (!highlightedId) return;
    const timer = setTimeout(() => {
      document.getElementById(`message-${highlightedId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [highlightedId]);

  const allPubkeys = useMemo(
    () => [
      ownerPubkey,
      ...messages.map((message) => message.pubkey),
      ...(selected?.participantPubkeys ?? []),
      ...(agentsQuery.data ?? []).map((agent) => agent.agent_pubkey),
    ],
    [agentsQuery.data, messages, ownerPubkey, selected?.participantPubkeys],
  );
  const profileKey = [...new Set(allPubkeys)].sort().join(",");
  const profilesQuery = useQuery({
    queryKey: ["profiles", profileKey],
    queryFn: () => listProfiles([...new Set(allPubkeys)]),
    enabled: Boolean(profileKey),
    staleTime: 60_000,
  });
  const profiles = useMemo(
    () =>
      new Map(
        (profilesQuery.data ?? []).map((profile) => [profile.pubkey, profile]),
      ),
    [profilesQuery.data],
  );
  const agentNames = useMemo(
    () =>
      new Map(
        (agentsQuery.data ?? []).map((agent) => [
          agent.agent_pubkey,
          agent.name,
        ]),
      ),
    [agentsQuery.data],
  );

  const refreshSelected = useCallback(async () => {
    if (!selected) return;
    await queryClient.invalidateQueries({
      queryKey: ["channel-messages", selected.id, ownerPubkey],
    });
  }, [ownerPubkey, queryClient, selected]);
  const mutationError = (title: string) => (error: Error) =>
    toast.error(title, { description: error.message });

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
    onError: mutationError("Could not create channel"),
  });
  const dmMutation = useMutation({
    mutationFn: openDm,
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({
        queryKey: ["channels", ownerPubkey],
      });
      setSelectedId(id);
      setDmOpen(false);
    },
    onError: mutationError("Could not open direct message"),
  });
  const sendMutation = useMutation({
    mutationFn: sendChannelMessage,
    onSuccess: refreshSelected,
    onError: mutationError("Could not send message"),
  });
  const editMutation = useMutation({
    mutationFn: editMessage,
    onSuccess: refreshSelected,
    onError: mutationError("Could not edit message"),
  });
  const deleteMessageMutation = useMutation({
    mutationFn: ({
      channelId,
      eventId,
    }: {
      channelId: string;
      eventId: string;
    }) => deleteMessage(channelId, eventId),
    onSuccess: refreshSelected,
    onError: mutationError("Could not delete message"),
  });
  const reactionMutation = useMutation({
    mutationFn: ({
      eventId,
      emoji,
      ownEventId,
      customEmojiUrl,
    }: {
      eventId: string;
      emoji: string;
      ownEventId: string | null;
      customEmojiUrl?: string;
    }) =>
      ownEventId
        ? removeReaction(ownEventId)
        : addReaction(eventId, emoji, customEmojiUrl),
    onSuccess: refreshSelected,
    onError: mutationError("Could not update reaction"),
  });
  const reportMutation = useMutation({
    mutationFn: submitModerationReport,
    onSuccess: () => {
      setReportTarget(null);
      toast.success("Report submitted to community moderators");
    },
    onError: mutationError("Could not submit report"),
  });
  const joinMutation = useMutation({
    mutationFn: joinChannel,
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["channels", ownerPubkey] }),
    onError: mutationError("Could not join channel"),
  });
  const settingsMutation = useMutation({
    mutationFn: updateChannel,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["channels", ownerPubkey],
      });
      setSettingsOpen(false);
      toast.success("Channel updated");
    },
    onError: mutationError("Could not update channel"),
  });
  const removeChannelMutation = useMutation({
    mutationFn: async (action: "leave" | "archive" | "delete") => {
      if (!selected) return;
      if (action === "leave") await leaveChannel(selected.id);
      if (action === "archive") await archiveChannel(selected.id);
      if (action === "delete") await deleteChannel(selected.id);
    },
    onSuccess: async () => {
      setSettingsOpen(false);
      setSelectedId(null);
      await queryClient.invalidateQueries({
        queryKey: ["channels", ownerPubkey],
      });
    },
    onError: mutationError("Could not update channel membership"),
  });
  const searchMutation = useMutation({
    mutationFn: searchMessages,
    onError: mutationError("Search failed"),
  });

  const searchResults: SearchResult[] = (searchMutation.data ?? []).map(
    (event) => {
      const channelId = event.tags.find((tag) => tag[0] === "h")?.[1] ?? "";
      return {
        id: event.id,
        channelId,
        channelName:
          channels.find((channel) => channel.id === channelId)?.name ??
          "unknown",
        author: event.pubkey,
        content: event.content,
      };
    },
  );

  function mentionsFor(content: string): string[] {
    const lower = content.toLowerCase();
    return (agentsQuery.data ?? [])
      .filter((agent) => lower.includes(`@${agent.name.toLowerCase()}`))
      .map((agent) => agent.agent_pubkey);
  }

  async function submitRoot(payload: ComposerPayload) {
    if (!selected) return;
    await sendMutation.mutateAsync({
      channelId: selected.id,
      content: payload.content,
      mentionPubkeys: mentionsFor(payload.content),
      forumPost: selected.channelType === "forum",
      mediaTags: payload.mediaTags,
    });
  }

  const actions: MessageActions = {
    onReply: (message) => setThreadRootId(message.rootId ?? message.id),
    onEdit: async (message, content) => {
      if (!selected) return;
      await editMutation.mutateAsync({
        channelId: selected.id,
        eventId: message.id,
        content,
      });
    },
    onDelete: (message) => {
      if (!selected || !window.confirm("Delete this message?")) return;
      deleteMessageMutation.mutate({
        channelId: selected.id,
        eventId: message.id,
      });
    },
    onReport: setReportTarget,
    onReact: (message, emoji, ownEventId, customEmojiUrl) =>
      reactionMutation.mutate({
        eventId: message.id,
        emoji,
        ownEventId,
        customEmojiUrl,
      }),
  };
  const threadRoot =
    messages.find((message) => message.id === threadRootId) ?? null;
  const ChannelIcon =
    selected?.channelType === "forum"
      ? LayoutList
      : selected?.channelType === "dm"
        ? MessageCircle
        : Hash;

  return (
    <div className="flex h-dvh min-h-0 bg-background">
      <PrimarySidebar ownerPubkey={ownerPubkey} onDisconnect={onDisconnect} />
      <ChannelSidebar
        channels={channels}
        selectedId={selected?.id ?? null}
        unread={unread}
        onCreate={() => setCreateOpen(true)}
        onNewDm={() => setDmOpen(true)}
        onSelect={setSelectedId}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 items-center gap-2 border-b px-3 sm:px-5">
          <ChannelIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold">
              {selected?.name ?? "Channels"}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {selected?.topic || selected?.description}
            </p>
          </div>
          <span
            className="hidden items-center gap-1 text-xs text-muted-foreground md:flex"
            title={`Relay ${liveStatus}`}
          >
            <Circle
              className={`h-2.5 w-2.5 fill-current ${liveStatus === "live" ? "text-green-600" : liveStatus === "offline" ? "text-destructive" : "text-amber-600"}`}
            />
            {liveStatus === "live" ? "Live" : liveStatus}
          </span>
          <select
            aria-label="Channel"
            className="max-w-36 rounded-md border bg-background px-2 py-2 text-sm sm:hidden"
            value={selected?.id ?? ""}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
          <Button
            aria-label="Search messages"
            onClick={() => setSearchOpen(true)}
            size="icon"
            variant="ghost"
          >
            <Search />
          </Button>
          {selected ? (
            <Button
              aria-label="Channel settings"
              onClick={() => setSettingsOpen(true)}
              size="icon"
              variant="ghost"
            >
              <Settings />
            </Button>
          ) : null}
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
          className="min-h-0 flex-1 overflow-y-auto px-0 py-3 sm:px-3"
        >
          {channelsQuery.isLoading ? (
            <CenteredMessage>Creating your starter channels…</CenteredMessage>
          ) : channelsQuery.error ? (
            <CenteredMessage>{channelsQuery.error.message}</CenteredMessage>
          ) : !selected ? (
            <CenteredMessage>No channels are available.</CenteredMessage>
          ) : (
            <MessageTimeline
              actions={actions}
              agentNames={agentNames}
              channel={selected}
              customEmoji={customEmojiQuery.data?.community ?? []}
              loading={messagesQuery.isLoading}
              messages={messages}
              ownerPubkey={ownerPubkey}
              profiles={profiles}
              selectedMessageId={highlightedId}
            />
          )}
        </section>
        {selected ? (
          selected.isMember ? (
            <div className="border-t">
              <TypingLine
                pubkeys={typingEntries
                  .filter((entry) => entry.threadId === null)
                  .map((entry) => entry.pubkey)}
                profiles={profiles}
              />
              <MessageComposer
                channel={selected}
                pending={sendMutation.isPending}
                onSubmit={submitRoot}
                onTyping={() => void sendTypingIndicator(selected.id)}
              />
            </div>
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
      {selected && threadRoot ? (
        <ThreadPanel
          actions={actions}
          agentNames={agentNames}
          channel={selected}
          customEmoji={customEmojiQuery.data?.community ?? []}
          messages={messages}
          onClose={() => setThreadRootId(null)}
          onTyping={() =>
            void sendTypingIndicator(selected.id, threadRoot.id, threadRoot.id)
          }
          ownerPubkey={ownerPubkey}
          pending={sendMutation.isPending}
          profiles={profiles}
          root={threadRoot}
          typingPubkeys={typingEntries
            .filter((entry) => entry.threadId === threadRoot.id)
            .map((entry) => entry.pubkey)}
          onSubmit={async (payload) => {
            await sendMutation.mutateAsync({
              channelId: selected.id,
              content: payload.content,
              mentionPubkeys: mentionsFor(payload.content),
              parentId: threadRoot.id,
              rootId: threadRoot.id,
              mediaTags: payload.mediaTags,
            });
          }}
        />
      ) : null}
      <CreateChannelDialog
        open={createOpen}
        pending={createMutation.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) =>
          createMutation.mutateAsync(input).then(() => undefined)
        }
      />
      <NewDmDialog
        open={dmOpen}
        pending={dmMutation.isPending}
        onClose={() => setDmOpen(false)}
        onSubmit={(pubkeys) =>
          dmMutation.mutateAsync(pubkeys).then(() => undefined)
        }
      />
      <SearchDialog
        open={searchOpen}
        pending={searchMutation.isPending}
        results={searchResults}
        onClose={() => setSearchOpen(false)}
        onSearch={(query) => searchMutation.mutate(query)}
        onSelect={(result) => {
          setSelectedId(result.channelId);
          setHighlightedId(result.id);
          setSearchOpen(false);
        }}
      />
      <ChannelSettingsDialog
        channel={selected}
        open={settingsOpen}
        ownerPubkey={ownerPubkey}
        pending={settingsMutation.isPending || removeChannelMutation.isPending}
        onArchive={() => removeChannelMutation.mutate("archive")}
        onClose={() => setSettingsOpen(false)}
        onDelete={() => {
          if (window.confirm("Delete this channel and its conversation?"))
            removeChannelMutation.mutate("delete");
        }}
        onLeave={() => removeChannelMutation.mutate("leave")}
        onSave={(input) =>
          selected
            ? settingsMutation.mutateAsync({ channelId: selected.id, ...input })
            : Promise.resolve()
        }
      />
      <ReportMessageDialog
        message={reportTarget}
        pending={reportMutation.isPending}
        onClose={() => setReportTarget(null)}
        onSubmit={(input) =>
          reportTarget
            ? reportMutation.mutateAsync({
                authorPubkey: reportTarget.pubkey,
                eventId: reportTarget.id,
                ...input,
              })
            : Promise.resolve()
        }
      />
    </div>
  );
}

function PrimarySidebar({
  ownerPubkey,
  onDisconnect,
}: {
  ownerPubkey: string;
  onDisconnect: () => void;
}) {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar p-3 md:flex md:flex-col">
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
        <SidebarLink href="/" icon={<BookMarked />} label="Repositories" />
        <SidebarLink
          active
          href="/channels"
          icon={<MessageSquare />}
          label="Channels"
        />
        <SidebarLink href="/agents" icon={<Bot />} label="Agents" />
        <SidebarLink href="/settings" icon={<Settings />} label="Settings" />
      </nav>
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
    </aside>
  );
}

function SidebarLink({
  href,
  icon,
  label,
  active = false,
}: {
  href: "/" | "/channels" | "/agents" | "/settings";
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      className={`flex items-center gap-2 rounded-md px-2 py-2 ${active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent"}`}
      to={href}
    >
      <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      {label}
    </Link>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function TypingLine({
  pubkeys,
  profiles,
}: {
  pubkeys: string[];
  profiles: Map<string, { displayName: string | null }>;
}) {
  if (!pubkeys.length) return null;
  const names = pubkeys.map(
    (pubkey) => profiles.get(pubkey)?.displayName || truncatePubkey(pubkey),
  );
  const label =
    names.length === 1
      ? `${names[0]} is typing…`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing…`
        : `${names[0]}, ${names[1]}, and ${names.length - 2} others are typing…`;
  return (
    <p className="px-5 pt-2 text-xs text-muted-foreground" role="status">
      {label}
    </p>
  );
}
