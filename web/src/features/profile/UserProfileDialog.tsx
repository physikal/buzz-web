import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Bot,
  ChevronRight,
  CircleAlert,
  Copy,
  Fingerprint,
  Logs,
  MessageCircle,
  Pencil,
  Play,
  Square,
  Terminal,
  UserMinus,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import type { ManagedAgent } from "@/features/agents/agent-api";
import type { AgentChannel } from "@/features/agents/agent-channels";
import { runtimeDisplayName } from "@/features/agents/runtime-catalog";
import { AgentLogPanel } from "@/features/agents/ui/AgentLogDialog";
import { AgentMemoryPanel } from "@/features/agents/ui/AgentMemoryDialog";
import type { UserProfile } from "@/features/channels/channel-api";
import type {
  PresenceStatus,
  UserStatus,
} from "@/features/presence/presence-api";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  PROFILE_PANEL_VIEW_TITLES,
  type ProfilePanelTab,
  type ProfilePanelView,
} from "./profile-panel-state";

export function PresenceDot({ status }: { status: PresenceStatus }) {
  return (
    <span
      aria-label={status}
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        status === "online"
          ? "bg-emerald-500"
          : status === "away"
            ? "bg-amber-500"
            : "bg-muted-foreground/35"
      }`}
      role="img"
    />
  );
}

export type UserProfileDialogProps = {
  pubkey: string | null;
  ownerPubkey: string;
  profile?: UserProfile;
  agentName?: string;
  presence?: PresenceStatus;
  userStatus?: UserStatus;
  onClose: () => void;
  onMessage: (pubkey: string) => void;
  onWave?: (pubkey: string) => void;
  wavePending?: boolean;
  following?: boolean;
  followPending?: boolean;
  onToggleFollow?: () => void;
  agentRunning?: boolean;
  agentActionPending?: boolean;
  onEditAgent?: () => void;
  onToggleAgentState?: () => void;
  managedAgent?: ManagedAgent;
  agentChannels?: AgentChannel[];
  agentChannelsLoading?: boolean;
  onAddToChannel?: () => void;
  onOpenActivity?: () => void;
  onOpenChannel?: (channelId: string) => void;
  tab?: ProfilePanelTab;
  view?: ProfilePanelView;
  onTabChange?: (tab: ProfilePanelTab) => void;
  onViewChange?: (view: ProfilePanelView) => void;
};

export function UserProfileDialog({
  pubkey,
  ownerPubkey,
  profile,
  agentName,
  presence = "offline",
  userStatus,
  onClose,
  onMessage,
  onWave,
  wavePending = false,
  following,
  followPending = false,
  onToggleFollow,
  agentRunning,
  agentActionPending = false,
  onEditAgent,
  onToggleAgentState,
  managedAgent,
  agentChannels = [],
  agentChannelsLoading = false,
  onAddToChannel,
  onOpenActivity,
  onOpenChannel,
  tab = "info",
  view = "summary",
  onTabChange,
  onViewChange,
}: UserProfileDialogProps) {
  useEscapeSurface(Boolean(pubkey), onClose);
  if (!pubkey) return null;
  const displayName =
    agentName ??
    profile?.displayName ??
    (pubkey === ownerPubkey ? "You" : truncatePubkey(pubkey));
  const effectiveView = managedAgent ? view : "summary";
  const joinedChannels = agentChannels.filter(
    (channel) => channel.alreadyMember,
  );

  return (
    <div
      aria-label={`${displayName} profile`}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="flex max-h-[90dvh] w-full max-w-md flex-col rounded-lg bg-background shadow-2xl">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
          {effectiveView !== "summary" ? (
            <Button
              aria-label="Back to profile"
              onClick={() => onViewChange?.("summary")}
              size="icon"
              variant="ghost"
            >
              <ArrowLeft />
            </Button>
          ) : null}
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
            {effectiveView === "summary"
              ? "Profile"
              : PROFILE_PANEL_VIEW_TITLES[effectiveView]}
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

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {effectiveView === "summary" ? (
            <ProfileSummary
              agentActionPending={agentActionPending}
              agentChannels={joinedChannels}
              agentChannelsLoading={agentChannelsLoading}
              agentName={agentName}
              agentRunning={agentRunning}
              displayName={displayName}
              following={following}
              followPending={followPending}
              managedAgent={managedAgent}
              onAddToChannel={onAddToChannel}
              onEditAgent={onEditAgent}
              onMessage={() => onMessage(pubkey)}
              onWave={onWave ? () => onWave(pubkey) : undefined}
              onOpenActivity={onOpenActivity}
              onOpenChannel={onOpenChannel}
              onTabChange={onTabChange}
              onToggleAgentState={onToggleAgentState}
              onToggleFollow={onToggleFollow}
              onViewChange={onViewChange}
              ownerPubkey={ownerPubkey}
              presence={presence}
              profile={profile}
              pubkey={pubkey}
              tab={tab}
              userStatus={userStatus}
              wavePending={wavePending}
            />
          ) : managedAgent ? (
            <FocusedAgentView
              agent={managedAgent}
              channels={joinedChannels}
              channelsLoading={agentChannelsLoading}
              onAddToChannel={onAddToChannel}
              onOpenActivity={onOpenActivity}
              onOpenChannel={onOpenChannel}
              ownerPubkey={ownerPubkey}
              profile={profile}
              pubkey={pubkey}
              view={effectiveView}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProfileSummary({
  agentActionPending,
  agentChannels,
  agentChannelsLoading,
  agentName,
  agentRunning,
  displayName,
  following,
  followPending,
  managedAgent,
  onAddToChannel,
  onEditAgent,
  onMessage,
  onWave,
  onOpenActivity,
  onOpenChannel,
  onTabChange,
  onToggleAgentState,
  onToggleFollow,
  onViewChange,
  ownerPubkey,
  presence,
  profile,
  pubkey,
  tab,
  userStatus,
  wavePending,
}: {
  agentActionPending: boolean;
  agentChannels: AgentChannel[];
  agentChannelsLoading: boolean;
  agentName?: string;
  agentRunning?: boolean;
  displayName: string;
  following?: boolean;
  followPending: boolean;
  managedAgent?: ManagedAgent;
  onAddToChannel?: () => void;
  onEditAgent?: () => void;
  onMessage: () => void;
  onWave?: () => void;
  onOpenActivity?: () => void;
  onOpenChannel?: (channelId: string) => void;
  onTabChange?: (tab: ProfilePanelTab) => void;
  onToggleAgentState?: () => void;
  onToggleFollow?: () => void;
  onViewChange?: (view: ProfilePanelView) => void;
  ownerPubkey: string;
  presence: PresenceStatus;
  profile?: UserProfile;
  pubkey: string;
  tab: ProfilePanelTab;
  userStatus?: UserStatus;
  wavePending: boolean;
}) {
  return (
    <div className="space-y-5">
      <ProfileHero
        agentName={agentName}
        displayName={displayName}
        presence={presence}
        profile={profile}
        userStatus={userStatus}
      />

      {pubkey !== ownerPubkey ? (
        <div className="grid grid-cols-2 gap-2">
          {onToggleFollow ? (
            <Button
              disabled={followPending}
              onClick={onToggleFollow}
              variant="outline"
            >
              {following ? <UserMinus /> : <UserPlus />}
              {following ? "Unfollow" : "Follow"}
            </Button>
          ) : null}
          <Button
            className={onToggleFollow ? undefined : "col-span-2"}
            onClick={onMessage}
          >
            <MessageCircle />
            Message
          </Button>
          {!agentName && onWave ? (
            <Button
              aria-label="Wave"
              className="buzz-wave-hover-trigger"
              disabled={wavePending}
              onClick={onWave}
              variant="outline"
            >
              <span aria-hidden="true" className="buzz-wave-hand text-sm">
                👋
              </span>
              {wavePending ? "Sending..." : "Wave"}
            </Button>
          ) : null}
          {onEditAgent ? (
            <Button onClick={onEditAgent} variant="outline">
              <Pencil />
              Edit
            </Button>
          ) : null}
          {onToggleAgentState ? (
            <Button
              disabled={agentActionPending}
              onClick={onToggleAgentState}
              variant="outline"
            >
              {agentRunning ? <Square /> : <Play />}
              {agentRunning ? "Stop" : "Start"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {managedAgent ? (
        <>
          <ProfileTabs activeTab={tab} onTabChange={onTabChange} />
          {tab === "info" ? (
            <AgentInfoSection
              agent={managedAgent}
              onOpenActivity={onOpenActivity}
              ownerPubkey={ownerPubkey}
              profile={profile}
              pubkey={pubkey}
            />
          ) : null}
          {tab === "runtime" ? (
            <AgentRuntimeSection
              agent={managedAgent}
              onOpenInstructions={() => onViewChange?.("instructions")}
              onOpenLogs={() => onViewChange?.("diagnostics")}
            />
          ) : null}
          {tab === "channels" ? (
            <AgentChannelsSection
              channels={agentChannels}
              isLoading={agentChannelsLoading}
              onAddToChannel={onAddToChannel}
              onOpenChannel={onOpenChannel}
            />
          ) : null}
          {tab === "memories" ? (
            <AgentMemoryPanel
              agentPubkey={managedAgent.agent_pubkey}
              ownerPubkey={ownerPubkey}
            />
          ) : null}
        </>
      ) : (
        <AgentInfoSection
          onOpenActivity={onOpenActivity}
          ownerPubkey={ownerPubkey}
          profile={profile}
          pubkey={pubkey}
        />
      )}
    </div>
  );
}

function ProfileHero({
  agentName,
  displayName,
  presence,
  profile,
  userStatus,
}: {
  agentName?: string;
  displayName: string;
  presence: PresenceStatus;
  profile?: UserProfile;
  userStatus?: UserStatus;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative shrink-0">
        {profile?.avatarUrl ? (
          <img
            alt=""
            className="h-20 w-20 rounded-md object-cover"
            src={profile.avatarUrl}
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-md bg-muted text-xl font-semibold">
            {displayName.slice(0, 2).toUpperCase()}
          </div>
        )}
        <span className="absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-background">
          <PresenceDot status={presence} />
        </span>
      </div>
      <div className="mt-3 flex items-center justify-center gap-2">
        <h3 className="text-xl font-semibold">{displayName}</h3>
        {agentName ? (
          <Bot aria-label="Agent" className="h-4 w-4 text-muted-foreground" />
        ) : null}
      </div>
      {profile?.about ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
          {profile.about}
        </p>
      ) : null}
      {profile?.nip05Handle ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {profile.nip05Handle}
        </p>
      ) : null}
      {userStatus ? (
        <p className="mt-2 break-words text-sm">
          {userStatus.emoji ? `${userStatus.emoji} ` : ""}
          {userStatus.text}
        </p>
      ) : null}
    </div>
  );
}

function ProfileTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: ProfilePanelTab;
  onTabChange?: (tab: ProfilePanelTab) => void;
}) {
  const tabs: Array<{ id: ProfilePanelTab; label: string }> = [
    { id: "info", label: "Info" },
    { id: "runtime", label: "Runtime" },
    { id: "channels", label: "Channels" },
    { id: "memories", label: "Memories" },
  ];
  return (
    <div
      aria-label="Profile sections"
      className="grid grid-cols-4 gap-1"
      role="tablist"
    >
      {tabs.map((item) => (
        <Button
          aria-selected={activeTab === item.id}
          className="px-2"
          key={item.id}
          onClick={() => onTabChange?.(item.id)}
          role="tab"
          size="sm"
          variant={activeTab === item.id ? "secondary" : "ghost"}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}

function AgentInfoSection({
  agent,
  onOpenActivity,
  ownerPubkey,
  profile,
  pubkey,
}: {
  agent?: ManagedAgent;
  onOpenActivity?: () => void;
  ownerPubkey: string;
  profile?: UserProfile;
  pubkey: string;
}) {
  return (
    <div className="space-y-2">
      {agent && onOpenActivity ? (
        <IngressRow
          icon={<Activity />}
          label="Activity log"
          onClick={onOpenActivity}
          trailing="View"
        />
      ) : null}
      <CopyField icon={<Fingerprint />} label="Public key" value={pubkey} />
      {agent ? (
        <CopyField
          icon={<UserRound />}
          label="Managed by"
          value={
            agent.owner_pubkey === ownerPubkey ? "You" : agent.owner_pubkey
          }
        />
      ) : null}
      {profile?.nip05Handle ? (
        <CopyField
          icon={<UserRound />}
          label="NIP-05"
          value={profile.nip05Handle}
        />
      ) : null}
    </div>
  );
}

function AgentRuntimeSection({
  agent,
  onOpenInstructions,
  onOpenLogs,
}: {
  agent: ManagedAgent;
  onOpenInstructions?: () => void;
  onOpenLogs?: () => void;
}) {
  return (
    <div className="space-y-2">
      {onOpenInstructions ? (
        <IngressRow
          icon={<Bot />}
          label="Instructions"
          onClick={onOpenInstructions}
          trailing={agent.system_prompt.trim() ? "View" : "Empty"}
        />
      ) : null}
      <DetailField label="Status">
        <Badge
          variant={
            agent.observed_state === "error" ? "destructive" : "secondary"
          }
        >
          {agent.observed_state.replace(/_/g, " ")}
        </Badge>
      </DetailField>
      {onOpenLogs ? (
        <IngressRow
          icon={<Logs />}
          label="Harness Log"
          onClick={onOpenLogs}
          trailing={agent.last_error ? "Error" : "View"}
        />
      ) : null}
      <DetailField label="Runtime" value={runtimeDisplayName(agent.runtime)} />
      {agent.model ? <DetailField label="Model" value={agent.model} /> : null}
      {agent.provider ? (
        <DetailField label="Provider" value={agent.provider} />
      ) : null}
      <DetailField
        label="Authentication"
        value={
          agent.credential_mode === "subscription" ? "Subscription" : "API key"
        }
      />
      <DetailField label="Parallelism" value={String(agent.parallelism)} />
      <DetailField
        label="Who can send instructions"
        value={respondToLabel(agent)}
      />
    </div>
  );
}

function AgentChannelsSection({
  channels,
  isLoading,
  onAddToChannel,
  onOpenChannel,
}: {
  channels: AgentChannel[];
  isLoading: boolean;
  onAddToChannel?: () => void;
  onOpenChannel?: (channelId: string) => void;
}) {
  return (
    <div className="space-y-2">
      {onAddToChannel ? (
        <IngressRow
          icon={<UserPlus />}
          label="Add to channel"
          onClick={onAddToChannel}
        />
      ) : null}
      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Loading channels…
        </p>
      ) : channels.length ? (
        <div className="overflow-hidden rounded-md border">
          {channels.map((channel) => (
            <button
              className="flex w-full items-center gap-3 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted"
              key={channel.id}
              onClick={() => onOpenChannel?.(channel.id)}
              type="button"
            >
              <span className="min-w-0 flex-1 truncate">#{channel.name}</span>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      ) : (
        <div className="py-7 text-center">
          <p className="text-sm font-medium">Add this agent to a channel</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a channel above so it can join the conversation.
          </p>
        </div>
      )}
    </div>
  );
}

function FocusedAgentView({
  agent,
  channels,
  channelsLoading,
  onAddToChannel,
  onOpenActivity,
  onOpenChannel,
  ownerPubkey,
  profile,
  pubkey,
  view,
}: {
  agent: ManagedAgent;
  channels: AgentChannel[];
  channelsLoading: boolean;
  onAddToChannel?: () => void;
  onOpenActivity?: () => void;
  onOpenChannel?: (channelId: string) => void;
  ownerPubkey: string;
  profile?: UserProfile;
  pubkey: string;
  view: Exclude<ProfilePanelView, "summary">;
}) {
  if (view === "instructions") {
    return (
      <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-4 font-sans text-sm leading-6">
        {agent.system_prompt || "No instructions configured."}
      </pre>
    );
  }
  if (view === "diagnostics" || view === "logs") {
    return (
      <div className="space-y-3">
        {agent.last_error ? (
          <div className="flex gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Last error</p>
              <p className="mt-1 break-words">{agent.last_error}</p>
            </div>
          </div>
        ) : null}
        <AgentLogPanel agent={agent} />
      </div>
    );
  }
  if (view === "memories") {
    return (
      <AgentMemoryPanel
        agentPubkey={agent.agent_pubkey}
        ownerPubkey={ownerPubkey}
      />
    );
  }
  if (view === "channels") {
    return (
      <AgentChannelsSection
        channels={channels}
        isLoading={channelsLoading}
        onAddToChannel={onAddToChannel}
        onOpenChannel={onOpenChannel}
      />
    );
  }
  if (view === "configuration") {
    return <AgentRuntimeSection agent={agent} />;
  }
  return (
    <AgentInfoSection
      agent={agent}
      onOpenActivity={onOpenActivity}
      ownerPubkey={ownerPubkey}
      profile={profile}
      pubkey={pubkey}
    />
  );
}

function IngressRow({
  icon,
  label,
  onClick,
  trailing,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  trailing?: string;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 rounded-md border p-3 text-left hover:bg-muted"
      onClick={onClick}
      type="button"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
      {trailing ? (
        <span className="text-xs text-muted-foreground">{trailing}</span>
      ) : null}
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

function CopyField({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 rounded-md border p-3 text-left hover:bg-muted"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        toast.success(`${label} copied`);
      }}
      type="button"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium">{label}</span>
        <span className="block truncate font-mono text-xs text-muted-foreground">
          {value}
        </span>
      </span>
      <Copy className="h-4 w-4 shrink-0" />
    </button>
  );
}

function DetailField({
  children,
  label,
  value,
}: {
  children?: ReactNode;
  label: string;
  value?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Terminal className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium">{label}</span>
        {value ? (
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">
            {value}
          </span>
        ) : null}
      </span>
      {children}
    </div>
  );
}

function respondToLabel(agent: ManagedAgent): string {
  if (agent.respond_to === "owner-only") return "Only the owner";
  if (agent.respond_to === "allowlist") return "Selected people";
  return "Anyone";
}
