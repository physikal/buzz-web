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
import { OwnerConnection } from "@/features/agents/ui/OwnerConnection";
import {
  ensureStarterChannels,
  listProfiles,
  type Channel,
  type UserProfile,
} from "@/features/channels/channel-api";
import { ReadStateManager } from "@/features/channels/read-state";
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

type InboxFilter = "all" | InboxCategory | "reminders";

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
  const [readMarkers, setReadMarkers] = useState<Record<string, number>>({});
  const readManagerRef = useRef<ReadStateManager | null>(null);
  const inboxQuery = useQuery({
    queryKey: ["home-inbox", ownerPubkey],
    queryFn: () => listInboxItems(ownerPubkey),
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
  const isUnread = (item: InboxItem) =>
    (readMarkers[`msg:${item.id}`] ?? 0) < item.createdAt;
  const visibleItems = items.filter(
    (item) =>
      (filter === "all" || item.category === filter) &&
      (!unreadOnly || isUnread(item)),
  );
  const explicitlySelected =
    visibleItems.find((item) => item.id === selectedId) ?? null;
  const selected = explicitlySelected ?? visibleItems[0] ?? null;
  const unreadCount = items.filter(isUnread).length;
  const dueReminderCount = reminders.filter(isDue).length;
  const displayedCount = isReminders ? dueReminderCount : unreadCount;
  const mobileDetailVisible = isReminders
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

  useEffect(
    () =>
      subscribeInbox(ownerPubkey, (item) => {
        queryClient.setQueryData<InboxItem[]>(
          ["home-inbox", ownerPubkey],
          (current = []) =>
            [item, ...current.filter((candidate) => candidate.id !== item.id)]
              .sort((left, right) => right.createdAt - left.createdAt)
              .slice(0, 120),
        );
      }),
    [ownerPubkey, queryClient],
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
                  isReminders
                    ? remindersQuery.isFetching
                    : inboxQuery.isFetching
                }
                onClick={() =>
                  void (isReminders
                    ? remindersQuery.refetch()
                    : inboxQuery.refetch())
                }
                size="icon"
                variant="ghost"
              >
                <RefreshCcw />
              </Button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="grid min-w-0 flex-1 grid-cols-4 rounded-md border p-0.5">
                {(
                  [
                    ["all", "All"],
                    ["mention", "Mentions"],
                    ["needs_action", "Action"],
                    ["reminders", "Reminders"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    className={`rounded px-2 py-1.5 text-xs ${filter === value ? "bg-accent font-medium" : "text-muted-foreground"}`}
                    key={value}
                    onClick={() => {
                      setFilter(value);
                      setSelectedId(null);
                      setSelectedReminderId(null);
                    }}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button
                aria-label="Mark all read"
                disabled={!unreadCount || isReminders}
                onClick={() => {
                  for (const item of items) markRead(item);
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
                onChange={(event) => setUnreadOnly(event.target.checked)}
                type="checkbox"
              />
              Unread only
            </label>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isReminders
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
            {!(isReminders ? remindersQuery.isLoading : inboxQuery.isLoading) &&
            !(isReminders ? visibleReminders.length : visibleItems.length) ? (
              <div className="px-6 py-16 text-center">
                <Inbox className="mx-auto h-7 w-7 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">
                  {unreadOnly
                    ? isReminders
                      ? "No reminders due"
                      : "No unread activity"
                    : isReminders
                      ? "No reminders"
                      : "No activity yet"}
                </p>
              </div>
            ) : null}
            {(isReminders ? remindersQuery.isLoading : inboxQuery.isLoading) ? (
              <p className="p-6 text-sm text-muted-foreground">
                Loading inbox…
              </p>
            ) : null}
          </div>
        </section>
        {isReminders ? (
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
  onSelect,
}: {
  item: InboxItem;
  profile?: UserProfile;
  channel?: Channel;
  selected: boolean;
  unread: boolean;
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
          {item.category === "needs_action" ? "Needs Action" : "Mention"}
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
}: {
  item: InboxItem | null;
  profile?: UserProfile;
  channel?: Channel;
  onBack: () => void;
  mobileVisible: boolean;
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
          <h2 className="truncate font-semibold">
            {item.category === "needs_action" ? "Needs Action" : "Mention"}
          </h2>
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
