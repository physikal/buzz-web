import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const HomePage = lazy(async () => {
  const module = await import("@/features/home/ui/HomePage");
  return { default: module.HomePage };
});

type HomeSearch = { item?: string; profile?: string };

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    ...(typeof search.item === "string" && search.item.length
      ? { item: search.item }
      : {}),
    ...(typeof search.profile === "string" &&
    /^[0-9a-f]{64}$/i.test(search.profile)
      ? { profile: search.profile.toLowerCase() }
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
          }),
          replace: false,
        })
      }
    />
  );
}
