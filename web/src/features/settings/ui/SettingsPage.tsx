import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  Bot,
  BookMarked,
  Camera,
  LogOut,
  MessageSquare,
  MonitorCog,
  ShieldAlert,
  Smile,
  Ticket,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import { OwnerConnection } from "@/features/agents/ui/OwnerConnection";
import { lockOwnerVault } from "@/features/owner-vault/lib/vault-worker-client";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { ThemeToggle } from "@/shared/theme/ThemeToggle";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { CommunityMembersPanel } from "./CommunityMembersPanel";
import { CustomEmojiPanel } from "./CustomEmojiPanel";
import { ModerationPanel } from "./ModerationPanel";
import {
  getOwnerProfile,
  type ProfileInput,
  readNotificationSettings,
  updateOwnerProfile,
  uploadAvatar,
  writeNotificationSettings,
} from "../settings-api";

type Section =
  | "profile"
  | "notifications"
  | "appearance"
  | "community-members"
  | "custom-emoji"
  | "moderation";

export function SettingsPage() {
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(null);
  if (!ownerPubkey) return <OwnerConnection onConnected={setOwnerPubkey} />;
  return (
    <SettingsWorkspace
      ownerPubkey={ownerPubkey}
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
}: {
  ownerPubkey: string;
  onDisconnect: () => void;
}) {
  const [section, setSection] = useState<Section>("profile");
  return (
    <div className="flex min-h-dvh bg-background">
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
          <Nav href="/" icon={<BookMarked />} label="Repositories" />
          <Nav href="/channels" icon={<MessageSquare />} label="Channels" />
          <Nav href="/agents" icon={<Bot />} label="Agents" />
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
      <aside className="w-52 shrink-0 border-r p-3">
        <h1 className="px-2 py-3 text-lg font-semibold">Settings</h1>
        <SettingsNav active={section} onSelect={setSection} />
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-5 sm:p-8">
        <div className="mx-auto max-w-2xl">
          {section === "profile" ? (
            <ProfilePanel ownerPubkey={ownerPubkey} />
          ) : null}
          {section === "notifications" ? <NotificationsPanel /> : null}
          {section === "appearance" ? <AppearancePanel /> : null}
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
  active: Section;
  onSelect: (section: Section) => void;
}) {
  const rows: Array<[Section, string, React.ReactNode]> = [
    ["profile", "Profile", <UserRound key="profile" />],
    ["notifications", "Notifications", <Bell key="notifications" />],
    ["appearance", "Appearance", <MonitorCog key="appearance" />],
    ["community-members", "Invites", <Ticket key="community-members" />],
    ["moderation", "Moderation", <ShieldAlert key="moderation" />],
    ["custom-emoji", "Custom emoji", <Smile key="custom-emoji" />],
  ];
  return (
    <nav className="space-y-1">
      {rows.map(([value, label, icon]) => (
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
    </Panel>
  );
}

function NotificationsPanel() {
  const [settings, setSettings] = useState(readNotificationSettings);
  async function toggleEnabled(enabled: boolean) {
    if (enabled) {
      if (!("Notification" in window)) {
        toast.error("This browser does not support notifications.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Browser notification permission was not granted.");
        return;
      }
    }
    const next = { ...settings, enabled };
    setSettings(next);
    writeNotificationSettings(next);
  }
  return (
    <Panel
      title="Notifications"
      description="Choose when Buzz alerts you outside the active conversation."
    >
      <div className="divide-y rounded-md border">
        <ToggleRow
          checked={settings.enabled}
          label="Browser alerts"
          description="Show native notifications for new workspace messages."
          onChange={(value) => void toggleEnabled(value)}
        />
        <ToggleRow
          checked={settings.notifyWhileViewing}
          disabled={!settings.enabled}
          label="Notify while viewing"
          description="Alert even when the conversation is open."
          onChange={(value) => {
            const next = { ...settings, notifyWhileViewing: value };
            setSettings(next);
            writeNotificationSettings(next);
          }}
        />
        <ToggleRow
          checked={settings.sound}
          disabled={!settings.enabled}
          label="Sound"
          description="Allow the browser to play notification sounds."
          onChange={(value) => {
            const next = { ...settings, sound: value };
            setSettings(next);
            writeNotificationSettings(next);
          }}
        />
      </div>
    </Panel>
  );
}

function AppearancePanel() {
  return (
    <Panel
      title="Appearance"
      description="Match Buzz to your browser and working environment."
    >
      <div className="flex items-center justify-between rounded-md border p-4">
        <div>
          <p className="text-sm font-medium">Color theme</p>
          <p className="text-sm text-muted-foreground">
            Switch between light and dark appearance.
          </p>
        </div>
        <ThemeToggle />
      </div>
    </Panel>
  );
}
function ToggleRow({
  checked,
  disabled,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 p-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
      <input
        checked={checked}
        disabled={disabled}
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
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
function Nav({
  href,
  icon,
  label,
}: {
  href: "/" | "/channels" | "/agents" | "/settings";
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      className="flex items-center gap-2 rounded-md px-2 py-2 text-muted-foreground hover:bg-accent"
      to={href}
    >
      <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      {label}
    </Link>
  );
}
