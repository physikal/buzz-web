import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BellRing,
  BookMarked,
  Bot,
  CheckCheck,
  FolderKanban,
  GitFork,
  Inbox,
  LogOut,
  MessageSquare,
  RefreshCcw,
  Settings,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import { listAgents } from "@/features/agents/agent-api";
import { OwnerConnection } from "@/features/agents/ui/OwnerConnection";
import {
  ensureStarterChannels,
  listProfiles,
  sendChannelMessage,
  type Channel,
  type UserProfile,
} from "@/features/channels/channel-api";
import { ReadStateManager } from "@/features/channels/read-state";
import {
  deleteDraft,
  listDrafts,
  subscribeDrafts,
} from "@/features/channels/draft-store";
import { lockOwnerVault } from "@/features/owner-vault/lib/vault-worker-client";
import {
  cancelReminder,
  completeReminder,
  listReminders,
  type Reminder,
  snoozeReminder,
} from "@/features/reminders/reminder-api";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { relativeTime } from "@/shared/lib/relative-time";
import { Button } from "@/shared/ui/button";
import {
  listInboxItems,
  subscribeInbox,
  type InboxCategory,
  type InboxItem,
} from "../home-api";
import { HomeReminderDetail, HomeReminderRow, isDue } from "./HomeReminder";
import { HomeDraftDetail, HomeDraftRow } from "./HomeDraft";

type InboxFilter =
  | "all"
  | "project"
  | "thread"
  | "agent_activity"
  | InboxCategory
  | "reminders"
  | "drafts";

export function HomePage() {
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(null);
  if (!ownerPubkey) return <OwnerConnection onConnected={setOwnerPubkey} />;
  return (
    <HomeWorkspace
      ownerPubkey={ownerPubkey}
      onDisconnect={() => {
        void lockOwnerVault();
        setOwnerPubkey(null);
      }}
    />
  );
}

function HomeWorkspace({
  ownerPubkey,
  onDisconnect,
}: {
  ownerPubkey: string;
  onDisconnect: () => void;
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedReminderId, setSelectedReminderId] = useState<string | null>(
    null,
  );
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState(() => listDrafts(ownerPubkey));
  const [readMarkers, setReadMarkers] = useState<Record<string, number>>({});
  const readManagerRef = useRef<ReadStateManager | null>(null);
  const agentsQuery = useQuery({
    queryKey: ["managed-agents", ownerPubkey],
    queryFn: listAgents,
    staleTime: 10_000,
    retry: false,
  });
  const agentPubkeys = useMemo(
    () => (agentsQuery.data ?? []).map((agent) => agent.agent_pubkey),
    [agentsQuery.data],
  );
  const agentKey = [...agentPubkeys].sort().join(",");
  const inboxQuery = useQuery({
    queryKey: ["home-inbox", ownerPubkey, agentKey],
    queryFn: () => listInboxItems(ownerPubkey, agentPubkeys),
    enabled: !agentsQuery.isLoading,
    refetchInterval: 30_000,
    retry: false,
  });
  const channelsQuery = useQuery({
    queryKey: ["channels", ownerPubkey],
    queryFn: () => ensureStarterChannels(ownerPubkey),
    staleTime: 10_000,
    retry: false,
  });
  const remindersQuery = useQuery({
    queryKey: ["reminders", ownerPubkey],
    queryFn: () => listReminders(ownerPubkey),
    refetchInterval: 30_000,
    retry: false,
  });
  const authorKey = [
    ...new Set((inboxQuery.data ?? []).map((item) => item.pubkey)),
  ]
    .sort()
    .join(",");
  const profilesQuery = useQuery({
    queryKey: ["profiles", authorKey],
    queryFn: () => listProfiles(authorKey ? authorKey.split(",") : []),
    enabled: Boolean(authorKey),
    staleTime: 60_000,
  });
  const profiles = useMemo(
    () =>
      new Map(
        (profilesQuery.data ?? []).map((profile) => [profile.pubkey, profile]),
      ),
    [profilesQuery.data],
  );
  const channels = channelsQuery.data ?? [];
  const items = inboxQuery.data ?? [];
  const reminders = (remindersQuery.data ?? []).filter(
    (reminder) => reminder.content.status === "pending",
  );
  const visibleReminders = reminders.filter(
    (reminder) => !unreadOnly || isDue(reminder),
  );
  const explicitlySelectedReminder =
    visibleReminders.find((reminder) => reminder.id === selectedReminderId) ??
    null;
  const selectedReminder =
    explicitlySelectedReminder ?? visibleReminders[0] ?? null;
  const isReminders = filter === "reminders";
  const explicitlySelectedDraft =
    drafts.find((draft) => draft.key === selectedDraftId) ?? null;
  const selectedDraft = explicitlySelectedDraft ?? drafts[0] ?? null;
  const selectedDraftChannel = channels.find(
    (channel) => channel.id === selectedDraft?.channelId,
  );
  const selectedDraftCanSend = Boolean(
    selectedDraftChannel?.isMember &&
      !selectedDraftChannel.archived &&
      selectedDraftChannel.channelType !== "forum",
  );
  const isDrafts = filter === "drafts";
  const ownedAgentPubkeys = new Set(agentPubkeys);
  const isUnread = (item: InboxItem) =>
    (readMarkers[`msg:${item.id}`] ?? 0) < item.createdAt;
  const visibleItems = items.filter(
    (item) =>
      (filter === "all" ||
        (filter === "project" && Boolean(item.projectAddress)) ||
        (filter === "thread" && item.isThread) ||
        (filter === "agent_activity" && ownedAgentPubkeys.has(item.pubkey)) ||
        item.category === filter) &&
      (!unreadOnly || isUnread(item)),
  );
  const explicitlySelected =
    visibleItems.find((item) => item.id === selectedId) ?? null;
  const selected = explicitlySelected ?? visibleItems[0] ?? null;
  const dueReminderCount = reminders.filter(isDue).length;
  const displayedCount = isDrafts
    ? drafts.length
    : isReminders
      ? dueReminderCount
      : visibleItems.filter(isUnread).length;
  const mobileDetailVisible = isDrafts
    ? Boolean(explicitlySelectedDraft)
    : isReminders
      ? Boolean(explicitlySelectedReminder)
      : Boolean(explicitlySelected);
  const reminderTransition = useMutation({
    mutationFn: ({
      reminder,
      action,
      notBefore,
    }: {
      reminder: Reminder;
      action: "complete" | "cancel" | "snooze";
      notBefore?: number;
    }) =>
      action === "complete"
        ? completeReminder(reminder)
        : action === "cancel"
          ? cancelReminder(reminder)
          : snoozeReminder(reminder, notBefore ?? 0),
    onSuccess: () => {
      setSelectedReminderId(null);
      void queryClient.invalidateQueries({
        queryKey: ["reminders", ownerPubkey],
      });
      toast.success("Reminder updated");
    },
    onError: (error) =>
      toast.error("Could not update reminder", { description: error.message }),
  });
  const sendDraftMutation = useMutation({
    mutationFn: async (draft: (typeof drafts)[number]) => {
      const channel = channels.find((item) => item.id === draft.channelId);
      if (
        !channel?.isMember ||
        channel.archived ||
        channel.channelType === "forum"
      )
        throw new Error("Open this draft before sending it.");
      const lower = draft.content.toLowerCase();
      await sendChannelMessage({
        channelId: channel.id,
        content: draft.content,
        mentionPubkeys: (agentsQuery.data ?? [])
          .filter((agent) => lower.includes(`@${agent.name.toLowerCase()}`))
          .map((agent) => agent.agent_pubkey),
        parentId: draft.parentId,
        rootId: draft.parentId,
      });
      return draft;
    },
    onSuccess: (draft) => {
      deleteDraft(ownerPubkey, draft.key);
      setSelectedDraftId(null);
      toast.success("Draft sent");
    },
    onError: (error) =>
      toast.error("Could not send draft", { description: error.message }),
  });

  useEffect(() => {
    const manager = new ReadStateManager(ownerPubkey);
    readManagerRef.current = manager;
    const sync = () => setReadMarkers(manager.snapshot());
    const unsubscribe = manager.subscribe(sync);
    sync();
    void manager.initialize();
    return () => {
      unsubscribe();
      manager.destroy();
      if (readManagerRef.current === manager) readManagerRef.current = null;
    };
  }, [ownerPubkey]);

  useEffect(() => {
    const sync = () => setDrafts(listDrafts(ownerPubkey));
    sync();
    return subscribeDrafts(sync);
  }, [ownerPubkey]);

  useEffect(
    () =>
      subscribeInbox(ownerPubkey, agentPubkeys, (item) => {
        queryClient.setQueryData<InboxItem[]>(
          ["home-inbox", ownerPubkey, agentKey],
          (current = []) =>
            [item, ...current.filter((candidate) => candidate.id !== item.id)]
              .sort((left, right) => right.createdAt - left.createdAt)
              .slice(0, 120),
        );
      }),
    [agentKey, agentPubkeys, ownerPubkey, queryClient],
  );

  const markRead = (item: InboxItem) => {
    readManagerRef.current?.markRead(`msg:${item.id}`, item.createdAt);
    setReadMarkers((current) => ({
      ...current,
      [`msg:${item.id}`]: item.createdAt,
    }));
  };

  return (
    <div className="flex h-dvh min-h-0 bg-background">
      <HomeSidebar onDisconnect={onDisconnect} ownerPubkey={ownerPubkey} />
      <main className="flex min-w-0 flex-1">
        <section
          className={`min-w-0 border-r ${mobileDetailVisible ? "hidden w-full sm:flex sm:w-96" : "flex w-full sm:w-96"} flex-col`}
        >
          <header className="border-b px-4 py-4">
            <div className="flex items-center gap-3">
              <h1 className="min-w-0 flex-1 text-xl font-semibold">Inbox</h1>
              {displayedCount ? (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                  {displayedCount}
                </span>
              ) : null}
              <Button
                aria-label="Refresh inbox"
                disabled={
                  isDrafts
                    ? false
                    : isReminders
                      ? remindersQuery.isFetching
                      : inboxQuery.isFetching
                }
                onClick={() => {
                  if (isDrafts) setDrafts(listDrafts(ownerPubkey));
                  else
                    void (isReminders
                      ? remindersQuery.refetch()
                      : inboxQuery.refetch());
                }}
                size="icon"
                variant="ghost"
              >
                <RefreshCcw />
              </Button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <label className="sr-only" htmlFor="inbox-filter">
                Inbox filter
              </label>
              <select
                className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
                id="inbox-filter"
                onChange={(event) => {
                  setFilter(event.target.value as InboxFilter);
                  setSelectedId(null);
                  setSelectedReminderId(null);
                  setSelectedDraftId(null);
                }}
                value={filter}
              >
                <option value="all">All</option>
                <option value="project">Projects</option>
                <option value="mention">Mentions</option>
                <option value="thread">Threads</option>
                <option value="needs_action">Needs action</option>
                <option value="agent_activity">Agents</option>
                <option value="reminders">Reminders</option>
                <option value="drafts">Drafts</option>
              </select>
              <Button
                aria-label="Mark all read"
                disabled={
                  !visibleItems.some(isUnread) || isReminders || isDrafts
                }
                onClick={() => {
                  for (const item of visibleItems) markRead(item);
                }}
                size="icon"
                variant="ghost"
              >
                <CheckCheck />
              </Button>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                checked={unreadOnly}
                disabled={isDrafts}
                onChange={(event) => setUnreadOnly(event.target.checked)}
                type="checkbox"
              />
              Unread only
            </label>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isDrafts
              ? drafts.map((draft) => (
                  <HomeDraftRow
                    channel={channels.find(
                      (channel) => channel.id === draft.channelId,
                    )}
                    draft={draft}
                    key={draft.key}
                    onSelect={() => setSelectedDraftId(draft.key)}
                    selected={selectedDraft?.key === draft.key}
                  />
                ))
              : isReminders
                ? visibleReminders.map((reminder) => (
                    <HomeReminderRow
                      key={reminder.id}
                      onSelect={() => setSelectedReminderId(reminder.id)}
                      reminder={reminder}
                      selected={selectedReminder?.id === reminder.id}
                    />
                  ))
                : visibleItems.map((item) => (
                    <InboxRow
                      channel={channels.find(
                        (channel) => channel.id === item.channelId,
                      )}
                      item={item}
                      kindLabel={inboxKindLabel(item, ownedAgentPubkeys)}
                      key={item.id}
                      onSelect={() => {
                        setSelectedId(item.id);
                        markRead(item);
                      }}
                      profile={profiles.get(item.pubkey)}
                      selected={selected?.id === item.id}
                      unread={isUnread(item)}
                    />
                  ))}
            {!(isDrafts
              ? false
              : isReminders
                ? remindersQuery.isLoading
                : inboxQuery.isLoading) &&
            !(isDrafts
              ? drafts.length
              : isReminders
                ? visibleReminders.length
                : visibleItems.length) ? (
              <div className="px-6 py-16 text-center">
                <Inbox className="mx-auto h-7 w-7 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">
                  {unreadOnly
                    ? isReminders
                      ? "No reminders due"
                      : emptyInboxLabel(filter, true)
                    : isDrafts
                      ? "No drafts"
                      : isReminders
                        ? "No reminders"
                        : emptyInboxLabel(filter, false)}
                </p>
              </div>
            ) : null}
            {(
              isDrafts
                ? false
                : isReminders
                  ? remindersQuery.isLoading
                  : inboxQuery.isLoading
            ) ? (
              <p className="p-6 text-sm text-muted-foreground">
                Loading inbox…
              </p>
            ) : null}
          </div>
        </section>
        {isDrafts ? (
          <HomeDraftDetail
            canSend={selectedDraftCanSend}
            channel={selectedDraftChannel}
            draft={selectedDraft}
            key={selectedDraft?.key ?? "empty-draft"}
            mobileVisible={Boolean(explicitlySelectedDraft)}
            pending={sendDraftMutation.isPending}
            onBack={() => setSelectedDraftId(null)}
            onDelete={(key) => {
              deleteDraft(ownerPubkey, key);
              setSelectedDraftId(null);
            }}
            onSend={(draft) =>
              sendDraftMutation.mutateAsync(draft).then(() => undefined)
            }
          />
        ) : isReminders ? (
          <HomeReminderDetail
            key={selectedReminder?.id ?? "empty"}
            mobileVisible={Boolean(explicitlySelectedReminder)}
            onAction={(action, reminder, notBefore) =>
              reminderTransition.mutate({ action, reminder, notBefore })
            }
            onBack={() => setSelectedReminderId(null)}
            pending={reminderTransition.isPending}
            reminder={selectedReminder}
          />
        ) : (
          <InboxDetail
            channel={channels.find(
              (channel) => channel.id === selected?.channelId,
            )}
            item={selected}
            kindLabel={
              selected
                ? inboxKindLabel(selected, ownedAgentPubkeys)
                : "Activity"
            }
            mobileVisible={Boolean(explicitlySelected)}
            onBack={() => setSelectedId(null)}
            profile={selected ? profiles.get(selected.pubkey) : undefined}
          />
        )}
      </main>
    </div>
  );
}

function InboxRow({
  item,
  profile,
  channel,
  selected,
  unread,
  kindLabel,
  onSelect,
}: {
  item: InboxItem;
  profile?: UserProfile;
  channel?: Channel;
  selected: boolean;
  unread: boolean;
  kindLabel: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={`flex w-full gap-3 border-b px-4 py-3 text-left hover:bg-muted/50 ${selected ? "bg-muted/50" : ""}`}
      onClick={onSelect}
      type="button"
    >
      <Avatar profile={profile} pubkey={item.pubkey} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <strong className="min-w-0 flex-1 truncate text-sm">
            {profile?.displayName || truncatePubkey(item.pubkey)}
          </strong>
          <time className="shrink-0 text-xs text-muted-foreground">
            {relativeTime(item.createdAt)}
          </time>
        </span>
        <span className="mt-0.5 block text-xs font-medium text-muted-foreground">
          {kindLabel}
          {channel?.channelType !== "dm" && channel?.name
            ? ` in #${channel.name}`
            : ""}
        </span>
        <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">
          {item.content || "A workflow is waiting for approval."}
        </span>
      </span>
      {unread ? (
        <>
          <span className="sr-only">Unread</span>
          <span
            aria-hidden="true"
            className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary"
          />
        </>
      ) : null}
    </button>
  );
}

function InboxDetail({
  item,
  profile,
  channel,
  onBack,
  mobileVisible,
  kindLabel,
}: {
  item: InboxItem | null;
  profile?: UserProfile;
  channel?: Channel;
  onBack: () => void;
  mobileVisible: boolean;
  kindLabel: string;
}) {
  if (!item)
    return (
      <section className="hidden min-w-0 flex-1 items-center justify-center sm:flex">
        <div className="text-center text-sm text-muted-foreground">
          <BellRing className="mx-auto mb-3 h-8 w-8" />
          Select an inbox item
        </div>
      </section>
    );
  return (
    <section
      className={`${mobileVisible ? "flex" : "hidden"} min-w-0 flex-1 flex-col sm:flex`}
    >
      <header className="flex min-h-16 items-center gap-3 border-b px-4 sm:px-6">
        <Button className="sm:hidden" onClick={onBack} variant="ghost">
          Back
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{kindLabel}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {channel?.channelType !== "dm" && channel?.name
              ? `#${channel.name}`
              : "Workspace activity"}
          </p>
        </div>
        {item.channelId ? (
          <Button asChild variant="outline">
            <Link
              search={{ channel: item.channelId, message: item.id }}
              to="/channels"
            >
              <MessageSquare /> Open in channel
            </Link>
          </Button>
        ) : item.projectAddress ? (
          <Button asChild variant="outline">
            <Link
              params={{ projectId: projectIdFromAddress(item.projectAddress) }}
              to="/projects/$projectId"
            >
              <FolderKanban /> Open project
            </Link>
          </Button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-10">
        <article className="mx-auto max-w-3xl">
          <div className="flex items-center gap-3 border-b pb-5">
            <Avatar profile={profile} pubkey={item.pubkey} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">
                {profile?.displayName || truncatePubkey(item.pubkey)}
              </p>
              <time className="text-xs text-muted-foreground">
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(item.createdAt * 1_000))}
              </time>
            </div>
          </div>
          <div className="prose prose-sm mt-6 max-w-none dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {item.content || "A workflow is waiting for your approval."}
            </ReactMarkdown>
          </div>
        </article>
      </div>
    </section>
  );
}

function inboxKindLabel(item: InboxItem, ownedAgentPubkeys: Set<string>) {
  if (item.projectAddress) return "Project";
  if (item.isThread) return "Thread";
  if (ownedAgentPubkeys.has(item.pubkey)) return "Agent";
  return item.category === "needs_action" ? "Needs Action" : "Mention";
}

function projectIdFromAddress(address: string) {
  const [, pubkey, ...dtag] = address.split(":");
  return `${pubkey}:${dtag.join(":")}`;
}

function emptyInboxLabel(filter: InboxFilter, unread: boolean) {
  const labels: Record<InboxFilter, [string, string]> = {
    all: ["No activity yet", "No unread activity"],
    project: ["No project work found", "No unread project work"],
    mention: ["No mentions found", "No unread mentions"],
    thread: ["No threads found", "No unread threads"],
    needs_action: ["Nothing needs action", "No unread items needing action"],
    agent_activity: ["No agent updates found", "No unread agent updates"],
    reminders: ["No reminders", "No unread reminders"],
    drafts: ["No drafts", "No unread drafts"],
  };
  return labels[filter][unread ? 1 : 0];
}

function Avatar({
  profile,
  pubkey,
}: {
  profile?: UserProfile;
  pubkey: string;
}) {
  if (profile?.avatarUrl)
    return (
      <img
        alt=""
        className="h-9 w-9 shrink-0 rounded-full object-cover"
        src={profile.avatarUrl}
      />
    );
  let hash = 0;
  for (const character of pubkey)
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  const compactIdentity = truncatePubkey(pubkey);
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: `hsl(${hue} 48% 42%)` }}
    >
      {compactIdentity.slice(0, 2).toUpperCase()}
    </span>
  );
}

function HomeSidebar({
  ownerPubkey,
  onDisconnect,
}: {
  ownerPubkey: string;
  onDisconnect: () => void;
}) {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar p-3 md:flex md:flex-col">
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
        <HomeNav active icon={<Inbox />} label="Inbox" to="/" />
        <HomeNav icon={<BookMarked />} label="Repositories" to="/repos" />
        <HomeNav icon={<MessageSquare />} label="Channels" to="/channels" />
        <HomeNav icon={<Zap />} label="Pulse" to="/pulse" />
        <HomeNav icon={<FolderKanban />} label="Projects" to="/projects" />
        <HomeNav icon={<GitFork />} label="Workflows" to="/workflows" />
        <HomeNav icon={<Bot />} label="Agents" to="/agents" />
        <HomeNav icon={<Settings />} label="Settings" to="/settings" />
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

function HomeNav({
  to,
  label,
  icon,
  active,
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
  label: string;
  icon: React.ReactNode;
  active?: boolean;
}) {
  return (
    <Link
      className={`flex items-center gap-2 rounded-md px-2 py-2 ${active ? "bg-sidebar-accent font-medium" : "text-muted-foreground hover:bg-sidebar-accent"}`}
      to={to}
    >
      <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      {label}
    </Link>
  );
}
