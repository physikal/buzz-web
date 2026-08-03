import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const PulsePage = lazy(async () => {
  const module = await import("@/features/pulse/ui/PulsePage");
  return { default: module.PulsePage };
});

type PulseSearch = { profile?: string };

export const Route = createFileRoute("/pulse")({
  validateSearch: (search: Record<string, unknown>): PulseSearch => ({
    ...(typeof search.profile === "string" && search.profile.length
      ? { profile: search.profile }
      : {}),
  }),
  component: PulseRoute,
});

function PulseRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PulsePage
      initialProfilePubkey={search.profile}
      onProfileChange={(profile) =>
        void navigate({ search: profile ? { profile } : {} })
      }
    />
  );
}
