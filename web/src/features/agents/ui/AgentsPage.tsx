import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  BookMarked,
  LogOut,
  MessageSquare,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import { lockOwnerVault } from "@/features/owner-vault/lib/vault-worker-client";
import { truncatePubkey } from "@/shared/lib/pubkey";
import {
  createAgent,
  deleteAgent,
  listAgents,
  setAgentRunning,
  type CreateAgentInput,
  type ManagedAgent,
} from "../agent-api";
import { Button } from "@/shared/ui/button";
import { AddAgentToChannelDialog } from "./AddAgentToChannelDialog";
import { AgentAuthDialog } from "./AgentAuthDialog";
import { AgentCard } from "./AgentCard";
import { AgentCreateDialog } from "./AgentCreateDialog";
import { OwnerConnection } from "./OwnerConnection";

const PREVIEW_AGENTS: ManagedAgent[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    owner_pubkey:
      "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    agent_pubkey: "02".repeat(32),
    name: "Fizz",
    system_prompt: "Review changes and keep the project moving.",
    runtime: "buzz-agent",
    model: "claude-sonnet-4-6",
    credential_mode: "api-key",
    respond_to: "owner-only",
    respond_to_allowlist: [],
    desired_state: "running",
    observed_state: "running",
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    owner_pubkey:
      "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    agent_pubkey: "03".repeat(32),
    name: "Release notes",
    system_prompt: "Draft release notes from merged changes.",
    runtime: "codex",
    model: null,
    credential_mode: "subscription",
    respond_to: "owner-only",
    respond_to_allowlist: [],
    desired_state: "stopped",
    observed_state: "stopped",
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const PREVIEW_CHANNELS = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "engineering",
    visibility: "private" as const,
    channelType: "stream",
    alreadyMember: false,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "general",
    visibility: "public" as const,
    channelType: "stream",
    alreadyMember: true,
  },
];

export function AgentsPage() {
  const previewMode = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("preview")
    : null;
  const preview =
    previewMode === "agents" ||
    previewMode === "create-agent" ||
    previewMode === "add-agent-to-channel";
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(() =>
    preview ? PREVIEW_AGENTS[0].owner_pubkey : null,
  );
  const [createOpen, setCreateOpen] = useState(previewMode === "create-agent");

  if (!ownerPubkey) {
    return (
      <OwnerConnection
        onConnected={(pubkey) => {
          setOwnerPubkey(pubkey);
        }}
      />
    );
  }

  return (
    <AgentsWorkspace
      ownerPubkey={ownerPubkey}
      preview={preview}
      createOpen={createOpen}
      onCreateOpenChange={setCreateOpen}
      onDisconnect={() => {
        void lockOwnerVault();
        setOwnerPubkey(null);
      }}
    />
  );
}

function AgentsWorkspace({
  ownerPubkey,
  preview,
  createOpen,
  onCreateOpenChange,
  onDisconnect,
}: {
  ownerPubkey: string;
  preview: boolean;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onDisconnect: () => void;
}) {
  const queryClient = useQueryClient();
  const [agentToAddToChannel, setAgentToAddToChannel] =
    useState<ManagedAgent | null>(() =>
      new URLSearchParams(window.location.search).get("preview") ===
      "add-agent-to-channel"
        ? PREVIEW_AGENTS[0]
        : null,
    );
  const [agentToAuthenticate, setAgentToAuthenticate] =
    useState<ManagedAgent | null>(null);
  const agentsQuery = useQuery({
    queryKey: ["managed-agents", ownerPubkey],
    queryFn: () => (preview ? Promise.resolve(PREVIEW_AGENTS) : listAgents()),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const createMutation = useMutation({
    mutationFn: createAgent,
    onSuccess: (agent) => {
      queryClient.setQueryData<ManagedAgent[]>(
        ["managed-agents", ownerPubkey],
        (current = []) => [...current, agent],
      );
      onCreateOpenChange(false);
      if (agent.credential_mode === "subscription") {
        setAgentToAuthenticate(agent);
        toast.success(`${agent.name} created`, {
          description: "Connect its subscription to start the agent.",
        });
      } else {
        toast.success(`${agent.name} is starting`);
      }
    },
    onError: (error) =>
      toast.error("Could not create agent", { description: error.message }),
  });
  const stateMutation = useMutation({
    mutationFn: ({ id, running }: { id: string; running: boolean }) =>
      setAgentRunning(id, running),
    onSuccess: replaceAgent,
    onError: (error) =>
      toast.error("Could not update agent", { description: error.message }),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAgent,
    onSuccess: (_, id) => {
      queryClient.setQueryData<ManagedAgent[]>(
        ["managed-agents", ownerPubkey],
        (current = []) => current.filter((agent) => agent.id !== id),
      );
      toast.success("Agent deleted");
    },
    onError: (error) =>
      toast.error("Could not delete agent", { description: error.message }),
  });

  function replaceAgent(updated: ManagedAgent) {
    queryClient.setQueryData<ManagedAgent[]>(
      ["managed-agents", ownerPubkey],
      (current = []) =>
        current.map((agent) => (agent.id === updated.id ? updated : agent)),
    );
  }

  const agents = agentsQuery.data ?? [];
  const pending =
    createMutation.isPending ||
    stateMutation.isPending ||
    deleteMutation.isPending;

  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar p-3 sm:flex sm:flex-col">
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
          <a href="/" className="block">
            <SidebarItem icon={<BookMarked />} label="Repositories" />
          </a>
          <a href="/channels" className="block">
            <SidebarItem icon={<MessageSquare />} label="Channels" />
          </a>
          <SidebarItem active icon={<Bot />} label="Agents" />
        </nav>
        <div className="mt-auto border-t border-sidebar-border pt-3">
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-muted-foreground hover:bg-sidebar-accent"
            onClick={onDisconnect}
            type="button"
          >
            <LogOut className="h-4 w-4" />
            <span className="min-w-0 flex-1 truncate">
              {truncatePubkey(ownerPubkey)}
            </span>
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto px-4 py-7 sm:px-6 sm:py-8">
        <div className="mx-auto w-full max-w-6xl space-y-8 [container-type:inline-size]">
          <header className="flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <h1 className="text-2xl font-semibold">Agents</h1>
              <p className="text-base text-muted-foreground">
                Set up and manage your agents.
              </p>
            </div>
            <Button
              disabled={agentsQuery.isFetching || preview}
              onClick={() => agentsQuery.refetch()}
              size="sm"
              variant="outline"
            >
              <RefreshCw /> Refresh
            </Button>
          </header>

          {agentsQuery.isLoading ? <AgentGridSkeleton /> : null}
          {agentsQuery.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {agentsQuery.error.message}
              <Button
                className="ml-3"
                onClick={() => agentsQuery.refetch()}
                size="sm"
                variant="outline"
              >
                Try again
              </Button>
            </div>
          ) : null}
          {!agentsQuery.isLoading && !agentsQuery.error ? (
            <section className="grid grid-cols-[repeat(auto-fill,minmax(220px,240px))] justify-start gap-3 [@container(max-width:40rem)]:justify-center">
              {agents.map((agent) => (
                <AgentCard
                  agent={agent}
                  key={agent.id}
                  pending={pending || preview}
                  onAddToChannel={() => setAgentToAddToChannel(agent)}
                  onAuthenticate={() => setAgentToAuthenticate(agent)}
                  onDelete={() => deleteMutation.mutate(agent.id)}
                  onSetRunning={(running) =>
                    stateMutation.mutate({ id: agent.id, running })
                  }
                />
              ))}
              <button
                aria-label="New agent"
                className="group relative flex aspect-[4/5] w-full items-center justify-center rounded-2xl border border-dashed border-border/80 text-muted-foreground shadow-xs transition-colors hover:bg-muted/70 hover:text-foreground"
                onClick={() => onCreateOpenChange(true)}
                type="button"
              >
                <Plus className="h-7 w-7" />
              </button>
            </section>
          ) : null}
        </div>
      </main>

      <AgentCreateDialog
        open={createOpen}
        pending={createMutation.isPending}
        onClose={() => onCreateOpenChange(false)}
        onSubmit={async (input: CreateAgentInput) => {
          if (preview) {
            onCreateOpenChange(false);
            return;
          }
          await createMutation.mutateAsync(input);
        }}
      />
      <AddAgentToChannelDialog
        agent={agentToAddToChannel}
        onAdded={(channel) => {
          toast.success(`${agentToAddToChannel?.name ?? "Agent"} added`, {
            description: `The agent can now be mentioned in ${channel.name}.`,
          });
        }}
        onClose={() => setAgentToAddToChannel(null)}
        open={agentToAddToChannel !== null}
        previewChannels={preview ? PREVIEW_CHANNELS : undefined}
      />
      <AgentAuthDialog
        agent={agentToAuthenticate}
        key={agentToAuthenticate?.id ?? "agent-auth"}
        onAuthenticated={async (agent) => {
          await stateMutation.mutateAsync({ id: agent.id, running: true });
          setAgentToAuthenticate(null);
          toast.success(`${agent.name} is starting`);
        }}
        onClose={() => setAgentToAuthenticate(null)}
      />
    </div>
  );
}

function SidebarItem({
  icon,
  label,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md px-2 py-2 ${active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground"}`}
    >
      <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      {label}
    </div>
  );
}

function AgentGridSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,240px))] gap-3">
      {["one", "two", "three"].map((key) => (
        <div
          className="aspect-[4/5] animate-pulse rounded-2xl bg-muted"
          key={key}
        />
      ))}
    </div>
  );
}
