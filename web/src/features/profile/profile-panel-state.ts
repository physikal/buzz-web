export type ProfilePanelTab = "info" | "runtime" | "channels" | "memories";

export type ProfilePanelView =
  | "summary"
  | "instructions"
  | "info"
  | "configuration"
  | "diagnostics"
  | "memories"
  | "channels"
  | "logs";

const PROFILE_PANEL_TABS = new Set<ProfilePanelTab>([
  "info",
  "runtime",
  "channels",
  "memories",
]);

const PROFILE_PANEL_VIEWS = new Set<ProfilePanelView>([
  "summary",
  "instructions",
  "info",
  "configuration",
  "diagnostics",
  "memories",
  "channels",
  "logs",
]);

const LEGACY_VIEW_ALIASES: Record<string, ProfilePanelView> = {
  model: "configuration",
  settings: "configuration",
};

export const PROFILE_PANEL_VIEW_TITLES: Record<ProfilePanelView, string> = {
  summary: "Profile",
  instructions: "Instructions",
  info: "Agent info",
  configuration: "Runtime",
  diagnostics: "Harness Log",
  memories: "Memories",
  channels: "Channels",
  logs: "Harness Log",
};

export function parseProfilePanelTab(
  value: unknown,
): ProfilePanelTab | undefined {
  return typeof value === "string" &&
    PROFILE_PANEL_TABS.has(value as ProfilePanelTab)
    ? (value as ProfilePanelTab)
    : undefined;
}

export function parseProfilePanelView(
  value: unknown,
): ProfilePanelView | undefined {
  if (typeof value !== "string") return undefined;
  if (PROFILE_PANEL_VIEWS.has(value as ProfilePanelView)) {
    return value as ProfilePanelView;
  }
  return LEGACY_VIEW_ALIASES[value];
}
