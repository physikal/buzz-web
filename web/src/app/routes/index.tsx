import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

import {
  parseProfilePanelTab,
  parseProfilePanelView,
  type ProfilePanelTab,
  type ProfilePanelView,
} from "@/features/profile/profile-panel-state";

const HomePage = lazy(async () => {
  const module = await import("@/features/home/ui/HomePage");
  return { default: module.HomePage };
});

type HomeSearch = {
  item?: string;
  profile?: string;
  profileTab?: ProfilePanelTab;
  profileView?: ProfilePanelView;
};

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    ...(typeof search.item === "string" && search.item.length
      ? { item: search.item }
      : {}),
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
  component: HomeRoute,
});

function HomeRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <HomePage
      initialItemId={search.item}
      initialProfilePubkey={search.profile}
      initialProfileTab={search.profileTab}
      initialProfileView={search.profileView}
      onItemChange={(item) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            item: item ?? undefined,
          }),
          replace: false,
        })
      }
      onProfileChange={(profile) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            profile: profile ?? undefined,
            profileTab: undefined,
            profileView: undefined,
          }),
          replace: false,
        })
      }
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
