import { useCallback, useEffect, useState } from "react";

import type { ChannelMessage } from "./channel-api";

export type MessageEditScope = "main" | "thread";

export type MessageEditSession = {
  channelId: string;
  message: ChannelMessage;
  scope: MessageEditScope;
};

export function useMessageEditSession(channelId: string | null) {
  const [session, setSession] = useState<MessageEditSession | null>(null);
  useEffect(() => {
    if (session && session.channelId !== channelId) setSession(null);
  }, [channelId, session]);
  const start = useCallback(
    (message: ChannelMessage, scope: MessageEditScope) => {
      if (!channelId) return;
      setSession({ channelId, message, scope });
    },
    [channelId],
  );
  const cancel = useCallback(() => setSession(null), []);
  return { cancel, session, start };
}
