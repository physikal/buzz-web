import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

import {
  type ChannelAction,
  isChannelAction,
} from "@/features/channels/channel-actions";

const ChannelsPage = lazy(async () => {
  const module = await import("@/features/channels/ui/ChannelsPageEntry");
  return { default: module.ChannelsPage };
});

type ChannelsSearch = {
  action?: ChannelAction;
  channel?: string;
  message?: string;
};

export const Route = createFileRoute("/channels")({
  validateSearch: (search: Record<string, unknown>): ChannelsSearch => ({
    ...(isChannelAction(search.action) ? { action: search.action } : {}),
    ...(typeof search.channel === "string" ? { channel: search.channel } : {}),
    ...(typeof search.message === "string" ? { message: search.message } : {}),
  }),
  component: ChannelsRoute,
});

function ChannelsRoute() {
  const search = Route.useSearch();
  return (
    <ChannelsPage
      initialAction={search.action}
      initialChannelId={search.channel}
      initialMessageId={search.message}
    />
  );
}
