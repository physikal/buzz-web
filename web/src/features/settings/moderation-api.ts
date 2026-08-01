import { deleteMessage } from "@/features/channels/channel-api";
import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { queryEvents } from "@/shared/lib/nostr-client";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";

export type ModerationReport = {
  id: string;
  reportEventId: string;
  reporterPubkey: string;
  targetKind: "event" | "pubkey" | "blob";
  target: string;
  channelId: string | null;
  reportType: string;
  note: string | null;
  status: string;
  createdAt: string;
};

export type ModerationAction = {
  id: string;
  actorPubkey: string;
  action: string;
  targetPubkey: string | null;
  targetEventId: string | null;
  publicReason: string | null;
  createdAt: string;
};

export type ResolutionAction =
  | "delete"
  | "kick"
  | "ban"
  | "escalate"
  | "dismiss";

export type ReportType =
  | "spam"
  | "impersonation"
  | "profanity"
  | "nudity"
  | "malware"
  | "illegal"
  | "other";

export async function submitModerationReport(input: {
  authorPubkey: string;
  eventId: string;
  reportType: ReportType;
  note?: string;
}): Promise<void> {
  await submitEvent({
    kind: 1984,
    content: input.note?.trim() ?? "",
    tags: [
      ["p", input.authorPubkey.toLowerCase()],
      ["e", input.eventId, input.reportType],
    ],
  });
}

async function moderationGet<T>(path: string): Promise<T> {
  const url = `${relayHttpBaseUrl().replace(/\/+$/, "")}${path}`;
  const authorization = await makeNip98AuthHeader(url, "GET", {
    requireNip07: true,
  });
  const response = await fetch(url, {
    headers: { Authorization: authorization },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ?? `Moderation request failed (${response.status})`,
    );
  }
  return response.json() as Promise<T>;
}

export async function listModeration(): Promise<{
  reports: ModerationReport[];
  audit: ModerationAction[];
}> {
  type RawReport = {
    id: string;
    report_event_id: string;
    reporter_pubkey: string;
    target_kind: ModerationReport["targetKind"];
    target: string;
    channel_id: string | null;
    report_type: string;
    note: string | null;
    status: string;
    created_at: string;
  };
  type RawAction = {
    id: string;
    actor_pubkey: string;
    action: string;
    target_pubkey: string | null;
    target_event_id: string | null;
    public_reason: string | null;
    created_at: string;
  };
  const [reports, audit] = await Promise.all([
    moderationGet<RawReport[]>("/moderation/reports?status=open&limit=200"),
    moderationGet<RawAction[]>("/moderation/audit?limit=200"),
  ]);
  return {
    reports: reports.map((report) => ({
      id: report.id,
      reportEventId: report.report_event_id,
      reporterPubkey: report.reporter_pubkey,
      targetKind: report.target_kind,
      target: report.target,
      channelId: report.channel_id,
      reportType: report.report_type,
      note: report.note,
      status: report.status,
      createdAt: report.created_at,
    })),
    audit: audit.map((action) => ({
      id: action.id,
      actorPubkey: action.actor_pubkey,
      action: action.action,
      targetPubkey: action.target_pubkey,
      targetEventId: action.target_event_id,
      publicReason: action.public_reason,
      createdAt: action.created_at,
    })),
  };
}

async function reportedAuthor(report: ModerationReport): Promise<string> {
  if (report.targetKind === "pubkey") return report.target;
  if (report.targetKind !== "event")
    throw new Error("This report does not identify a member.");
  const events = await queryEvents(
    relayWsUrl(),
    {
      ids: [report.target],
      kinds: [9, 40002, 40008, 45001, 45003],
      limit: 1,
    },
    { requireNip07: true },
  );
  const author = events[0]?.pubkey;
  if (!author) throw new Error("Could not resolve the reported author.");
  return author;
}

async function enforce(report: ModerationReport, action: ResolutionAction) {
  if (action === "delete") {
    if (!report.channelId || report.targetKind !== "event")
      throw new Error("This report has no channel message to delete.");
    await deleteMessage(report.channelId, report.target);
  }
  if (action === "ban") {
    await submitEvent({
      kind: 9040,
      content: "",
      tags: [["p", await reportedAuthor(report)]],
    });
  }
  if (action === "kick") {
    if (!report.channelId)
      throw new Error("This report has no channel membership to remove.");
    await submitEvent({
      kind: 9001,
      content: "",
      tags: [
        ["h", report.channelId],
        ["p", await reportedAuthor(report)],
      ],
    });
  }
}

export async function resolveModerationReports(
  reports: ModerationReport[],
  action: ResolutionAction,
): Promise<void> {
  const first = reports[0];
  if (!first) return;
  await enforce(first, action);
  for (const report of reports) {
    await submitEvent({
      kind: 9044,
      content: "",
      tags: [
        ["report", report.reportEventId.toLowerCase()],
        ["status", action === "dismiss" ? "dismissed" : "resolved"],
        ["action", action],
      ],
    });
  }
}
