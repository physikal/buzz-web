import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const AgentsPage = lazy(async () => {
  const module = await import("@/features/agents/ui/AgentsPage");
  return { default: module.AgentsPage };
});

export const Route = createFileRoute("/agents")({
  component: AgentsPage,
});
