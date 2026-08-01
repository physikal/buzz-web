import { createFileRoute } from "@tanstack/react-router";

import { OwnerSetupPage } from "@/features/owner-vault/ui/OwnerSetupPage";

export const Route = createFileRoute("/agents/setup")({
  component: OwnerSetupPage,
});
