import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const ProjectsPage = lazy(async () => {
  const module = await import("@/features/projects/ui/ProjectsPage");
  return { default: module.ProjectsPage };
});

export const Route = createFileRoute("/projects")({
  component: ProjectsPage,
});
