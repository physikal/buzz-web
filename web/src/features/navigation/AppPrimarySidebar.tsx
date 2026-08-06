import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BookMarked,
  Bot,
  FolderKanban,
  GitFork,
  Inbox,
  MessageSquare,
  Settings,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import { ReadStateManager } from "@/features/channels/read-state";
import {
  listInboxItems,
  subscribeInbox,
  type InboxItem,
} from "@/features/home/home-api";
import { listReminders } from "@/features/reminders/reminder-api";
import { readNotificationSettings } from "@/features/settings/notification-settings";
import { FeatureGate } from "@/shared/features";
import { SidebarOwnerProfileMenu } from "./SidebarOwnerProfileMenu";

export type AppSection =
  | "inbox"
  | "repos"
  | "channels"
  | "pulse"
  | "projects"
  | "workflows"
  | "agents"
  | "settings";

export function AppPrimarySidebar({
  active,
  badgeCount,
  onDisconnect,
  ownerPubkey,
  visibleFrom = "sm",
}: {
  active: AppSection;
  badgeCount?: number;
  onDisconnect: () => void;
  ownerPubkey: string;
  visibleFrom?: "sm" | "md" | "lg";
}) {
  const queriedBadgeCount = useInboxBadge(
    ownerPubkey,
    badgeCount === undefined,
  );
  const inboxBadge = badgeCount ?? queriedBadgeCount;
  const visibility =
    visibleFrom === "lg"
      ? "hidden lg:flex"
      : visibleFrom === "md"
        ? "hidden md:flex"
        : "hidden sm:flex";
  return (
    <aside
      aria-label="App navigation"
      className={`${visibility} w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-3`}
    >
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
        <PrimaryLink
          active={active === "inbox"}
          badge={inboxBadge}
          icon={<Inbox />}
          label="Inbox"
          to="/"
        />
        <PrimaryLink
          active={active === "repos"}
          icon={<BookMarked />}
          label="Repositories"
          to="/repos"
        />
        <PrimaryLink
          active={active === "channels"}
          icon={<MessageSquare />}
          label="Channels"
          to="/channels"
        />
        <FeatureGate feature="pulse">
          <PrimaryLink
            active={active === "pulse"}
            icon={<Zap />}
            label="Pulse"
            to="/pulse"
          />
        </FeatureGate>
        <FeatureGate feature="projects">
          <PrimaryLink
            active={active === "projects"}
            icon={<FolderKanban />}
            label="Projects"
            to="/projects"
          />
        </FeatureGate>
        <FeatureGate feature="workflows">
          <PrimaryLink
            active={active === "workflows"}
            icon={<GitFork />}
            label="Workflows"
            to="/workflows"
          />
        </FeatureGate>
        <PrimaryLink
          active={active === "agents"}
          icon={<Bot />}
          label="Agents"
          to="/agents"
        />
        <PrimaryLink
          active={active === "settings"}
          icon={<Settings />}
          label="Settings"
          to="/settings"
        />
      </nav>
      <div className="mt-auto border-t border-sidebar-border pt-3">
        <SidebarOwnerProfileMenu
          onLock={onDisconnect}
          ownerPubkey={ownerPubkey}
        />
      </div>
    </aside>
  );
}

function PrimaryLink({
  active,
  badge = 0,
  icon,
  label,
  to,
}: {
  active: boolean;
  badge?: number;
  icon: React.ReactNode;
  label: string;
  to:
    | "/"
    | "/repos"
    | "/channels"
    | "/pulse"
    | "/projects"
    | "/workflows"
    | "/agents"
    | "/settings";
}) {
  return (
    <Link
      className={`flex items-center gap-2 rounded-md px-2 py-2 ${active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent"}`}
      to={to}
    >
      <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      <span>{label}</span>
      {badge > 0 ? (
        <span
          aria-label={`${badge} unread Inbox items`}
          className="ml-auto min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-xs font-semibold text-primary-foreground"
          role="status"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}

function useInboxBadge(ownerPubkey: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState(() =>
    readNotificationSettings(ownerPubkey),
  );
  const [readMarkers, setReadMarkers] = useState<Record<string, number>>({});
  const shouldLoad = enabled && settings.homeBadgeEnabled;
  const inboxQuery = useQuery({
    enabled: shouldLoad,
    queryKey: ["primary-inbox-badge", ownerPubkey],
    queryFn: () => listInboxItems(ownerPubkey),
    refetchInterval: 30_000,
    retry: false,
  });
  const remindersQuery = useQuery({
    enabled: shouldLoad,
    queryKey: ["reminders", ownerPubkey],
    queryFn: () => listReminders(ownerPubkey),
    refetchInterval: 30_000,
    retry: false,
  });

  useEffect(() => {
    const update = () => setSettings(readNotificationSettings(ownerPubkey));
    window.addEventListener("buzz-web:notification-settings", update);
    return () =>
      window.removeEventListener("buzz-web:notification-settings", update);
  }, [ownerPubkey]);

  useEffect(() => {
    if (!shouldLoad) {
      setReadMarkers({});
      return;
    }
    const manager = new ReadStateManager(ownerPubkey);
    const sync = () => setReadMarkers(manager.snapshot());
    const unsubscribe = manager.subscribe(sync);
    sync();
    void manager.initialize();
    return () => {
      unsubscribe();
      manager.destroy();
    };
  }, [ownerPubkey, shouldLoad]);

  useEffect(() => {
    if (!shouldLoad) return;
    return subscribeInbox(ownerPubkey, [], (item) => {
      queryClient.setQueryData<InboxItem[]>(
        ["primary-inbox-badge", ownerPubkey],
        (current = []) =>
          [item, ...current.filter((candidate) => candidate.id !== item.id)]
            .sort((left, right) => right.createdAt - left.createdAt)
            .slice(0, 120),
      );
    });
  }, [ownerPubkey, queryClient, shouldLoad]);

  return useMemo(() => {
    if (!shouldLoad) return 0;
    const unreadInbox = (inboxQuery.data ?? []).filter(
      (item) => (readMarkers[`msg:${item.id}`] ?? 0) < item.createdAt,
    ).length;
    const now = Math.floor(Date.now() / 1000);
    const dueReminders = (remindersQuery.data ?? []).filter(
      (reminder) =>
        reminder.content.status === "pending" &&
        reminder.notBefore !== undefined &&
        reminder.notBefore <= now,
    ).length;
    return unreadInbox + dueReminders;
  }, [inboxQuery.data, readMarkers, remindersQuery.data, shouldLoad]);
}
