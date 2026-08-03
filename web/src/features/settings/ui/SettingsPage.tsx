import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Bell,
  Bot,
  Camera,
  CalendarClock,
  FileStack,
  Keyboard,
  MonitorCog,
  ShieldAlert,
  Smile,
  Ticket,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { OwnerConnection } from "@/features/agents/ui/OwnerConnection";
import { ChannelTemplatesPanel } from "@/features/channel-templates/ui/ChannelTemplatesPanel";
import { AppPrimarySidebar } from "@/features/navigation/AppPrimarySidebar";
import { lockOwnerVault } from "@/features/owner-vault/lib/vault-worker-client";
import { OwnerBackupPanel } from "@/features/owner-vault/ui/OwnerBackupPanel";
import { OwnerPasskeysPanel } from "@/features/owner-vault/ui/OwnerPasskeysPanel";
import { RemindersPanel } from "@/features/reminders/ui/RemindersPanel";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { CommunityMembersPanel } from "./CommunityMembersPanel";
import { AgentDefaultsPanel } from "./AgentDefaultsPanel";
import { AgentRuntimesPanel } from "./AgentRuntimesPanel";
import { CustomEmojiPanel } from "./CustomEmojiPanel";
import { KeyboardShortcutsPanel } from "./KeyboardShortcutsPanel";
import { ModerationPanel } from "./ModerationPanel";
import { AppearancePanel } from "./AppearancePanel";
import { NotificationsPanel } from "./NotificationsPanel";
import type { SettingsSection } from "../settings-sections";
import {
  getOwnerProfile,
  getUserStatus,
  type ProfileInput,
  updateOwnerProfile,
  setUserStatus,
  uploadAvatar,
} from "../settings-api";

const SETTINGS_ROWS: Array<[SettingsSection, string, React.ReactNode]> = [
  ["profile", "Profile", <UserRound key="profile" />],
  ["notifications", "Notifications", <Bell key="notifications" />],
  ["appearance", "Appearance", <MonitorCog key="appearance" />],
  ["shortcuts", "Shortcuts", <Keyboard key="shortcuts" />],
  ["agents", "Agents", <Bot key="agents" />],
  ["channel-templates", "Templates", <FileStack key="templates" />],
  ["reminders", "Reminders", <CalendarClock key="reminders" />],
  ["community-members", "Invites", <Ticket key="community-members" />],
  ["moderation", "Moderation", <ShieldAlert key="moderation" />],
  ["custom-emoji", "Custom emoji", <Smile key="custom-emoji" />],
];

export function SettingsPage({
  initialSection = "profile",
  onSectionChange,
}: {
  initialSection?: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
} = {}) {
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(null);
  if (!ownerPubkey) return <OwnerConnection onConnected={setOwnerPubkey} />;
  return (
    <SettingsWorkspace
      ownerPubkey={ownerPubkey}
      initialSection={initialSection}
      onSectionChange={onSectionChange}
      onDisconnect={() => {
        void lockOwnerVault();
        setOwnerPubkey(null);
      }}
    />
  );
}

function SettingsWorkspace({
  ownerPubkey,
  onDisconnect,
  initialSection,
  onSectionChange,
}: {
  ownerPubkey: string;
  onDisconnect: () => void;
  initialSection: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
}) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  useEffect(() => setSection(initialSection), [initialSection]);
  function selectSection(next: SettingsSection) {
    setSection(next);
    onSectionChange?.(next);
  }
  return (
    <div className="flex min-h-dvh bg-background">
      <AppPrimarySidebar
        active="settings"
        onDisconnect={onDisconnect}
        ownerPubkey={ownerPubkey}
        visibleFrom="lg"
      />
      <aside className="hidden w-52 shrink-0 border-r p-3 md:block">
        <h1 className="px-2 py-3 text-lg font-semibold">Settings</h1>
        <SettingsNav active={section} onSelect={selectSection} />
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mb-6 md:hidden">
          <div className="mb-3 flex items-center gap-2">
            <Button
              asChild
              aria-label="Back to Buzz"
              size="icon"
              variant="ghost"
            >
              <Link to="/channels">
                <ArrowLeft />
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">Settings</h1>
          </div>
          <label
            className="block text-sm font-medium"
            htmlFor="settings-section"
          >
            Section
          </label>
          <select
            aria-label="Settings section"
            className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
            id="settings-section"
            onChange={(event) =>
              selectSection(event.target.value as SettingsSection)
            }
            value={section}
          >
            {SETTINGS_ROWS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="mx-auto max-w-2xl">
          {section === "profile" ? (
            <ProfilePanel ownerPubkey={ownerPubkey} />
          ) : null}
          {section === "notifications" ? (
            <NotificationsPanel ownerPubkey={ownerPubkey} />
          ) : null}
          {section === "appearance" ? <AppearancePanel /> : null}
          {section === "shortcuts" ? <KeyboardShortcutsPanel /> : null}
          {section === "agents" ? (
            <div className="space-y-12">
              <AgentRuntimesPanel />
              <AgentDefaultsPanel ownerPubkey={ownerPubkey} />
            </div>
          ) : null}
          {section === "channel-templates" ? (
            <ChannelTemplatesPanel ownerPubkey={ownerPubkey} />
          ) : null}
          {section === "reminders" ? (
            <RemindersPanel ownerPubkey={ownerPubkey} />
          ) : null}
          {section === "community-members" ? (
            <CommunityMembersPanel ownerPubkey={ownerPubkey} />
          ) : null}
          {section === "custom-emoji" ? (
            <CustomEmojiPanel ownerPubkey={ownerPubkey} />
          ) : null}
          {section === "moderation" ? (
            <ModerationPanel ownerPubkey={ownerPubkey} />
          ) : null}
        </div>
      </main>
    </div>
  );
}

function SettingsNav({
  active,
  onSelect,
}: {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}) {
  return (
    <nav className="space-y-1">
      {SETTINGS_ROWS.map(([value, label, icon]) => (
        <button
          className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm ${active === value ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent"}`}
          key={value}
          onClick={() => onSelect(value)}
          type="button"
        >
          <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>
          {label}
        </button>
      ))}
    </nav>
  );
}

function ProfilePanel({ ownerPubkey }: { ownerPubkey: string }) {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: ["owner-profile", ownerPubkey],
    queryFn: () => getOwnerProfile(ownerPubkey),
  });
  if (profileQuery.isLoading)
    return (
      <Panel title="Profile" description="Your workspace identity.">
        <p className="text-sm text-muted-foreground">Loading profile…</p>
      </Panel>
    );
  return (
    <ProfileForm
      key={JSON.stringify(profileQuery.data)}
      initial={
        profileQuery.data ?? { displayName: "", about: "", avatarUrl: "" }
      }
      ownerPubkey={ownerPubkey}
      onSaved={() =>
        queryClient.invalidateQueries({
          queryKey: ["owner-profile", ownerPubkey],
        })
      }
    />
  );
}

function ProfileForm({
  initial,
  ownerPubkey,
  onSaved,
}: {
  initial: ProfileInput;
  ownerPubkey: string;
  onSaved: () => Promise<unknown>;
}) {
  const [profile, setProfile] = useState(initial);
  const update = useMutation({
    mutationFn: updateOwnerProfile,
    onSuccess: async () => {
      await onSaved();
      toast.success("Profile updated");
    },
    onError: (error) =>
      toast.error("Could not update profile", { description: error.message }),
  });
  const avatar = useMutation({
    mutationFn: uploadAvatar,
    onSuccess: (url) =>
      setProfile((current) => ({ ...current, avatarUrl: url })),
    onError: (error) =>
      toast.error("Could not upload avatar", { description: error.message }),
  });
  return (
    <Panel
      title="Profile"
      description="Your name and avatar are visible to workspace members."
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate(profile);
        }}
      >
        <div className="flex items-center gap-4">
          {profile.avatarUrl ? (
            <img
              alt="Profile avatar"
              className="h-20 w-20 rounded-md object-cover"
              src={profile.avatarUrl}
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-md bg-muted text-2xl font-semibold">
              {profile.displayName[0]?.toUpperCase() ?? "B"}
            </div>
          )}
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium">
            <Camera className="h-4 w-4" />
            Change avatar
            <input
              accept="image/*"
              className="hidden"
              disabled={avatar.isPending}
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) avatar.mutate(file);
              }}
            />
          </label>
        </div>
        <label className="block text-sm font-medium" htmlFor="profile-name">
          Display name
          <Input
            className="mt-2"
            id="profile-name"
            value={profile.displayName}
            onChange={(event) =>
              setProfile((current) => ({
                ...current,
                displayName: event.target.value,
              }))
            }
          />
        </label>
        <label className="block text-sm font-medium" htmlFor="profile-about">
          About
          <textarea
            className="mt-2 min-h-28 w-full rounded-md border bg-background p-3 text-sm"
            id="profile-about"
            value={profile.about}
            onChange={(event) =>
              setProfile((current) => ({
                ...current,
                about: event.target.value,
              }))
            }
          />
        </label>
        <UserStatusPanel ownerPubkey={ownerPubkey} />
        <div className="rounded-md border p-3">
          <p className="text-sm font-medium">Public key</p>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {ownerPubkey}
          </p>
        </div>
        <Button
          disabled={update.isPending || !profile.displayName.trim()}
          type="submit"
        >
          {update.isPending ? "Saving…" : "Save profile"}
        </Button>
      </form>
      <OwnerPasskeysPanel />
      <OwnerBackupPanel ownerPubkey={ownerPubkey} />
    </Panel>
  );
}

function UserStatusPanel({ ownerPubkey }: { ownerPubkey: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["user-status", ownerPubkey],
    queryFn: () => getUserStatus(ownerPubkey),
  });
  if (query.isLoading)
    return <p className="text-sm text-muted-foreground">Loading status…</p>;
  return (
    <UserStatusEditor
      key={`${query.data?.updatedAt ?? 0}:${query.data?.text ?? ""}:${query.data?.emoji ?? ""}`}
      emoji={query.data?.emoji ?? ""}
      text={query.data?.text ?? ""}
      onSaved={() =>
        queryClient.invalidateQueries({
          queryKey: ["user-status", ownerPubkey],
        })
      }
    />
  );
}

function UserStatusEditor({
  text: initialText,
  emoji: initialEmoji,
  onSaved,
}: {
  text: string;
  emoji: string;
  onSaved: () => Promise<unknown>;
}) {
  const [text, setText] = useState(initialText);
  const [emoji, setEmoji] = useState(initialEmoji);
  const mutation = useMutation({
    mutationFn: ({ text, emoji }: { text: string; emoji: string }) =>
      setUserStatus(text, emoji),
    onSuccess: async (_, input) => {
      await onSaved();
      toast.success(
        input.text || input.emoji ? "Status updated" : "Status cleared",
      );
    },
    onError: (error) =>
      toast.error("Could not update status", { description: error.message }),
  });
  return (
    <div className="rounded-md border p-4">
      <div>
        <p className="text-sm font-medium">Custom status</p>
        <p className="text-sm text-muted-foreground">
          Shown beside your profile across Buzz clients.
        </p>
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          aria-label="Status emoji"
          className="w-16 shrink-0 text-center"
          maxLength={64}
          placeholder="🙂"
          value={emoji}
          onChange={(event) => setEmoji(event.target.value)}
        />
        <Input
          aria-label="Status text"
          maxLength={160}
          placeholder="What are you working on?"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          disabled={mutation.isPending || (!text.trim() && !emoji.trim())}
          onClick={() => mutation.mutate({ text, emoji })}
          size="sm"
          type="button"
          variant="outline"
        >
          {mutation.isPending ? "Saving…" : "Set status"}
        </Button>
        {initialText || initialEmoji ? (
          <Button
            disabled={mutation.isPending}
            onClick={() => {
              setText("");
              setEmoji("");
              mutation.mutate({ text: "", emoji: "" });
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-6">
        <h2 className="text-2xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}
