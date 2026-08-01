import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import {
  readNotificationSettings,
  type WebNotificationSettings,
} from "@/features/settings/settings-api";
import { listReminders, type Reminder } from "../reminder-api";

const POLL_INTERVAL_MS = 30_000;
const WATERMARK_PREFIX = "buzz-web:last-reminder-check:";

function watermarkKey(pubkey: string) {
  return `${WATERMARK_PREFIX}${pubkey}`;
}

function readWatermark(pubkey: string) {
  const key = watermarkKey(pubkey);
  const stored = Number(localStorage.getItem(key));
  if (Number.isFinite(stored) && stored > 0) return stored;
  const now = Math.floor(Date.now() / 1000);
  localStorage.setItem(key, String(now));
  return now;
}

function dueSince(reminders: Reminder[], watermark: number, now: number) {
  return reminders.filter(
    (reminder) =>
      reminder.content.status === "pending" &&
      reminder.notBefore !== undefined &&
      reminder.notBefore > watermark &&
      reminder.notBefore <= now,
  );
}

function showReminderNotification(
  reminders: Reminder[],
  settings: WebNotificationSettings,
) {
  if (
    reminders.length === 0 ||
    !settings.enabled ||
    !settings.reminderAlerts ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  )
    return;

  const reminder = reminders[0];
  const notification = new Notification(
    reminders.length === 1 ? "Reminder due" : "Reminders due",
    {
      body:
        reminders.length === 1
          ? reminder.content.target?.preview ||
            reminder.content.note ||
            "A reminder is waiting"
          : `${reminders.length} reminders are due`,
      silent: !settings.sound,
      tag:
        reminders.length === 1
          ? `buzz-reminder-${reminder.id}`
          : "buzz-reminders-due",
    },
  );
  notification.onclick = () => {
    window.focus();
    const target = reminders.length === 1 ? reminder.content.target : undefined;
    if (!target) return;
    const destination = new URL("/channels", window.location.origin);
    destination.searchParams.set("channel", target.channelId);
    destination.searchParams.set("message", target.eventId);
    window.location.assign(destination);
  };
}

export function ReminderNotifier({
  ownerPubkey,
}: {
  ownerPubkey: string | null;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    enabled: ownerPubkey !== null,
    queryKey: ["reminders", ownerPubkey],
    queryFn: () => listReminders(ownerPubkey ?? ""),
  });
  const remindersRef = useRef<Reminder[]>([]);
  const resolvedRef = useRef(false);
  remindersRef.current = query.data ?? [];
  if (query.isFetched) resolvedRef.current = true;

  const check = useCallback(() => {
    if (!ownerPubkey || !resolvedRef.current) return;
    const now = Math.floor(Date.now() / 1000);
    const watermark = readWatermark(ownerPubkey);
    showReminderNotification(
      dueSince(remindersRef.current, watermark, now),
      readNotificationSettings(),
    );
    localStorage.setItem(watermarkKey(ownerPubkey), String(now));
    void queryClient.invalidateQueries({
      queryKey: ["reminders", ownerPubkey],
    });
  }, [ownerPubkey, queryClient]);

  useEffect(() => {
    if (!ownerPubkey) {
      resolvedRef.current = false;
      return;
    }

    check();
    const interval = window.setInterval(check, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [check, ownerPubkey]);

  useEffect(() => {
    if (query.isFetched) check();
  }, [check, query.isFetched]);

  return null;
}
