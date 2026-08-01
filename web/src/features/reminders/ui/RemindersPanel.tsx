import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellRing, Check, Clock3, Plus, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { relativeTime } from "@/shared/lib/relative-time";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  cancelReminder,
  completeReminder,
  listReminders,
  type Reminder,
  REMINDER_PRESETS,
  snoozeReminder,
} from "../reminder-api";
import { ReminderDialog } from "./ReminderDialog";

export function RemindersPanel({ ownerPubkey }: { ownerPubkey: string }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["reminders", ownerPubkey],
    queryFn: () => listReminders(ownerPubkey),
    refetchInterval: 30_000,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["reminders", ownerPubkey] });
  const transition = useMutation({
    mutationFn: ({
      reminder,
      action,
      notBefore,
    }: {
      reminder: Reminder;
      action: "done" | "cancel" | "snooze";
      notBefore?: number;
    }) =>
      action === "done"
        ? completeReminder(reminder)
        : action === "cancel"
          ? cancelReminder(reminder)
          : snoozeReminder(reminder, notBefore ?? 0),
    onSuccess: refresh,
    onError: (error) =>
      toast.error("Could not update reminder", { description: error.message }),
  });
  const groups = groupReminders(query.data ?? [], showDone);
  return (
    <section>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Reminders</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Private reminders synced through your relay.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus /> New reminder
        </Button>
      </header>
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          checked={showDone}
          onChange={(event) => setShowDone(event.target.checked)}
          type="checkbox"
        />
        Show completed
      </label>
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading reminders...</p>
      ) : groups.length ? (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.label}>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                {group.label}
              </h3>
              <div className="divide-y rounded-md border">
                {group.reminders.map((reminder) => (
                  <ReminderRow
                    key={reminder.id}
                    onAction={(action, notBefore) =>
                      transition.mutate({ reminder, action, notBefore })
                    }
                    reminder={reminder}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-10 text-center">
          <BellRing className="mx-auto h-7 w-7 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No reminders yet.
          </p>
        </div>
      )}
      <ReminderDialog
        onClose={() => setCreateOpen(false)}
        onCreated={() => void refresh()}
        open={createOpen}
      />
    </section>
  );
}

function ReminderRow({
  reminder,
  onAction,
}: {
  reminder: Reminder;
  onAction: (action: "done" | "cancel" | "snooze", notBefore?: number) => void;
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [customDate, setCustomDate] = useState(() =>
    dateValue(Date.now() + 86_400_000),
  );
  const [customTime, setCustomTime] = useState("09:00");
  const title =
    reminder.content.target?.preview || reminder.content.note || "Reminder";
  const customTimestamp = Math.floor(
    new Date(`${customDate}T${customTime}`).getTime() / 1000,
  );
  const isDone = reminder.content.status === "done";
  return (
    <article className="p-4">
      <div className="flex items-start gap-3">
        <Clock3 className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          {reminder.content.target ? (
            <Link
              className="font-medium hover:underline"
              search={{
                channel: reminder.content.target.channelId,
                message: reminder.content.target.eventId,
              }}
              to="/channels"
            >
              {title}
            </Link>
          ) : (
            <p className="font-medium">{title}</p>
          )}
          {reminder.content.target && reminder.content.note ? (
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {reminder.content.note}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            {isDone
              ? "Completed"
              : reminder.notBefore
                ? dueLabel(reminder.notBefore)
                : relativeTime(reminder.createdAt)}
          </p>
        </div>
        {!isDone ? (
          <div className="flex gap-1">
            <Button
              aria-label="Complete reminder"
              onClick={() => onAction("done")}
              size="icon"
              variant="ghost"
            >
              <Check />
            </Button>
            <Button
              aria-label="Snooze reminder"
              onClick={() => setSnoozeOpen((value) => !value)}
              size="icon"
              variant="ghost"
            >
              <RotateCcw />
            </Button>
            <Button
              aria-label="Cancel reminder"
              onClick={() => onAction("cancel")}
              size="icon"
              variant="ghost"
            >
              <X />
            </Button>
          </div>
        ) : null}
      </div>
      {snoozeOpen ? (
        <div className="mt-3 flex flex-wrap gap-2 pl-7">
          {REMINDER_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              onClick={() => {
                onAction("snooze", preset.getTimestamp());
                setSnoozeOpen(false);
              }}
              size="sm"
              variant="outline"
            >
              {preset.label}
            </Button>
          ))}
          <div className="flex w-full flex-wrap items-center gap-2 border-t pt-3">
            <Input
              aria-label="Snooze date"
              className="min-w-36 flex-1"
              min={dateValue(Date.now())}
              onChange={(event) => setCustomDate(event.target.value)}
              type="date"
              value={customDate}
            />
            <Input
              aria-label="Snooze time"
              className="w-28"
              onChange={(event) => setCustomTime(event.target.value)}
              type="time"
              value={customTime}
            />
            <Button
              disabled={customTimestamp <= Date.now() / 1000}
              onClick={() => {
                onAction("snooze", customTimestamp);
                setSnoozeOpen(false);
              }}
              size="sm"
            >
              Snooze
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function groupReminders(reminders: Reminder[], includeDone: boolean) {
  const now = Math.floor(Date.now() / 1000);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const endToday = Math.floor(end.getTime() / 1000);
  const pending = reminders.filter(
    (value) => value.content.status === "pending",
  );
  const groups = [
    {
      label: "Overdue",
      reminders: pending.filter(
        (value) => (value.notBefore ?? Infinity) <= now,
      ),
    },
    {
      label: "Today",
      reminders: pending.filter(
        (value) =>
          (value.notBefore ?? Infinity) > now &&
          (value.notBefore ?? Infinity) <= endToday,
      ),
    },
    {
      label: "Upcoming",
      reminders: pending.filter(
        (value) => (value.notBefore ?? Infinity) > endToday,
      ),
    },
    ...(includeDone
      ? [
          {
            label: "Completed",
            reminders: reminders.filter(
              (value) => value.content.status === "done",
            ),
          },
        ]
      : []),
  ];
  return groups.filter((group) => group.reminders.length);
}

function dueLabel(timestamp: number) {
  const now = Math.floor(Date.now() / 1000);
  return timestamp <= now
    ? `Due ${relativeTime(timestamp)}`
    : `Due ${new Date(timestamp * 1000).toLocaleString()}`;
}

function dateValue(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
