import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const InvitePage = lazy(async () => {
  const module = await import("@/features/invite/ui/InvitePage");
  return { default: module.InvitePage };
});

export const Route = createFileRoute("/invite/$code")({
  component: InvitePageRoute,
});

function InvitePageRoute() {
  const { code } = Route.useParams();
  return <InvitePage code={code} />;
}
