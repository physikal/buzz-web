import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Circle,
  Hash,
  LayoutList,
  MessageCircle,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { listAgents } from "@/features/agents/agent-api";
import { listPersonas } from "@/features/agents/persona-api";
import { listTeams } from "@/features/agents/team-api";
import { OwnerConnection } from "@/features/agents/ui/OwnerConnection";
import {
  listChannelTemplates,
  renderCanvasTemplate,
} from "@/features/channel-templates/channel-template-api";
import { TemplateDeployDialog } from "@/features/channel-templates/ui/TemplateDeployDialog";
import { lockOwnerVault } from "@/features/owner-vault/lib/vault-worker-client";
import { useWorkspacePresence } from "@/features/presence/use-presence";
import { UserProfileDialog } from "@/features/profile/UserProfileDialog";
import { ReminderDialog } from "@/features/reminders/ui/ReminderDialog";
import {
  resolveMessageSearchInput,
  toMessageSearchResult,
} from "@/features/search/search-operators";
import {
  HuddleBar,
  HuddleHeaderButton,
  StartHuddleDialog,
} from "@/features/huddles/HuddleControls";
import { useHuddle } from "@/features/huddles/use-huddle";
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
  restoreChannel,
  searchMessages,
  sendChannelMessage,
  setChannelCanvas,
  sendTypingIndicator,
  updateChannel,
  type ChannelMessage,
} from "../channel-api";
import { useLiveChannels } from "../use-live-channels";
import { useChannelMutes } from "../use-channel-mutes";
import { useChannelStars } from "../use-channel-stars";
import { useTypingIndicators } from "../use-typing";
import { ChannelSidebar } from "./ChannelSidebar";
import { ChannelsPrimarySidebar } from "./ChannelsPrimarySidebar";
import {
  ChannelBrowserDialog,
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

export function ChannelsPage({
  initialChannelId,
  initialMessageId,
}: {
  initialChannelId?: string;
  initialMessageId?: string;
} = {}) {
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(null);
  if (!ownerPubkey) return <OwnerConnection onConnected={setOwnerPubkey} />;
  return (
    <ChannelsWorkspace
      initialChannelId={initialChannelId}
      initialMessageId={initialMessageId}
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
  initialChannelId,
  initialMessageId,
}: {
  ownerPubkey: string;
  onDisconnect: () => void;
  initialChannelId?: string;
  initialMessageId?: string;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(
    initialChannelId ?? null,
  );
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(
    initialMessageId ?? null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [huddleStartOpen, setHuddleStartOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<ChannelMessage | null>(null);
  const [profileTarget, setProfileTarget] = useState<string | null>(null);
  const [reminderTarget, setReminderTarget] = useState<ChannelMessage | null>(
    null,
  );
  const [templateSetup, setTemplateSetup] = useState<{
    channelId: string;
    templateId: string;
  } | null>(null);

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
  const templatesQuery = useQuery({
    queryKey: ["channel-templates", ownerPubkey],
    queryFn: () => listChannelTemplates(ownerPubkey),
    staleTime: 30_000,
  });
  const personasQuery = useQuery({
    queryKey: ["agent-personas", ownerPubkey],
    queryFn: () => listPersonas(ownerPubkey),
    staleTime: 30_000,
  });
  const teamsQuery = useQuery({
    queryKey: ["agent-teams", ownerPubkey],
    queryFn: () => listTeams(ownerPubkey),
    staleTime: 30_000,
  });
  const customEmojiQuery = useQuery({
    queryKey: ["custom-emoji", ownerPubkey],
    queryFn: () => getCustomEmoji(ownerPubkey),
    staleTime: 30_000,
    retry: false,
  });
  const allChannels = channelsQuery.data ?? [];
  const channels = useMemo(
    () => allChannels.filter((channel) => !channel.archived),
    [allChannels],
  );
  const { mutedChannelIds, setMuted } = useChannelMutes(ownerPubkey);
  const { starredChannelIds, setStarred } = useChannelStars(ownerPubkey);
  const selected =
    channels.find((channel) => channel.id === selectedId) ??
    channels[0] ??
    null;
  const huddle = useHuddle({
    channelId: selected?.id ?? null,
    channelName: selected?.name ?? null,
  });
  const templateSetupDefinition = templateSetup
    ? templatesQuery.data?.find((item) => item.id === templateSetup.templateId)
    : null;
  const messagesQuery = useQuery({
    queryKey: ["channel-messages", selected?.id, ownerPubkey, highlightedId],
    queryFn: () =>
      listChannelMessages(selected?.id ?? "", ownerPubkey, highlightedId),
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
  const {
    status: liveStatus,
    unread,
    markChannelRead,
    markChannelUnread,
  } = useLiveChannels({
    ownerPubkey,
    channels,
    selectedChannelId: selected?.id ?? null,
    onChannelEvent: handleLiveChannelEvent,
    mutedChannelIds,
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
    if (channels[0] && !channels.some((channel) => channel.id === selectedId))
      setSelectedId(channels[0].id);
  }, [channels, selectedId]);
  useEffect(() => {
    if (!highlightedId || messages.length === 0) return;
    const timer = setTimeout(() => {
      document.getElementById(`message-${highlightedId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [highlightedId, messages.length]);

  const allPubkeys = useMemo(
    () => [
      ownerPubkey,
      ...messages.map((message) => message.pubkey),
      ...(selected?.participantPubkeys ?? []),
      ...(huddle.joined?.participants ?? []),
      ...(agentsQuery.data ?? []).map((agent) => agent.agent_pubkey),
    ],
    [
      agentsQuery.data,
      huddle.joined?.participants,
      messages,
      ownerPubkey,
      selected?.participantPubkeys,
    ],
  );
  const profileKey = [...new Set(allPubkeys)].sort().join(",");
  const { presence, userStatuses } = useWorkspacePresence(allPubkeys);
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
    mutationFn: async (input: {
      name: string;
      description: string;
      channelType: "stream" | "forum";
      visibility: "open" | "private";
      templateId?: string;
    }) => {
      const id = await createChannel(input);
      const template = templatesQuery.data?.find(
        (item) => item.id === input.templateId,
      );
      if (template?.canvasTemplate) {
        try {
          await setChannelCanvas(
            id,
            renderCanvasTemplate(template, input.name),
          );
        } catch (error) {
          toast.warning("Channel created without its canvas", {
            description:
              error instanceof Error ? error.message : "Canvas setup failed.",
          });
        }
      }
      return id;
    },
    onSuccess: async (id, input) => {
      await queryClient.invalidateQueries({
        queryKey: ["channels", ownerPubkey],
      });
      setSelectedId(id);
      setCreateOpen(false);
      toast.success("Channel created");
      const template = templatesQuery.data?.find(
        (item) => item.id === input.templateId,
      );
      if (
        template &&
        (template.personaIds.length > 0 || template.teamIds.length > 0)
      )
        setTemplateSetup({ channelId: id, templateId: template.id });
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
  const restoreMutation = useMutation({
    mutationFn: async (channelId: string) => {
      await restoreChannel(channelId);
      return channelId;
    },
    onSuccess: async (channelId) => {
      await queryClient.invalidateQueries({
        queryKey: ["channels", ownerPubkey],
      });
      setBrowserOpen(false);
      setSelectedId(channelId);
      toast.success("Channel restored");
    },
    onError: mutationError("Could not restore channel"),
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
    mutationFn: (rawQuery: string) => {
      const input = resolveMessageSearchInput(rawQuery, channels, [
        ...(agentsQuery.data ?? []).map((agent) => ({
          pubkey: agent.agent_pubkey,
          name: agent.name,
        })),
        ...[...profiles.values()].map((profile) => ({
          pubkey: profile.pubkey,
          name: profile.displayName,
        })),
      ]);
      return input ? searchMessages(input) : Promise.resolve([]);
    },
    onError: mutationError("Search failed"),
  });

  const searchResults: SearchResult[] = (searchMutation.data ?? []).map(
    (event) => toMessageSearchResult(event, channels, agentNames, profiles),
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
    onRemind: setReminderTarget,
    onOpenProfile: setProfileTarget,
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
      <ChannelsPrimarySidebar
        ownerPubkey={ownerPubkey}
        onDisconnect={onDisconnect}
      />
      <ChannelSidebar
        channels={channels}
        selectedId={selected?.id ?? null}
        mutedChannelIds={mutedChannelIds}
        starredChannelIds={starredChannelIds}
        unread={unread}
        onCreate={() => setCreateOpen(true)}
        onNewDm={() => setDmOpen(true)}
        onBrowse={() => setBrowserOpen(true)}
        onSelect={setSelectedId}
        onStarredChange={setStarred}
        onMarkRead={markChannelRead}
        onMarkUnread={markChannelUnread}
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
          <HuddleHeaderButton
            disabled={!selected?.isMember}
            huddle={huddle}
            onStart={() => setHuddleStartOpen(true)}
          />
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
              presence={presence}
              profiles={profiles}
              selectedMessageId={highlightedId}
            />
          )}
        </section>
        <HuddleBar
          agentNames={agentNames}
          agents={agentsQuery.data ?? []}
          channelName={
            allChannels.find(
              (channel) => channel.id === huddle.joined?.parentChannelId,
            )?.name ??
            selected?.name ??
            null
          }
          huddle={huddle}
          customEmoji={customEmojiQuery.data?.community ?? []}
          ownerPubkey={ownerPubkey}
          profiles={profiles}
        />
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
          presence={presence}
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
        templates={templatesQuery.data ?? []}
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) =>
          createMutation.mutateAsync(input).then(() => undefined)
        }
      />
      <StartHuddleDialog
        agents={agentsQuery.data ?? []}
        huddle={huddle}
        open={huddleStartOpen}
        onClose={() => setHuddleStartOpen(false)}
      />
      <UserProfileDialog
        agentName={profileTarget ? agentNames.get(profileTarget) : undefined}
        onClose={() => setProfileTarget(null)}
        onMessage={(pubkey) => {
          dmMutation.mutate([pubkey]);
          setProfileTarget(null);
        }}
        ownerPubkey={ownerPubkey}
        presence={
          profileTarget ? (presence.get(profileTarget) ?? "offline") : "offline"
        }
        profile={profileTarget ? profiles.get(profileTarget) : undefined}
        pubkey={profileTarget}
        userStatus={profileTarget ? userStatuses.get(profileTarget) : undefined}
      />
      <ChannelBrowserDialog
        channels={allChannels}
        open={browserOpen}
        pendingChannelId={
          restoreMutation.isPending
            ? restoreMutation.variables
            : joinMutation.isPending
              ? joinMutation.variables
              : null
        }
        onClose={() => setBrowserOpen(false)}
        onJoin={(channelId) => joinMutation.mutate(channelId)}
        onOpen={(channelId) => {
          setSelectedId(channelId);
          setBrowserOpen(false);
        }}
        onRestore={(channelId) => restoreMutation.mutate(channelId)}
      />
      {templateSetup && templateSetupDefinition ? (
        <TemplateDeployDialog
          channelId={templateSetup.channelId}
          personas={personasQuery.data ?? []}
          teams={teamsQuery.data ?? []}
          template={templateSetupDefinition}
          onClose={() => setTemplateSetup(null)}
          onDeployed={(result) => {
            setTemplateSetup(null);
            void queryClient.invalidateQueries({
              queryKey: ["managed-agents", ownerPubkey],
            });
            if (result.failures.length)
              toast.warning(
                `${result.failures.length} template agent${result.failures.length === 1 ? "" : "s"} could not be added`,
                { description: result.failures.join("\n") },
              );
            else toast.success("Template agents added");
          }}
        />
      ) : null}
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
        onSearch={searchMutation.mutate}
        onSelect={(result) => {
          setSelectedId(result.channelId);
          setThreadRootId(result.rootId);
          setHighlightedId(result.id);
          setSearchOpen(false);
        }}
      />
      <ChannelSettingsDialog
        channel={selected}
        isMuted={selected ? mutedChannelIds.has(selected.id) : false}
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
        onMutedChange={(muted) => {
          if (selected) setMuted(selected.id, muted);
        }}
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
      <ReminderDialog
        onClose={() => setReminderTarget(null)}
        open={reminderTarget !== null}
        target={
          reminderTarget && selected
            ? {
                eventId: reminderTarget.id,
                channelId: selected.id,
                preview: reminderTarget.content.slice(0, 280),
                authorPubkey: reminderTarget.pubkey,
              }
            : undefined
        }
      />
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
