import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Bot,
  BookMarked,
  Copy,
  FolderKanban,
  GitFork,
  Inbox,
  LogOut,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  Settings,
  Trash2,
  Workflow as WorkflowIcon,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import { OwnerConnection } from "@/features/agents/ui/OwnerConnection";
import { listChannels } from "@/features/channels/channel-api";
import { lockOwnerVault } from "@/features/owner-vault/lib/vault-worker-client";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";
import { Button } from "@/shared/ui/button";
import {
  deleteWorkflow,
  listWorkflows,
  saveWorkflow,
  triggerWorkflow,
  type Workflow,
  workflowToYaml,
} from "../workflow-api";
import { TRIGGER_LABELS } from "../workflow-types";
import { WorkflowEditor } from "./WorkflowEditor";

type DialogState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; workflow: Workflow }
  | { mode: "duplicate"; workflow: Workflow };

export function WorkflowsPage() {
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(null);
  if (!ownerPubkey) return <OwnerConnection onConnected={setOwnerPubkey} />;
  return (
    <WorkflowWorkspace
      onDisconnect={() => {
        void lockOwnerVault();
        setOwnerPubkey(null);
      }}
      ownerPubkey={ownerPubkey}
    />
  );
}

function WorkflowWorkspace({
  ownerPubkey,
  onDisconnect,
}: {
  ownerPubkey: string;
  onDisconnect: () => void;
}) {
  const [dialog, setDialog] = useState<DialogState>({ mode: "closed" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [webhook, setWebhook] = useState<{
    workflowId: string;
    secret: string;
  } | null>(null);
  const queryClient = useQueryClient();
  const channelsQuery = useQuery({
    queryKey: ["channels", ownerPubkey],
    queryFn: () => listChannels(ownerPubkey),
  });
  const channels = (channelsQuery.data ?? []).filter(
    (channel) => channel.isMember && channel.channelType !== "dm",
  );
  const channelKey = channels
    .map((channel) => channel.id)
    .sort()
    .join(",");
  const workflowsQuery = useQuery({
    queryKey: ["workflows", channelKey],
    queryFn: () => listWorkflows(channels.map((channel) => channel.id)),
    enabled: channelsQuery.isSuccess,
  });
  const workflows = workflowsQuery.data ?? [];
  const selected = workflows.find((value) => value.id === selectedId) ?? null;
  const channelNames = useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel.name])),
    [channels],
  );
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["workflows"] });
  const save = useMutation({
    mutationFn: (input: { channelId: string; yaml: string }) =>
      saveWorkflow({
        ...input,
        id: dialog.mode === "edit" ? dialog.workflow.id : undefined,
      }),
    onSuccess: async (result) => {
      await refresh();
      setSelectedId(result.workflowId);
      setDialog({ mode: "closed" });
      if (result.webhookSecret)
        setWebhook({
          workflowId: result.workflowId,
          secret: result.webhookSecret,
        });
      toast.success(
        dialog.mode === "edit" ? "Workflow updated" : "Workflow created",
      );
    },
    onError: (error) =>
      toast.error("Could not save workflow", { description: error.message }),
  });
  const remove = useMutation({
    mutationFn: deleteWorkflow,
    onSuccess: async (_result, workflow) => {
      if (selectedId === workflow.id) setSelectedId(null);
      await refresh();
      toast.success("Workflow deleted");
    },
    onError: (error) =>
      toast.error("Could not delete workflow", { description: error.message }),
  });
  const trigger = useMutation({
    mutationFn: triggerWorkflow,
    onSuccess: () => toast.success("Workflow started"),
    onError: (error) =>
      toast.error("Could not trigger workflow", { description: error.message }),
  });
  const editing = dialog.mode === "edit" || dialog.mode === "duplicate";
  const initialYaml = editing
    ? dialog.mode === "duplicate"
      ? workflowToYaml({
          ...dialog.workflow.definition,
          name: `${dialog.workflow.definition.name} (copy)`,
        })
      : dialog.workflow.yaml
    : undefined;

  return (
    <div className="flex min-h-dvh bg-background">
      <WorkflowNav ownerPubkey={ownerPubkey} onDisconnect={onDisconnect} />
      <main className="min-w-0 flex-1 overflow-y-auto p-5 sm:p-8">
        <div className="mx-auto max-w-6xl">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">Workflows</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Automate messages, reactions, webhooks, schedules, and
                approvals.
              </p>
            </div>
            <Button
              disabled={!channels.length}
              onClick={() => setDialog({ mode: "create" })}
            >
              <Plus /> Create workflow
            </Button>
          </header>

          {channelsQuery.isLoading || workflowsQuery.isLoading ? (
            <p className="mt-8 text-sm text-muted-foreground">
              Loading workflows...
            </p>
          ) : workflowsQuery.isError ? (
            <div className="mt-8 rounded-md border p-6">
              <p className="text-sm text-destructive">
                Could not load workflows.
              </p>
              <Button
                className="mt-3"
                onClick={() => void workflowsQuery.refetch()}
                variant="outline"
              >
                Retry
              </Button>
            </div>
          ) : !channels.length ? (
            <EmptyState text="Join or create a channel before adding a workflow." />
          ) : workflows.length ? (
            <div
              className={`mt-7 grid gap-5 ${selected ? "lg:grid-cols-[minmax(0,1fr)_380px]" : ""}`}
            >
              <div className="space-y-2">
                {workflows.map((workflow) => (
                  <WorkflowRow
                    channelName={
                      channelNames.get(workflow.channelId) ?? "Unknown channel"
                    }
                    isOwner={workflow.owner === ownerPubkey}
                    key={`${workflow.owner}:${workflow.id}`}
                    onDelete={() => {
                      if (window.confirm(`Delete ${workflow.definition.name}?`))
                        remove.mutate(workflow);
                    }}
                    onDuplicate={() =>
                      setDialog({ mode: "duplicate", workflow })
                    }
                    onEdit={() => setDialog({ mode: "edit", workflow })}
                    onSelect={() => setSelectedId(workflow.id)}
                    onTrigger={() => trigger.mutate(workflow)}
                    selected={selected?.id === workflow.id}
                    workflow={workflow}
                  />
                ))}
              </div>
              {selected ? (
                <WorkflowDetail
                  channelName={
                    channelNames.get(selected.channelId) ?? "Unknown channel"
                  }
                  isOwner={selected.owner === ownerPubkey}
                  onClose={() => setSelectedId(null)}
                  onEdit={() => setDialog({ mode: "edit", workflow: selected })}
                  onTrigger={() => trigger.mutate(selected)}
                  workflow={selected}
                />
              ) : null}
            </div>
          ) : (
            <EmptyState text="No workflows yet." />
          )}
        </div>
      </main>

      {dialog.mode !== "closed" ? (
        <Modal
          onClose={() => setDialog({ mode: "closed" })}
          title={
            dialog.mode === "edit"
              ? "Edit workflow"
              : dialog.mode === "duplicate"
                ? "Duplicate workflow"
                : "Create workflow"
          }
        >
          <WorkflowEditor
            channels={channels}
            initialChannelId={
              editing ? dialog.workflow.channelId : (channels[0]?.id ?? "")
            }
            initialYaml={initialYaml}
            onCancel={() => setDialog({ mode: "closed" })}
            onSave={(value) => save.mutateAsync(value).then(() => undefined)}
            pending={save.isPending}
          />
        </Modal>
      ) : null}
      {webhook ? (
        <WebhookCredentials
          onClose={() => setWebhook(null)}
          secret={webhook.secret}
          workflowId={webhook.workflowId}
        />
      ) : null}
    </div>
  );
}

function WorkflowRow({
  workflow,
  channelName,
  isOwner,
  selected,
  onSelect,
  onTrigger,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  workflow: Workflow;
  channelName: string;
  isOwner: boolean;
  selected: boolean;
  onSelect: () => void;
  onTrigger: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <article
      className={`rounded-md border p-4 ${selected ? "border-primary bg-accent/40" : ""}`}
    >
      <div className="flex items-start gap-3">
        <button
          className="min-w-0 flex-1 text-left"
          onClick={onSelect}
          type="button"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{workflow.definition.name}</h2>
            <Status enabled={workflow.definition.enabled !== false} />
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {workflow.definition.description || "No description"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>#{channelName}</span>
            <span>{TRIGGER_LABELS[workflow.definition.trigger.on]}</span>
            <span>{workflow.definition.steps.length} steps</span>
          </div>
        </button>
        <div className="flex gap-1">
          {isOwner ? (
            <Button
              aria-label="Trigger workflow"
              disabled={workflow.definition.enabled === false}
              onClick={onTrigger}
              size="icon"
              variant="ghost"
            >
              <Play />
            </Button>
          ) : null}
          {isOwner ? (
            <Button
              aria-label="Edit workflow"
              onClick={onEdit}
              size="icon"
              variant="ghost"
            >
              <Pencil />
            </Button>
          ) : null}
          <Button
            aria-label="Duplicate workflow"
            onClick={onDuplicate}
            size="icon"
            variant="ghost"
          >
            <Copy />
          </Button>
          {isOwner ? (
            <Button
              aria-label="Delete workflow"
              onClick={onDelete}
              size="icon"
              variant="ghost"
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function WorkflowDetail({
  workflow,
  channelName,
  isOwner,
  onClose,
  onEdit,
  onTrigger,
}: {
  workflow: Workflow;
  channelName: string;
  isOwner: boolean;
  onClose: () => void;
  onEdit: () => void;
  onTrigger: () => void;
}) {
  return (
    <aside className="self-start rounded-md border">
      <header className="flex items-start gap-2 border-b p-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{workflow.definition.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">#{channelName}</p>
        </div>
        <Button
          aria-label="Close workflow details"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <X />
        </Button>
      </header>
      <div className="space-y-5 p-4">
        <div className="flex gap-2">
          {isOwner ? (
            <Button
              disabled={workflow.definition.enabled === false}
              onClick={onTrigger}
              size="sm"
            >
              <Play /> Trigger
            </Button>
          ) : null}
          {isOwner ? (
            <Button onClick={onEdit} size="sm" variant="outline">
              <Pencil /> Edit
            </Button>
          ) : null}
        </div>
        <section>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            Definition
          </h3>
          <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
            {workflow.yaml}
          </pre>
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            Run history
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Run traces are not currently exposed by the relay.
          </p>
        </section>
      </div>
    </aside>
  );
}

function WebhookCredentials({
  workflowId,
  secret,
  onClose,
}: {
  workflowId: string;
  secret: string;
  onClose: () => void;
}) {
  const url = `${relayHttpBaseUrl().replace(/\/$/, "")}/hooks/${workflowId}`;
  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  };
  return (
    <Modal onClose={onClose} title="Webhook ready">
      <p className="mb-4 text-sm text-muted-foreground">
        Store this secret now. The relay will not return it again.
      </p>
      <Credential
        label="Webhook URL"
        value={url}
        onCopy={() => void copy(url, "URL")}
      />
      <Credential
        label="X-Webhook-Secret"
        value={secret}
        onCopy={() => void copy(secret, "Secret")}
      />
      <div className="mt-5 flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

function Credential({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="mb-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-2 flex gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
          {value}
        </pre>
        <Button
          aria-label={`Copy ${label}`}
          onClick={onCopy}
          size="icon"
          variant="outline"
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}

function Status({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${enabled ? "bg-emerald-500/15 text-emerald-700" : "bg-muted text-muted-foreground"}`}
    >
      {enabled ? "Active" : "Disabled"}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-8 rounded-md border border-dashed p-10 text-center">
      <WorkflowIcon className="mx-auto h-8 w-8 text-muted-foreground" />
      <p className="mt-3 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-label={title}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-lg bg-background p-6 shadow-2xl">
        <header className="mb-5 flex items-center">
          <h2 className="flex-1 text-lg font-semibold">{title}</h2>
          <Button
            aria-label="Close"
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        {children}
      </div>
    </div>
  );
}

function WorkflowNav({
  ownerPubkey,
  onDisconnect,
}: {
  ownerPubkey: string;
  onDisconnect: () => void;
}) {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar p-3 sm:flex sm:flex-col">
      <div className="flex items-center gap-2 px-2 py-2">
        <div
          className="h-8 w-8 overflow-hidden bg-black"
          style={{ borderRadius: "22.37%" }}
        >
          <img alt="" className="h-full w-full" src={buzzAppIcon} />
        </div>
        <span className="font-semibold">Buzz</span>
      </div>
      <nav className="mt-4 space-y-1 text-sm">
        <Nav to="/" icon={<Inbox />} label="Inbox" />
        <Nav to="/repos" icon={<BookMarked />} label="Repositories" />
        <Nav to="/channels" icon={<MessageSquare />} label="Channels" />
        <Nav to="/pulse" icon={<Zap />} label="Pulse" />
        <Nav to="/projects" icon={<FolderKanban />} label="Projects" />
        <Nav to="/workflows" icon={<GitFork />} label="Workflows" active />
        <Nav to="/agents" icon={<Bot />} label="Agents" />
        <Nav to="/settings" icon={<Settings />} label="Settings" />
      </nav>
      <button
        className="mt-auto flex items-center gap-2 border-t px-2 py-3 text-xs text-muted-foreground"
        onClick={onDisconnect}
        type="button"
      >
        <LogOut className="h-4 w-4" />
        {truncatePubkey(ownerPubkey)}
      </button>
    </aside>
  );
}

function Nav({
  to,
  icon,
  label,
  active = false,
}: {
  to:
    | "/"
    | "/repos"
    | "/channels"
    | "/pulse"
    | "/projects"
    | "/workflows"
    | "/agents"
    | "/settings";
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      className={`flex items-center gap-2 rounded-md px-2 py-2 ${active ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent"}`}
      to={to}
    >
      <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      {label}
    </Link>
  );
}
