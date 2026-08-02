import { useEffect, useMemo, useRef, useState } from "react";

import { hasPrimaryShortcutModifier } from "@/shared/lib/keyboard-shortcuts";
import { searchMessages, type ChannelMessage } from "./channel-api";

export type ChannelFindMatch = { id: string; rootId: string | null };

export function useChannelFind({
  channelId,
  messages,
  onActivate,
}: {
  channelId: string | null;
  messages: ChannelMessage[];
  onActivate: (match: ChannelFindMatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remoteMatches, setRemoteMatches] = useState<ChannelFindMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const previousChannelId = useRef(channelId);

  const localMatches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term.length < 2) return [];
    return messages
      .filter((message) => message.content.toLowerCase().includes(term))
      .map((message) => ({ id: message.id, rootId: message.rootId }));
  }, [messages, query]);

  useEffect(() => {
    const term = query.trim();
    if (!open || !channelId || term.length < 2) {
      setRemoteMatches([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void searchMessages({ text: term, channelId })
        .then((events) => {
          if (!active) return;
          setRemoteMatches(
            events.map((event) => ({
              id: event.id,
              rootId:
                event.tags.find(
                  (tag) => tag[0] === "e" && tag[3] === "root",
                )?.[1] ?? null,
            })),
          );
        })
        .catch(() => {
          if (active) setRemoteMatches([]);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [channelId, open, query]);

  const matches = useMemo(() => {
    const result = [...localMatches];
    const seen = new Set(result.map((match) => match.id));
    for (const match of remoteMatches) {
      if (!seen.has(match.id)) result.push(match);
    }
    return result;
  }, [localMatches, remoteMatches]);

  useEffect(() => {
    setActiveIndex((current) => (current < matches.length ? current : 0));
  }, [matches.length]);
  useEffect(() => {
    const match = matches[activeIndex];
    if (open && match) onActivate(match);
  }, [activeIndex, matches, onActivate, open]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "f" ||
        !hasPrimaryShortcutModifier(event) ||
        document.querySelector('[role="dialog"]')
      )
        return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  useEffect(() => {
    if (previousChannelId.current === channelId) return;
    previousChannelId.current = channelId;
    setOpen(false);
    setQuery("");
    setRemoteMatches([]);
    setActiveIndex(0);
  }, [channelId]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setRemoteMatches([]);
    setActiveIndex(0);
  };
  const next = () => {
    if (matches.length)
      setActiveIndex((current) => (current + 1) % matches.length);
  };
  const previous = () => {
    if (matches.length)
      setActiveIndex((current) =>
        current === 0 ? matches.length - 1 : current - 1,
      );
  };

  return {
    activeIndex,
    close,
    matchingIds: new Set(matches.map((match) => match.id)),
    matchCount: matches.length,
    next,
    open,
    previous,
    query,
    setQuery,
  };
}
