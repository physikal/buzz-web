import { useEffect } from "react";
import { hasActiveEscapeSurface } from "@/shared/hooks/use-escape-surface";

export function useChannelReadShortcuts({
  channelIds,
  selectedChannelId,
  markChannelRead,
}: {
  channelIds: string[];
  selectedChannelId: string | null;
  markChannelRead: (channelId: string) => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key !== "Escape" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      if (hasActiveEscapeSurface()) return;
      event.preventDefault();
      if (event.shiftKey) {
        for (const channelId of channelIds) markChannelRead(channelId);
      } else if (selectedChannelId) {
        markChannelRead(selectedChannelId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [channelIds, markChannelRead, selectedChannelId]);
}
