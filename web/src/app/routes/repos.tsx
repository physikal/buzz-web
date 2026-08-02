import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const ReposPage = lazy(async () => {
  const module = await import("@/features/repos/ui/ReposPage");
  return { default: module.ReposPage };
});

export const Route = createFileRoute("/repos")({
  component: ReposPage,
});
