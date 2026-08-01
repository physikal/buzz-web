import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { communityMembershipKey } from "./CommunityMembersPanel";
import { getCommunityMembership } from "../community-api";
import {
  listModeration,
  type ModerationAction,
  type ModerationReport,
  type ResolutionAction,
  resolveModerationReports,
} from "../moderation-api";

type ReportGroup = {
  key: string;
  reports: ModerationReport[];
  priorActions: ModerationAction[];
};

const REPORT_LABELS: Record<string, string> = {
  illegal: "Illegal content",
  nudity: "Nudity",
  malware: "Malware",
  spam: "Spam",
  impersonation: "Impersonation",
  profanity: "Profanity",
  other: "Other",
};

export function ModerationPanel({ ownerPubkey }: { ownerPubkey: string }) {
  const [tab, setTab] = useState<"queue" | "audit">("queue");
  const membership = useQuery({
    queryKey: [...communityMembershipKey, ownerPubkey],
    queryFn: () => getCommunityMembership(ownerPubkey),
    staleTime: 30_000,
  });
  const role = membership.data?.currentRole;
  const isModerator = role === "owner" || role === "admin";
  const moderation = useQuery({
    queryKey: ["moderation"],
    queryFn: listModeration,
    enabled: isModerator,
    refetchInterval: 30_000,
  });

  return (
    <section>
      <header className="mb-6">
        <h2 className="text-2xl font-semibold">Moderation</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review reported content and take action. Visible to community
          moderators only.
        </p>
      </header>
      {membership.isLoading ? (
        <p className="text-sm text-muted-foreground">Checking access…</p>
      ) : !isModerator ? (
        <Notice>
          The moderation queue is available to community moderators only.
        </Notice>
      ) : moderation.error instanceof Error ? (
        <Notice error>{moderation.error.message}</Notice>
      ) : (
        <>
          <div className="mb-4 inline-flex rounded-md bg-muted p-1">
            <TabButton
              active={tab === "queue"}
              label="Queue"
              onClick={() => setTab("queue")}
            />
            <TabButton
              active={tab === "audit"}
              label="Audit log"
              onClick={() => setTab("audit")}
            />
          </div>
          {moderation.isLoading ? (
            <p className="text-sm text-muted-foreground">
              Loading moderation data…
            </p>
          ) : tab === "queue" ? (
            <Queue
              reports={moderation.data?.reports ?? []}
              audit={moderation.data?.audit ?? []}
            />
          ) : (
            <Audit actions={moderation.data?.audit ?? []} />
          )}
        </>
      )}
    </section>
  );
}

function Queue({
  reports,
  audit,
}: {
  reports: ModerationReport[];
  audit: ModerationAction[];
}) {
  const queryClient = useQueryClient();
  const groups = useMemo(() => groupReports(reports, audit), [audit, reports]);
  const mutation = useMutation({
    mutationFn: ({
      group,
      action,
    }: {
      group: ReportGroup;
      action: ResolutionAction;
    }) => resolveModerationReports(group.reports, action),
    onSuccess: async (_, { action }) => {
      await queryClient.invalidateQueries({ queryKey: ["moderation"] });
      toast.success(
        action === "dismiss" ? "Report dismissed" : "Report resolved",
      );
    },
    onError: (error) =>
      toast.error("Could not resolve report", { description: error.message }),
  });
  if (!groups.length)
    return <Notice>No open reports. The queue is clear.</Notice>;
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <ReportCard
          disabled={mutation.isPending}
          group={group}
          key={group.key}
          onResolve={(action) => mutation.mutate({ group, action })}
        />
      ))}
    </div>
  );
}

function ReportCard({
  group,
  disabled,
  onResolve,
}: {
  group: ReportGroup;
  disabled: boolean;
  onResolve: (action: ResolutionAction) => void;
}) {
  const report = group.reports[0];
  const [action, setAction] = useState<ResolutionAction>("dismiss");
  const options = allowedActions(report);
  return (
    <article className="rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${report.reportType === "illegal" ? "bg-destructive/15 text-destructive" : "bg-muted"}`}
            >
              {report.reportType === "illegal" ? (
                <ShieldAlert className="mr-1 inline h-3 w-3" />
              ) : null}
              {REPORT_LABELS[report.reportType] ?? report.reportType}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {targetLabel(report)} · {group.reports.length}{" "}
              {group.reports.length === 1 ? "report" : "reports"}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <select
            aria-label="Resolution"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            disabled={disabled}
            value={action}
            onChange={(event) =>
              setAction(event.target.value as ResolutionAction)
            }
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {actionLabel(option)}
              </option>
            ))}
          </select>
          <Button disabled={disabled} onClick={() => onResolve(action)}>
            Resolve
          </Button>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {group.reports.map((item) => (
          <div
            className="rounded-md border bg-muted/20 px-3 py-2 text-xs"
            key={item.id}
          >
            <p>
              <strong>
                {REPORT_LABELS[item.reportType] ?? item.reportType}
              </strong>{" "}
              <span className="text-muted-foreground">
                reported by {truncatePubkey(item.reporterPubkey)} ·{" "}
                {formatDate(item.createdAt)}
              </span>
            </p>
            {item.note ? (
              <p className="mt-1 text-muted-foreground">{item.note}</p>
            ) : null}
          </div>
        ))}
      </div>
      {group.priorActions.length ? (
        <p className="mt-3 flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          {group.priorActions.length} prior moderation{" "}
          {group.priorActions.length === 1 ? "action" : "actions"} against this
          target
        </p>
      ) : null}
    </article>
  );
}

function Audit({ actions }: { actions: ModerationAction[] }) {
  if (!actions.length) return <Notice>No moderation actions yet.</Notice>;
  return (
    <div className="space-y-2">
      {actions.map((action) => (
        <div className="rounded-md border px-3 py-2" key={action.id}>
          <p className="text-sm font-medium capitalize">
            {action.action.replace(/_/g, " ")}
          </p>
          <p className="text-xs text-muted-foreground">
            {action.targetPubkey || action.targetEventId
              ? `${truncatePubkey(action.targetPubkey ?? action.targetEventId ?? "")} · `
              : ""}
            by {truncatePubkey(action.actorPubkey)} ·{" "}
            {formatDate(action.createdAt)}
          </p>
          {action.publicReason ? (
            <p className="mt-1 text-xs">{action.publicReason}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function groupReports(
  reports: ModerationReport[],
  audit: ModerationAction[],
): ReportGroup[] {
  const groups = new Map<string, ModerationReport[]>();
  for (const report of reports) {
    const key = `${report.targetKind}:${report.target}`;
    groups.set(key, [...(groups.get(key) ?? []), report]);
  }
  return [...groups.entries()].map(([key, rows]) => ({
    key,
    reports: rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    priorActions: audit.filter((action) =>
      rows[0]?.targetKind === "event"
        ? action.targetEventId === rows[0].target
        : rows[0]?.targetKind === "pubkey" &&
          action.targetPubkey === rows[0].target,
    ),
  }));
}

function allowedActions(report: ModerationReport): ResolutionAction[] {
  const actions: ResolutionAction[] = [];
  if (report.targetKind === "event" && report.channelId)
    actions.push("delete", "kick");
  if (report.targetKind === "event" || report.targetKind === "pubkey")
    actions.push("ban");
  actions.push("escalate", "dismiss");
  return actions;
}

function actionLabel(action: ResolutionAction) {
  return {
    delete: "Delete content",
    kick: "Kick author",
    ban: "Ban author",
    escalate: "Escalate",
    dismiss: "Dismiss",
  }[action];
}

function targetLabel(report: ModerationReport) {
  const type =
    report.targetKind === "event"
      ? "Message"
      : report.targetKind === "pubkey"
        ? "Member"
        : "Attachment";
  return `${type} ${truncatePubkey(report.target)}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded px-3 py-1.5 text-sm ${active ? "bg-background shadow-sm" : "text-muted-foreground"}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function Notice({
  children,
  error,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <p
      className={`rounded-md border p-4 text-sm ${error ? "border-destructive/30 bg-destructive/10 text-destructive" : "text-muted-foreground"}`}
    >
      {children}
    </p>
  );
}
