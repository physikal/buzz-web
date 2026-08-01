import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const PulsePage = lazy(async () => {
  const module = await import("@/features/pulse/ui/PulsePage");
  return { default: module.PulsePage };
});

export const Route = createFileRoute("/pulse")({ component: PulsePage });
