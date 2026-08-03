import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const AgentsPage = lazy(async () => {
  const module = await import("@/features/agents/ui/AgentsPage");
  return { default: module.AgentsPage };
});

type AgentsSearch = {
  profile?: string;
  preview?: "agents" | "create-agent" | "add-agent-to-channel";
};

export const Route = createFileRoute("/agents")({
  validateSearch: (search: Record<string, unknown>): AgentsSearch => ({
    ...(typeof search.profile === "string" &&
    /^[0-9a-f]{64}$/i.test(search.profile)
      ? { profile: search.profile.toLowerCase() }
      : {}),
    ...(search.preview === "agents" ||
    search.preview === "create-agent" ||
    search.preview === "add-agent-to-channel"
      ? { preview: search.preview }
      : {}),
  }),
  component: AgentsRoute,
});

function AgentsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AgentsPage
      initialProfilePubkey={search.profile}
      onProfileChange={(profile) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            profile: profile ?? undefined,
          }),
        })
      }
    />
  );
}
