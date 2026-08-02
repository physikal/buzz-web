import { useEffect } from "react";

import {
  CHANNEL_ACTION_EVENT,
  type ChannelAction,
  isChannelAction,
} from "./channel-actions";

export function useChannelActions(
  initialAction: ChannelAction | undefined,
  openAction: (action: ChannelAction) => void,
) {
  useEffect(() => {
    if (initialAction) openAction(initialAction);
    const handleAction = (event: Event) => {
      const action = (event as CustomEvent<unknown>).detail;
      if (isChannelAction(action)) openAction(action);
    };
    window.addEventListener(CHANNEL_ACTION_EVENT, handleAction);
    return () => window.removeEventListener(CHANNEL_ACTION_EVENT, handleAction);
  }, [initialAction, openAction]);
}
