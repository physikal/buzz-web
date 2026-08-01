import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const OwnerSetupPage = lazy(async () => {
  const module = await import("@/features/owner-vault/ui/OwnerSetupPage");
  return { default: module.OwnerSetupPage };
});

const claimToken = takeClaimToken();

export const Route = createFileRoute("/agents/setup")({
  component: () => <OwnerSetupPage claimToken={claimToken} />,
});

function takeClaimToken() {
  if (window.location.pathname !== "/agents/setup") return "";
  const token = window.location.hash.slice(1).trim();
  if (token) window.history.replaceState(null, "", window.location.pathname);
  return token;
}
