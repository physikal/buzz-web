import { Link } from "@tanstack/react-router";
import {
  BookMarked,
  Bot,
  FolderKanban,
  GitFork,
  Inbox,
  LogOut,
  MessageSquare,
  Settings,
  Zap,
} from "lucide-react";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import { truncatePubkey } from "@/shared/lib/pubkey";

export function ChannelsPrimarySidebar({
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
        <SidebarLink href="/" icon={<Inbox />} label="Inbox" />
        <SidebarLink href="/repos" icon={<BookMarked />} label="Repositories" />
        <SidebarLink
          active
          href="/channels"
          icon={<MessageSquare />}
          label="Channels"
        />
        <SidebarLink href="/pulse" icon={<Zap />} label="Pulse" />
        <SidebarLink
          href="/projects"
          icon={<FolderKanban />}
          label="Projects"
        />
        <SidebarLink href="/workflows" icon={<GitFork />} label="Workflows" />
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
  href:
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
      className={`flex items-center gap-2 rounded-md px-2 py-2 ${active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent"}`}
      to={href}
    >
      <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      {label}
    </Link>
  );
}
