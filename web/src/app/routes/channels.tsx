import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

import {
  type ChannelAction,
  isChannelAction,
} from "@/features/channels/channel-actions";
import {
  parseProfilePanelTab,
  parseProfilePanelView,
  type ProfilePanelTab,
  type ProfilePanelView,
} from "@/features/profile/profile-panel-state";

const ChannelsPage = lazy(async () => {
  const module = await import("@/features/channels/ui/ChannelsPageEntry");
  return { default: module.ChannelsPage };
});

type ChannelsSearch = {
  action?: ChannelAction;
  channel?: string;
  message?: string;
  profile?: string;
  profileTab?: ProfilePanelTab;
  profileView?: ProfilePanelView;
};

export const Route = createFileRoute("/channels")({
  validateSearch: (search: Record<string, unknown>): ChannelsSearch => ({
    ...(isChannelAction(search.action) ? { action: search.action } : {}),
    ...(typeof search.channel === "string" ? { channel: search.channel } : {}),
    ...(typeof search.message === "string" ? { message: search.message } : {}),
    ...(typeof search.profile === "string" &&
    /^[0-9a-f]{64}$/i.test(search.profile)
      ? { profile: search.profile.toLowerCase() }
      : {}),
    ...(parseProfilePanelTab(search.profileTab)
      ? { profileTab: parseProfilePanelTab(search.profileTab) }
      : {}),
    ...(parseProfilePanelView(search.profileView)
      ? { profileView: parseProfilePanelView(search.profileView) }
      : {}),
  }),
  component: ChannelsRoute,
});

function ChannelsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ChannelsPage
      initialAction={search.action}
      initialChannelId={search.channel}
      initialMessageId={search.message}
      initialProfilePubkey={search.profile}
      initialProfileTab={search.profileTab}
      initialProfileView={search.profileView}
      onProfileTabChange={(profileTab) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            profileTab: profileTab === "info" ? undefined : profileTab,
          }),
        })
      }
      onProfileViewChange={(profileView) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            profileView: profileView === "summary" ? undefined : profileView,
          }),
        })
      }
    />
  );
}
