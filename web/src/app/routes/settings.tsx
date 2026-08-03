import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

import {
  isSettingsSection,
  type SettingsSection,
} from "@/features/settings/settings-sections";

const SettingsPage = lazy(async () => {
  const module = await import("@/features/settings/ui/SettingsPage");
  return { default: module.SettingsPage };
});

type SettingsSearch = { section?: SettingsSection };

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({
    ...(isSettingsSection(search.section) ? { section: search.section } : {}),
  }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SettingsPage
      initialSection={search.section}
      onSectionChange={(section) =>
        void navigate({ search: { section }, replace: true })
      }
    />
  );
}
