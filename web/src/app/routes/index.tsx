import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const HomePage = lazy(async () => {
  const module = await import("@/features/home/ui/HomePage");
  return { default: module.HomePage };
});

type HomeSearch = { item?: string };

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    ...(typeof search.item === "string" && search.item.length
      ? { item: search.item }
      : {}),
  }),
  component: HomeRoute,
});

function HomeRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <HomePage
      initialItemId={search.item}
      onItemChange={(item) =>
        void navigate({ search: item ? { item } : {}, replace: false })
      }
    />
  );
}
