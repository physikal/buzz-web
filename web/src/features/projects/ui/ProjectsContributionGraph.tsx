import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

const WEEK_COUNT = 18;
const DAYS_PER_WEEK = 7;
const LEVEL_CLASSES = [
  "bg-muted/40",
  "bg-primary/25",
  "bg-primary/50",
  "bg-primary/75",
  "bg-primary",
];

function dayKey(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function projectActivityDayKey(timestamp: number) {
  return dayKey(new Date(timestamp * 1_000));
}

function activityLevel(count: number) {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

function buildWeeks(today: Date) {
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - today.getDay() - (WEEK_COUNT - 1) * DAYS_PER_WEEK,
  );
  return Array.from({ length: WEEK_COUNT }, (_, weekIndex) =>
    Array.from({ length: DAYS_PER_WEEK }, (_, dayIndex) => {
      const date = new Date(start);
      date.setDate(start.getDate() + weekIndex * DAYS_PER_WEEK + dayIndex);
      return date;
    }),
  );
}

function monthLabels(weeks: Date[][]) {
  let lastLabel = -3;
  return weeks.map((week, index) => {
    const newMonth =
      index === 0 || week[0]?.getMonth() !== weeks[index - 1]?.[0]?.getMonth();
    if (!newMonth || index - lastLabel < 3) return "";
    lastLabel = index;
    return week[0]?.toLocaleDateString(undefined, { month: "short" }) ?? "";
  });
}

export function ProjectsContributionGraph({
  activityByDay,
}: {
  activityByDay: Record<string, number>;
}) {
  const today = new Date();
  const todayKey = dayKey(today);
  const weeks = buildWeeks(today);
  const labels = monthLabels(weeks);
  const columns = `repeat(${WEEK_COUNT}, minmax(0, 1fr))`;
  return (
    <div className="space-y-2" data-testid="projects-contribution-graph">
      <div className="grid gap-1" style={{ gridTemplateColumns: columns }}>
        {labels.map((label, index) => (
          <span
            className="overflow-visible whitespace-nowrap text-[10px] font-medium text-muted-foreground"
            // biome-ignore lint/suspicious/noArrayIndexKey: positional calendar columns
            key={index}
          >
            {label}
          </span>
        ))}
      </div>
      <div
        className="grid grid-flow-col grid-rows-7 gap-1"
        style={{ gridTemplateColumns: columns }}
      >
        {weeks.flatMap((week) =>
          week.map((date) => {
            const key = dayKey(date);
            if (key > todayKey) {
              return (
                <span
                  aria-hidden="true"
                  className="aspect-square rounded-sm border border-border/40"
                  key={key}
                />
              );
            }
            const count = activityByDay[key] ?? 0;
            const label = date.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            });
            return (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  <span
                    aria-label={`${count} ${count === 1 ? "event" : "events"} on ${label}`}
                    className={`aspect-square w-full rounded-sm ${LEVEL_CLASSES[activityLevel(count)]}`}
                    role="img"
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {count > 0
                    ? `${count} ${count === 1 ? "event" : "events"} · ${label}`
                    : `No activity · ${label}`}
                </TooltipContent>
              </Tooltip>
            );
          }),
        )}
      </div>
    </div>
  );
}
