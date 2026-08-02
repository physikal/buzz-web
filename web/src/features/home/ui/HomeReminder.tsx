import { Link } from "@tanstack/react-router";
import { Bell, Check, Clock3, MessageSquare, X } from "lucide-react";
import { useState } from "react";

import {
  type Reminder,
  REMINDER_PRESETS,
} from "@/features/reminders/reminder-api";
import { Button } from "@/shared/ui/button";

export function HomeReminderRow({
  reminder,
  selected,
  onSelect,
}: {
  reminder: Reminder;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={`flex w-full gap-3 border-b px-4 py-3 text-left hover:bg-muted/50 ${selected ? "bg-muted/50" : ""}`}
      onClick={onSelect}
      type="button"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Bell className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-muted-foreground">
          Reminder
        </span>
        <strong className="mt-1 line-clamp-2 block text-sm font-medium">
          {reminderTitle(reminder)}
        </strong>
        <span
          className={`mt-1 block text-xs ${isDue(reminder) ? "font-medium text-destructive" : "text-muted-foreground"}`}
        >
          {dueLabel(reminder.notBefore)}
        </span>
      </span>
    </button>
  );
}

export function HomeReminderDetail({
  reminder,
  mobileVisible,
  onBack,
  onAction,
  pending,
}: {
  reminder: Reminder | null;
  mobileVisible: boolean;
  onBack: () => void;
  onAction: (
    action: "complete" | "cancel" | "snooze",
    reminder: Reminder,
    notBefore?: number,
  ) => void;
  pending: boolean;
}) {
  const [snooze, setSnooze] = useState("");
  if (!reminder)
    return (
      <section className="hidden min-w-0 flex-1 items-center justify-center sm:flex">
        <div className="text-center text-sm text-muted-foreground">
          <Bell className="mx-auto mb-3 h-8 w-8" />
          Select a reminder
        </div>
      </section>
    );
  const target = reminder.content.target;
  return (
    <section
      className={`${mobileVisible ? "flex" : "hidden"} min-w-0 flex-1 flex-col sm:flex`}
    >
      <header className="flex min-h-16 items-center gap-3 border-b px-4 sm:px-6">
        <Button className="sm:hidden" onClick={onBack} variant="ghost">
          Back
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">Reminder</h2>
          <p className="truncate text-xs text-muted-foreground">
            {dueLabel(reminder.notBefore)}
          </p>
        </div>
        {target ? (
          <Button asChild variant="outline">
            <Link
              search={{ channel: target.channelId, message: target.eventId }}
              to="/channels"
            >
              <MessageSquare /> Open in channel
            </Link>
          </Button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-10">
        <article className="mx-auto max-w-3xl">
          <div className="flex items-center gap-3 border-b pb-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Clock3 className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold">{reminderTitle(reminder)}</p>
              {target && reminder.content.note ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {reminder.content.note}
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button
              disabled={pending}
              onClick={() => onAction("complete", reminder)}
            >
              <Check /> Complete
            </Button>
            <label className="sr-only" htmlFor="home-reminder-snooze">
              Snooze reminder
            </label>
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              disabled={pending}
              id="home-reminder-snooze"
              onChange={(event) => {
                const value = event.target.value;
                setSnooze(value);
                const preset = REMINDER_PRESETS[Number(value)];
                if (preset) onAction("snooze", reminder, preset.getTimestamp());
              }}
              value={snooze}
            >
              <option value="">Snooze</option>
              {REMINDER_PRESETS.map((preset, index) => (
                <option key={preset.label} value={index}>
                  {preset.label}
                </option>
              ))}
            </select>
            <Button
              disabled={pending}
              onClick={() => onAction("cancel", reminder)}
              variant="ghost"
            >
              <X /> Cancel
            </Button>
          </div>
        </article>
      </div>
    </section>
  );
}

export function isDue(reminder: Reminder) {
  return (reminder.notBefore ?? Number.POSITIVE_INFINITY) <= Date.now() / 1_000;
}

function reminderTitle(reminder: Reminder) {
  return (
    reminder.content.target?.preview || reminder.content.note || "Reminder"
  );
}

function dueLabel(timestamp: number | undefined) {
  if (!timestamp) return "Scheduled";
  const seconds = timestamp - Math.floor(Date.now() / 1_000);
  if (seconds <= 0) return "Reminder due";
  if (seconds < 60) return "In less than a minute";
  if (seconds < 3_600) return `In ${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `In ${Math.floor(seconds / 3_600)}h`;
  return `In ${Math.floor(seconds / 86_400)}d`;
}
