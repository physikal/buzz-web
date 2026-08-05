import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { init } from "emoji-mart";
import { memo, useEffect, useMemo, useRef } from "react";

import type { CustomEmoji } from "@/features/settings/custom-emoji-api";

let warmStarted = false;

function warmEmojiIndex() {
  if (warmStarted) return;
  warmStarted = true;
  const warm = () => void init({ data });
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(warm, { timeout: 1_500 });
  } else {
    globalThis.setTimeout(warm, 250);
  }
}

warmEmojiIndex();

function configureSearchInput(host: HTMLElement, autoFocus: boolean) {
  const picker = host.querySelector("em-emoji-picker");
  const root = picker?.shadowRoot;
  if (!root) return () => {};

  function configure() {
    const input = root?.querySelector<HTMLInputElement>('input[type="search"]');
    if (!input) return false;
    input.spellcheck = false;
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    if (autoFocus) input.focus();
    return true;
  }

  if (configure()) return () => {};
  const observer = new MutationObserver(() => {
    if (configure()) observer.disconnect();
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

function customCategory(customEmoji: CustomEmoji[]) {
  if (!customEmoji.length) return undefined;
  return [
    {
      id: "buzz-custom",
      name: "Custom",
      emojis: customEmoji.map((emoji) => ({
        id: emoji.shortcode,
        name: `:${emoji.shortcode}:`,
        keywords: [emoji.shortcode],
        skins: [{ src: emoji.url }],
      })),
    },
  ];
}

export const EmojiPicker = memo(function EmojiPicker({
  autoFocus = false,
  customEmoji,
  onSelect,
  width,
}: {
  autoFocus?: boolean;
  customEmoji: CustomEmoji[];
  onSelect: (emoji: string) => void;
  width?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const custom = useMemo(() => customCategory(customEmoji), [customEmoji]);

  useEffect(() => {
    if (!hostRef.current) return;
    return configureSearchInput(hostRef.current, autoFocus);
  }, [autoFocus]);

  return (
    <div ref={hostRef}>
      <Picker
        autoFocus={autoFocus}
        custom={custom}
        data={data}
        emojiButtonSize={32}
        emojiSize={20}
        maxFrequentRows={2}
        onEmojiSelect={(emoji: { native?: string; id?: string }) => {
          const value = emoji.native ?? (emoji.id ? `:${emoji.id}:` : "");
          if (value) onSelect(value);
        }}
        perLine={8}
        previewPosition="bottom"
        set="native"
        skinTonePosition="search"
        theme="auto"
        width={width}
      />
    </div>
  );
});
