import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const RepoDetailPage = lazy(async () => {
  const module = await import("@/features/repos/ui/RepoDetailPage");
  return { default: module.RepoDetailPage };
});

export const Route = createFileRoute("/repos/$repoId")({
  component: RepoDetailPage,
});
