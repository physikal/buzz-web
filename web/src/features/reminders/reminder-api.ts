import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import {
  nip44DecryptFromSelf,
  nip44EncryptToSelf,
} from "@/shared/lib/nostr-signer";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";

export type ReminderTarget = {
  eventId: string;
  channelId: string;
  preview: string;
  authorPubkey: string;
};

export type ReminderContent = {
  status: "pending" | "done" | "cancelled";
  target?: ReminderTarget;
  note?: string;
};

export type Reminder = {
  id: string;
  eventId: string;
  createdAt: number;
  notBefore?: number;
  content: ReminderContent;
};

function tagValues(event: NostrEvent, name: string) {
  return event.tags
    .filter((value) => value[0] === name)
    .map((value) => value[1]);
}

function validTarget(value: unknown): value is ReminderTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  return (
    typeof target.eventId === "string" &&
    /^[0-9a-f]{64}$/.test(target.eventId) &&
    typeof target.channelId === "string" &&
    target.channelId.length > 0 &&
    typeof target.preview === "string" &&
    typeof target.authorPubkey === "string" &&
    /^[0-9a-f]{64}$/.test(target.authorPubkey)
  );
}

function parseContent(plaintext: string): ReminderContent | null {
  try {
    const value = JSON.parse(plaintext) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    if (!["pending", "done", "cancelled"].includes(String(value.status)))
      return null;
    if (value.note !== undefined && typeof value.note !== "string") return null;
    if (value.target !== undefined && !validTarget(value.target)) return null;
    if (!value.target && !(typeof value.note === "string" && value.note.trim()))
      return null;
    return {
      status: value.status as ReminderContent["status"],
      target: value.target as ReminderTarget | undefined,
      note: value.note as string | undefined,
    };
  } catch {
    return null;
  }
}

function parseNotBefore(event: NostrEvent) {
  const values = tagValues(event, "not_before");
  if (values.length !== 1 || !/^(0|[1-9][0-9]*)$/.test(values[0]))
    return undefined;
  const parsed = Number(values[0]);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function eventReminder(event: NostrEvent): Promise<Reminder | null> {
  const dTags = tagValues(event, "d");
  if (dTags.length !== 1 || !dTags[0]) return null;
  try {
    const content = parseContent(await nip44DecryptFromSelf(event.content));
    if (!content) return null;
    const notBefore = parseNotBefore(event);
    if (content.status === "pending" && notBefore === undefined) return null;
    return {
      id: dTags[0],
      eventId: event.id,
      createdAt: event.created_at,
      notBefore,
      content,
    };
  } catch {
    return null;
  }
}

export async function listReminders(ownerPubkey: string): Promise<Reminder[]> {
  const events = await queryEvents(
    relayWsUrl(),
    { kinds: [30300], authors: [ownerPubkey], limit: 200 },
    { requireNip07: true },
  );
  const latest = new Map<string, NostrEvent>();
  for (const event of events) {
    if (event.pubkey !== ownerPubkey) continue;
    const d = tagValues(event, "d");
    if (d.length !== 1 || !d[0]) continue;
    const current = latest.get(d[0]);
    if (
      !current ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id < current.id)
    )
      latest.set(d[0], event);
  }
  const reminders = await Promise.all([...latest.values()].map(eventReminder));
  return reminders
    .filter((value): value is Reminder => value !== null)
    .sort(
      (a, b) =>
        (a.notBefore ?? Number.MAX_SAFE_INTEGER) -
        (b.notBefore ?? Number.MAX_SAFE_INTEGER),
    );
}

function randomId() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function writeReminder(input: {
  id: string;
  content: ReminderContent;
  notBefore?: number;
  createdAt?: number;
}) {
  if (input.content.status === "pending") {
    if (!Number.isSafeInteger(input.notBefore) || (input.notBefore ?? 0) <= 0)
      throw new Error("Choose a valid reminder time.");
  }
  const ciphertext = await nip44EncryptToSelf(JSON.stringify(input.content));
  const terminal = input.content.status !== "pending";
  const expiration =
    Math.floor(Date.now() / 1000) +
    (30 + (crypto.getRandomValues(new Uint8Array(1))[0] % 60)) * 86_400;
  await submitEvent({
    kind: 30300,
    created_at: input.createdAt,
    content: ciphertext,
    tags: [
      ["d", input.id],
      ["alt", "Encrypted reminder"],
      ...(terminal
        ? [["expiration", String(expiration)]]
        : [["not_before", String(input.notBefore)]]),
    ],
  });
}

export function createReminder(input: {
  note?: string;
  target?: ReminderTarget;
  notBefore: number;
}) {
  if (!input.target && !input.note?.trim())
    throw new Error("Add a reminder note.");
  return writeReminder({
    id: randomId(),
    notBefore: input.notBefore,
    content: {
      status: "pending",
      target: input.target,
      note: input.note?.trim() || undefined,
    },
  });
}

export function snoozeReminder(reminder: Reminder, notBefore: number) {
  return writeReminder({
    id: reminder.id,
    notBefore,
    content: { ...reminder.content, status: "pending" },
    createdAt: Math.max(Math.floor(Date.now() / 1000), reminder.createdAt + 1),
  });
}

export function completeReminder(reminder: Reminder) {
  return writeReminder({
    id: reminder.id,
    content: { ...reminder.content, status: "done" },
    createdAt: Math.max(Math.floor(Date.now() / 1000), reminder.createdAt + 1),
  });
}

export function cancelReminder(reminder: Reminder) {
  return writeReminder({
    id: reminder.id,
    content: { ...reminder.content, status: "cancelled" },
    createdAt: Math.max(Math.floor(Date.now() / 1000), reminder.createdAt + 1),
  });
}

function nextDayAt9am(dayOffset: number) {
  const now = new Date();
  const target = new Date(now);
  target.setDate(target.getDate() + dayOffset);
  target.setHours(9, 0, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return Math.floor(target.getTime() / 1000);
}

export const REMINDER_PRESETS = [
  {
    label: "In 30 minutes",
    getTimestamp: () => Math.floor(Date.now() / 1000) + 30 * 60,
  },
  {
    label: "In 1 hour",
    getTimestamp: () => Math.floor(Date.now() / 1000) + 60 * 60,
  },
  {
    label: "In 3 hours",
    getTimestamp: () => Math.floor(Date.now() / 1000) + 3 * 60 * 60,
  },
  { label: "Tomorrow at 9am", getTimestamp: () => nextDayAt9am(1) },
  {
    label: "Next Monday at 9am",
    getTimestamp: () => {
      const daysUntilMonday = (8 - new Date().getDay()) % 7 || 7;
      return nextDayAt9am(daysUntilMonday);
    },
  },
] as const;
