export type SettingsSection =
  | "profile"
  | "notifications"
  | "appearance"
  | "voice"
  | "shortcuts"
  | "experimental"
  | "agents"
  | "channel-templates"
  | "community-members"
  | "custom-emoji"
  | "moderation";

export const SETTINGS_SECTION_VALUES: readonly SettingsSection[] = [
  "profile",
  "notifications",
  "appearance",
  "voice",
  "shortcuts",
  "experimental",
  "agents",
  "channel-templates",
  "community-members",
  "moderation",
  "custom-emoji",
];

export function isSettingsSection(value: unknown): value is SettingsSection {
  return (
    typeof value === "string" &&
    (SETTINGS_SECTION_VALUES as readonly string[]).includes(value)
  );
}
