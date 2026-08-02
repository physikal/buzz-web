export type ShortcutCategory = "Navigation" | "Messages";

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
];

const CATEGORY_ORDER: ShortcutCategory[] = ["Navigation", "Messages"];

export function getShortcutsByCategory() {
  return new Map(
    CATEGORY_ORDER.map((category) => [
      category,
      KEYBOARD_SHORTCUTS.filter((shortcut) => shortcut.category === category),
    ]),
  );
}

export function getPlatformKeys(shortcut: KeyboardShortcut) {
  return /Mac|iPhone|iPad|iPod/u.test(navigator.platform)
    ? shortcut.keys
    : shortcut.keysWindows;
}
