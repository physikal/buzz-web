import { CalendarClock, Clock, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { ReminderTarget } from "../reminder-api";
import { createReminder, REMINDER_PRESETS } from "../reminder-api";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";

export function ReminderDialog({
  open,
  target,
  onClose,
  onCreated,
}: {
  open: boolean;
  target?: ReminderTarget;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => dateValue(Date.now() + 86_400_000));
  const [time, setTime] = useState("09:00");
  const [pending, setPending] = useState(false);
  useEscapeSurface(open, onClose, pending);
  if (!open) return null;
  const save = async (notBefore: number) => {
    setPending(true);
    try {
      await createReminder({ target, note, notBefore });
      toast.success("Reminder set");
      setNote("");
      onCreated?.();
      onClose();
    } catch (error) {
      toast.error("Could not set reminder", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPending(false);
    }
  };
  const customTimestamp = Math.floor(
    new Date(`${date}T${time}`).getTime() / 1000,
  );
  return (
    <div
      aria-label="Remind me later"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-2xl">
        <header className="mb-5 flex items-center gap-2">
          <Clock className="h-4 w-4" />
          <h2 className="flex-1 text-lg font-semibold">Remind me later</h2>
          <Button
            aria-label="Close"
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        {target ? (
          <p className="mb-4 line-clamp-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
            {target.preview}
          </p>
        ) : null}
        <label className="block text-sm font-medium" htmlFor="reminder-note">
          Private note{target ? " (optional)" : ""}
          <textarea
            className="mt-2 min-h-20 w-full rounded-md border bg-background p-3 text-sm"
            id="reminder-note"
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              target ? "Add context" : "What should Buzz remind you about?"
            }
            value={note}
          />
        </label>
        <div className="mt-4 grid gap-2">
          {REMINDER_PRESETS.map((preset) => (
            <Button
              disabled={pending || (!target && !note.trim())}
              key={preset.label}
              onClick={() => void save(preset.getTimestamp())}
              variant="outline"
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="mt-4 space-y-3 border-t pt-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="h-4 w-4" />
            Custom date and time
          </p>
          <div className="flex gap-2">
            <Input
              aria-label="Reminder date"
              min={dateValue(Date.now())}
              onChange={(event) => setDate(event.target.value)}
              type="date"
              value={date}
            />
            <Input
              aria-label="Reminder time"
              onChange={(event) => setTime(event.target.value)}
              type="time"
              value={time}
            />
          </div>
          <Button
            className="w-full"
            disabled={
              pending ||
              customTimestamp <= Date.now() / 1000 ||
              (!target && !note.trim())
            }
            onClick={() => void save(customTimestamp)}
          >
            Set reminder
          </Button>
        </div>
      </div>
    </div>
  );
}

function dateValue(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
