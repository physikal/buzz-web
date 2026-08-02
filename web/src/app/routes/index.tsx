import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const HomePage = lazy(async () => {
  const module = await import("@/features/home/ui/HomePage");
  return { default: module.HomePage };
});

export const Route = createFileRoute("/")({
  component: HomePage,
});
