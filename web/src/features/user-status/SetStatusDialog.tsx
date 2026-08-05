import { MessageCircle, X } from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { CustomEmoji } from "@/features/settings/custom-emoji-api";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { StatusEmoji } from "./StatusEmoji";

const PRESETS = [
  { text: "In a meeting", emoji: "\uD83D\uDDE3\uFE0F" },
  { text: "Commuting", emoji: "\uD83D\uDE8C" },
  { text: "Out sick", emoji: "\uD83E\uDD12" },
  { text: "Vacationing", emoji: "\uD83C\uDFD6\uFE0F" },
  { text: "Working remotely", emoji: "\uD83C\uDFE0" },
] as const;

const EmojiPicker = lazy(async () => ({
  default: (await import("@/features/custom-emoji/EmojiPicker")).EmojiPicker,
}));

export function SetStatusDialog({
  customEmoji,
  hasExistingStatus,
  initialEmoji,
  initialText,
  onClear,
  onClose,
  onSave,
  open,
  pending,
}: {
  customEmoji: CustomEmoji[];
  hasExistingStatus: boolean;
  initialEmoji: string;
  initialText: string;
  onClear: () => Promise<void>;
  onClose: () => void;
  onSave: (text: string, emoji: string) => Promise<void>;
  open: boolean;
  pending: boolean;
}) {
  const [emoji, setEmoji] = useState(initialEmoji);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [text, setText] = useState(initialText);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  useEscapeSurface(open, onClose, pending);

  useEffect(() => {
    if (!open) return;
    setEmoji(initialEmoji);
    setText(initialText);
    setPickerOpen(false);
  }, [initialEmoji, initialText, open]);

  if (!open) return null;

  const save = async () => {
    try {
      await onSave(text.trim(), emoji);
      onClose();
    } catch {
      // The mutation owner reports the error and keeps the dialog open.
    }
  };
  const clear = async () => {
    try {
      await onClear();
      onClose();
    } catch {
      // The mutation owner reports the error and keeps the dialog open.
    }
  };

  return (
    <div
      aria-label="Set a status"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      data-testid="set-status-dialog"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !pending) onClose();
      }}
      role="dialog"
    >
      <div className="max-h-[90dvh] w-full max-w-[420px] overflow-y-auto rounded-lg bg-background p-5 shadow-2xl">
        <header className="flex items-start gap-3">
          <MessageCircle className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Set a status</h2>
            <p className="text-sm text-muted-foreground">
              Let others know what you&apos;re up to.
            </p>
          </div>
          <Button
            aria-label="Close"
            disabled={pending}
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X />
          </Button>
        </header>

        <div className="mt-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <div className="relative shrink-0">
              <button
                aria-expanded={pickerOpen}
                aria-label="Choose status emoji"
                className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-lg hover:bg-accent"
                onClick={() => setPickerOpen((value) => !value)}
                ref={emojiButtonRef}
                type="button"
              >
                {emoji ? (
                  <StatusEmoji
                    className="h-5 w-5"
                    customEmoji={customEmoji}
                    value={emoji}
                  />
                ) : (
                  "\uD83D\uDCAC"
                )}
              </button>
              {emoji ? (
                <button
                  aria-label="Clear status emoji"
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-background bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setEmoji("")}
                  type="button"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              ) : null}
              {pickerOpen ? (
                <EmojiPickerPopover
                  customEmoji={customEmoji}
                  onClose={() => setPickerOpen(false)}
                  onSelect={(value) => {
                    setEmoji(value);
                    setPickerOpen(false);
                  }}
                  trigger={emojiButtonRef.current}
                />
              ) : null}
            </div>
            <Input
              autoFocus
              data-testid="set-status-input"
              disabled={pending}
              maxLength={160}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (text.trim() || emoji) void save();
                }
              }}
              placeholder="What's your status?"
              value={text}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                className="rounded-full border border-input px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                data-testid={`set-status-preset-${preset.text.toLowerCase().replace(/\s+/g, "-")}`}
                disabled={pending}
                key={preset.text}
                onClick={() => {
                  setText(preset.text);
                  setEmoji(preset.emoji);
                }}
                type="button"
              >
                {preset.emoji} {preset.text}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <div>
              {hasExistingStatus ? (
                <Button
                  data-testid="set-status-clear"
                  disabled={pending}
                  onClick={() => void clear()}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Clear status
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                data-testid="set-status-cancel"
                disabled={pending}
                onClick={onClose}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                data-testid="set-status-save"
                disabled={pending || (!text.trim() && !emoji)}
                onClick={() => void save()}
                size="sm"
                type="button"
              >
                {pending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmojiPickerPopover({
  customEmoji,
  onClose,
  onSelect,
  trigger,
}: {
  customEmoji: CustomEmoji[];
  onClose: () => void;
  onSelect: (emoji: string) => void;
  trigger: HTMLButtonElement | null;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!trigger) return;
    const place = () => {
      const rect = trigger.getBoundingClientRect();
      const gutter = 8;
      const width = Math.min(285, window.innerWidth - gutter * 2);
      const maxHeight = Math.min(435, window.innerHeight - gutter * 2);
      setPosition({
        left: Math.min(
          Math.max(gutter, rect.left),
          window.innerWidth - width - gutter,
        ),
        top: Math.min(
          Math.max(gutter, rect.bottom + 4),
          window.innerHeight - maxHeight - gutter,
        ),
        width,
        maxHeight,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [trigger]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) || trigger?.contains(target))
        return;
      onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onClose, trigger]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
      trigger?.focus();
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [onClose, trigger]);

  if (!position) return null;
  return createPortal(
    <div
      className="fixed z-[60] overflow-auto rounded-md border bg-popover shadow-xl"
      data-testid="status-emoji-picker"
      ref={panelRef}
      style={position}
    >
      <Suspense
        fallback={
          <div
            className="flex h-72 w-full items-center justify-center text-sm text-muted-foreground"
            role="status"
          >
            Loading emoji...
          </div>
        }
      >
        <EmojiPicker
          autoFocus
          customEmoji={customEmoji}
          onSelect={onSelect}
          width={position.width}
        />
      </Suspense>
    </div>,
    document.body,
  );
}
