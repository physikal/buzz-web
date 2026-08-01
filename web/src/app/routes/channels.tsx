import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const ChannelsPage = lazy(async () => {
  const module = await import("@/features/channels/ui/ChannelsPage");
  return { default: module.ChannelsPage };
});

type ChannelsSearch = {
  channel?: string;
  message?: string;
};

export const Route = createFileRoute("/channels")({
  validateSearch: (search: Record<string, unknown>): ChannelsSearch => ({
    ...(typeof search.channel === "string" ? { channel: search.channel } : {}),
    ...(typeof search.message === "string" ? { message: search.message } : {}),
  }),
  component: ChannelsRoute,
});

function ChannelsRoute() {
  const search = Route.useSearch();
  return (
    <ChannelsPage
      initialChannelId={search.channel}
      initialMessageId={search.message}
    />
  );
}
