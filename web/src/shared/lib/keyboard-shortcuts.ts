export type ShortcutCategory =
  | "Navigation"
  | "Messages"
  | "Formatting"
  | "Zoom";

export type KeyboardShortcut = {
  id: string;
  label: string;
  description: string;
  keys: string;
  keysWindows: string;
  category: ShortcutCategory;
};

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  {
    id: "quick-search",
    label: "Quick search",
    description: "Open the search dialog",
    keys: "⌘K",
    keysWindows: "Ctrl+K",
    category: "Navigation",
  },
  {
    id: "browse-channels",
    label: "Browse channels",
    description: "Open the channel browser",
    keys: "⇧⌘O",
    keysWindows: "Shift+Ctrl+O",
    category: "Navigation",
  },
  {
    id: "browse-dms",
    label: "New direct message",
    description: "Open the new message composer",
    keys: "⇧⌘K",
    keysWindows: "Shift+Ctrl+K",
    category: "Navigation",
  },
  {
    id: "new-channel",
    label: "New channel",
    description: "Open the create channel dialog",
    keys: "⇧⌘N",
    keysWindows: "Shift+Ctrl+N",
    category: "Navigation",
  },
  {
    id: "open-settings",
    label: "Settings",
    description: "Open settings",
    keys: "⌘,",
    keysWindows: "Ctrl+,",
    category: "Navigation",
  },
  {
    id: "go-back",
    label: "Go back",
    description: "Navigate to the previous page",
    keys: "⌘[",
    keysWindows: "Alt+←",
    category: "Navigation",
  },
  {
    id: "go-forward",
    label: "Go forward",
    description: "Navigate to the next page",
    keys: "⌘]",
    keysWindows: "Alt+→",
    category: "Navigation",
  },
  {
    id: "find-in-channel",
    label: "Find in channel",
    description: "Search messages in current channel",
    keys: "⌘F",
    keysWindows: "Ctrl+F",
    category: "Navigation",
  },
  {
    id: "go-home",
    label: "Home",
    description: "Navigate to the home feed",
    keys: "⇧⌘A",
    keysWindows: "Shift+Ctrl+A",
    category: "Navigation",
  },
  {
    id: "send-message",
    label: "Send message",
    description: "Send the current message",
    keys: "Enter",
    keysWindows: "Enter",
    category: "Messages",
  },
  {
    id: "new-line",
    label: "New line",
    description: "Insert a line break in the composer",
    keys: "Shift+Enter",
    keysWindows: "Shift+Enter",
    category: "Messages",
  },
  {
    id: "publish-note",
    label: "Publish note",
    description: "Publish a Pulse note",
    keys: "⌘Enter",
    keysWindows: "Ctrl+Enter",
    category: "Messages",
  },
  {
    id: "push-to-talk",
    label: "Push to talk",
    description: "Hold to unmute in a huddle",
    keys: "Ctrl+Space",
    keysWindows: "Ctrl+Space",
    category: "Messages",
  },
  {
    id: "mark-current-read",
    label: "Mark as read",
    description: "Mark the current conversation as read",
    keys: "Escape",
    keysWindows: "Escape",
    category: "Navigation",
  },
  {
    id: "mark-all-read",
    label: "Mark all as read",
    description: "Mark all conversations as read",
    keys: "⇧Escape",
    keysWindows: "Shift+Esc",
    category: "Navigation",
  },
  {
    id: "format-bold",
    label: "Bold",
    description: "Toggle bold formatting",
    keys: "⌘B",
    keysWindows: "Ctrl+B",
    category: "Formatting",
  },
  {
    id: "format-italic",
    label: "Italic",
    description: "Toggle italic formatting",
    keys: "⌘I",
    keysWindows: "Ctrl+I",
    category: "Formatting",
  },
  {
    id: "format-strikethrough",
    label: "Strikethrough",
    description: "Toggle strikethrough formatting",
    keys: "⌘⇧X",
    keysWindows: "Ctrl+Shift+X",
    category: "Formatting",
  },
  {
    id: "format-code",
    label: "Inline code",
    description: "Toggle inline code formatting",
    keys: "⌘E",
    keysWindows: "Ctrl+E",
    category: "Formatting",
  },
  {
    id: "format-link",
    label: "Insert link",
    description: "Link selected composer text",
    keys: "⌘K",
    keysWindows: "Ctrl+K",
    category: "Formatting",
  },
  {
    id: "zoom-in",
    label: "Zoom in",
    description: "Increase the browser zoom level",
    keys: "⌘+",
    keysWindows: "Ctrl+=",
    category: "Zoom",
  },
  {
    id: "zoom-out",
    label: "Zoom out",
    description: "Decrease the browser zoom level",
    keys: "⌘-",
    keysWindows: "Ctrl+-",
    category: "Zoom",
  },
  {
    id: "zoom-reset",
    label: "Reset zoom",
    description: "Reset browser zoom to its default level",
    keys: "⌘0",
    keysWindows: "Ctrl+0",
    category: "Zoom",
  },
];

const CATEGORY_ORDER: ShortcutCategory[] = [
  "Navigation",
  "Messages",
  "Formatting",
  "Zoom",
];

export function getShortcutsByCategory() {
  return new Map(
    CATEGORY_ORDER.map((category) => [
      category,
      KEYBOARD_SHORTCUTS.filter((shortcut) => shortcut.category === category),
    ]),
  );
}

export function getPlatformKeys(shortcut: KeyboardShortcut) {
  return isMacPlatform() ? shortcut.keys : shortcut.keysWindows;
}

export function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/u.test(navigator.platform);
}

export function hasPrimaryShortcutModifier(event: {
  ctrlKey: boolean;
  metaKey: boolean;
}) {
  return isMacPlatform() ? event.metaKey : event.ctrlKey;
}
