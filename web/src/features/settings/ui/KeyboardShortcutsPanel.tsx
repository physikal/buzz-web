import {
  getPlatformKeys,
  getShortcutsByCategory,
  type KeyboardShortcut,
} from "@/shared/lib/keyboard-shortcuts";

function KeyCombo({ shortcut }: { shortcut: KeyboardShortcut }) {
  const parts = getPlatformKeys(shortcut)
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  return (
    <span className="flex shrink-0 items-center gap-1">
      {parts.map((part) => (
        <kbd
          className="inline-flex h-6 min-w-6 items-center justify-center rounded border bg-muted px-1.5 font-mono text-xs text-muted-foreground"
          key={part}
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}

export function KeyboardShortcutsPanel() {
  return (
    <section aria-labelledby="keyboard-shortcuts-heading">
      <header className="mb-6">
        <h2 className="text-2xl font-semibold" id="keyboard-shortcuts-heading">
          Keyboard shortcuts
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          All available keyboard shortcuts. Shortcuts are read-only.
        </p>
      </header>
      <div className="space-y-6">
        {[...getShortcutsByCategory()].map(([category, shortcuts]) => (
          <div key={category}>
            <h3 className="mb-2 text-base font-semibold">{category}</h3>
            <div className="divide-y rounded-md border">
              {shortcuts.map((shortcut) => (
                <div
                  className="flex min-h-12 items-center gap-4 px-3 py-2"
                  key={shortcut.id}
                >
                  <div className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{shortcut.label}</span>
                    <span className="ml-2 text-muted-foreground">
                      {shortcut.description}
                    </span>
                  </div>
                  <KeyCombo shortcut={shortcut} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
