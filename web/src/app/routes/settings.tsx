import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const SettingsPage = lazy(async () => {
  const module = await import("@/features/settings/ui/SettingsPage");
  return { default: module.SettingsPage };
});

export const Route = createFileRoute("/settings")({ component: SettingsPage });
