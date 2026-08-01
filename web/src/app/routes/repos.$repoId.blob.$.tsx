import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const RepoBlobPage = lazy(async () => {
  const module = await import("@/features/repos/ui/RepoBlobViewer");
  return { default: module.RepoBlobPage };
});

export const Route = createFileRoute("/repos/$repoId/blob/$")({
  component: RepoBlobPage,
});
