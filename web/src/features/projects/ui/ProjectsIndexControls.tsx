import { ChevronDown, LayoutGrid, List } from "lucide-react";

import { Button } from "@/shared/ui/button";

export type ProjectsFilter =
  | "overview"
  | "repositories"
  | "pull-requests"
  | "issues";
export type ProjectsSort = "updated" | "created" | "name";
export type ProjectsViewMode = "grid" | "list";

export function ProjectsTabs({
  filter,
  onChange,
}: {
  filter: ProjectsFilter;
  onChange: (filter: ProjectsFilter) => void;
}) {
  const options = [
    ["overview", "Overview"],
    ["repositories", "Repositories"],
    ["pull-requests", "Pull Requests"],
    ["issues", "Issues"],
  ] as const;
  return (
    <nav
      aria-label="Projects views"
      className="flex h-13 min-w-0 flex-1 overflow-x-auto border-b"
    >
      {options.map(([value, label]) => (
        <Button
          aria-current={filter === value ? "page" : undefined}
          className={`relative h-full shrink-0 rounded-none px-2.5 shadow-none after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:bg-current after:content-[''] ${
            filter === value
              ? "font-semibold text-foreground after:opacity-100"
              : "text-muted-foreground after:opacity-0 hover:bg-transparent hover:text-foreground hover:after:opacity-100"
          }`}
          key={value}
          onClick={() => onChange(value)}
          variant="ghost"
        >
          <span className="grid">
            <span
              aria-hidden="true"
              className="invisible col-start-1 row-start-1 font-semibold"
            >
              {label}
            </span>
            <span className="col-start-1 row-start-1">{label}</span>
          </span>
        </Button>
      ))}
    </nav>
  );
}

function ViewModeToggle({
  value,
  onChange,
}: {
  value: ProjectsViewMode;
  onChange: (value: ProjectsViewMode) => void;
}) {
  return (
    <fieldset className="flex items-center rounded-md bg-muted/40 p-0.5">
      <legend className="sr-only">Project layout</legend>
      <Button
        aria-label="Grid layout"
        aria-pressed={value === "grid"}
        className="h-7 w-7 p-0"
        onClick={() => onChange("grid")}
        size="icon"
        variant={value === "grid" ? "secondary" : "ghost"}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
      </Button>
      <Button
        aria-label="List layout"
        aria-pressed={value === "list"}
        className="h-7 w-7 p-0"
        onClick={() => onChange("list")}
        size="icon"
        variant={value === "list" ? "secondary" : "ghost"}
      >
        <List className="h-3.5 w-3.5" />
      </Button>
    </fieldset>
  );
}

export function SelectControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ label: string; value: T }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        className="h-8 appearance-none rounded-md bg-transparent py-1 pl-2 pr-8 text-sm font-semibold outline-none hover:bg-muted/50 focus:ring-1 focus:ring-ring"
        onChange={(event) => onChange(event.target.value as T)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-4 w-4 text-muted-foreground" />
    </label>
  );
}

export function ListControls({
  sort,
  viewMode,
  onSortChange,
  onViewModeChange,
}: {
  sort: ProjectsSort;
  viewMode: ProjectsViewMode;
  onSortChange: (sort: ProjectsSort) => void;
  onViewModeChange: (viewMode: ProjectsViewMode) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Sort projects"
        className="h-8 rounded-md bg-transparent px-2 text-xs outline-none hover:bg-muted/50 focus:ring-1 focus:ring-ring"
        onChange={(event) => onSortChange(event.target.value as ProjectsSort)}
        value={sort}
      >
        <option value="updated">Recent activity</option>
        <option value="created">Created date</option>
        <option value="name">Name</option>
      </select>
      <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
    </div>
  );
}

export function EmptyList({ children }: { children: string }) {
  return (
    <div className="border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
