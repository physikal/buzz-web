import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Bot,
  BookMarked,
  FolderKanban,
  GitFork,
  Inbox,
  LogOut,
  MessageSquare,
  Plus,
  RefreshCw,
  Settings,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import { lockOwnerVault } from "@/features/owner-vault/lib/vault-worker-client";
import { getAgentDefaults } from "../agent-defaults-api";
import { truncatePubkey } from "@/shared/lib/pubkey";
import {
  createAgent,
  deleteAgent,
  listAgents,
  restoreAgentMemory,
  setAgentRunning,
  type CreateAgentInput,
  type ManagedAgent,
  updateAgent,
  type UpdateAgentInput,
} from "../agent-api";
import { Button } from "@/shared/ui/button";
import { DestructiveConfirmDialog } from "@/shared/ui/destructive-confirm-dialog";
import { useSidebarVisibility } from "@/shared/hooks/use-sidebar-visibility";
import { SidebarToggleButton } from "@/shared/ui/sidebar-toggle-button";
import { AddAgentToChannelDialog } from "./AddAgentToChannelDialog";
import { AgentAuthDialog } from "./AgentAuthDialog";
import { AgentActivityDialog } from "./AgentActivityDialog";
import { AgentCard } from "./AgentCard";
import {
  type AgentCreateDefaults,
  AgentCreateDialog,
} from "./AgentCreateDialog";
import { AgentEditDialog } from "./AgentEditDialog";
import { AgentLogDialog } from "./AgentLogDialog";
import { AgentMemoryDialog } from "./AgentMemoryDialog";
import { OwnerConnection } from "./OwnerConnection";
import { PersonasSection } from "./PersonasSection";
import { TeamsSection } from "./TeamsSection";
import type { AgentPersona } from "../persona-api";
import { exportManagedAgentSnapshot } from "../agent-snapshot";
import { AgentSnapshotExportDialog } from "./AgentSnapshotExportDialog";

const PREVIEW_AGENTS: ManagedAgent[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    owner_pubkey:
      "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    agent_pubkey: "02".repeat(32),
    persona_id: null,
    name: "Fizz",
    system_prompt: "Review changes and keep the project moving.",
    runtime: "buzz-agent",
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    agent_args: [],
    parallelism: 1,
    idle_timeout_seconds: null,
    max_turn_duration_seconds: null,
    runtime_config: {},
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
    persona_id: null,
    name: "Release notes",
    system_prompt: "Draft release notes from merged changes.",
    runtime: "codex",
    model: null,
    provider: null,
    agent_args: [],
    parallelism: 1,
    idle_timeout_seconds: null,
    max_turn_duration_seconds: null,
    runtime_config: {},
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
  const [agentToEdit, setAgentToEdit] = useState<ManagedAgent | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<ManagedAgent | null>(null);
  const [agentToExport, setAgentToExport] = useState<ManagedAgent | null>(null);
  const [agentToInspect, setAgentToInspect] = useState<ManagedAgent | null>(
    null,
  );
  const [agentActivity, setAgentActivity] = useState<ManagedAgent | null>(null);
  const [agentLog, setAgentLog] = useState<ManagedAgent | null>(null);
  const [personaToDeploy, setPersonaToDeploy] = useState<AgentPersona | null>(
    null,
  );
  const [snapshotMemory, setSnapshotMemory] = useState<
    Array<{ slug: string; body: string }>
  >([]);
  const agentsQuery = useQuery({
    queryKey: ["managed-agents", ownerPubkey],
    queryFn: () => (preview ? Promise.resolve(PREVIEW_AGENTS) : listAgents()),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const defaultsQuery = useQuery({
    queryKey: ["agent-defaults", ownerPubkey],
    queryFn: () => getAgentDefaults(ownerPubkey),
    staleTime: 0,
    gcTime: 0,
  });
  const createMutation = useMutation({
    mutationFn: async ({
      input,
      memory,
    }: {
      input: CreateAgentInput;
      memory: Array<{ slug: string; body: string }>;
    }) => {
      let agent = await createAgent({
        ...input,
        start_immediately: memory.length ? false : input.start_immediately,
      });
      const memoryErrors: string[] = [];
      for (const entry of memory) {
        try {
          await restoreAgentMemory(agent.id, entry);
        } catch (error) {
          memoryErrors.push(
            `${entry.slug}: ${error instanceof Error ? error.message : "restore failed"}`,
          );
        }
      }
      if (memory.length && input.credential_mode === "api-key") {
        try {
          agent = await setAgentRunning(agent.id, true);
        } catch (error) {
          memoryErrors.push(
            `start: ${error instanceof Error ? error.message : "start failed"}`,
          );
        }
      }
      return {
        agent,
        memoryErrors,
        memoryTotal: memory.length,
        memoryWritten:
          memory.length -
          memoryErrors.filter((error) => !error.startsWith("start:")).length,
      };
    },
    onSuccess: ({ agent, memoryErrors, memoryTotal, memoryWritten }) => {
      queryClient.setQueryData<ManagedAgent[]>(
        ["managed-agents", ownerPubkey],
        (current = []) => [...current, agent],
      );
      onCreateOpenChange(false);
      setPersonaToDeploy(null);
      setSnapshotMemory([]);
      if (agent.credential_mode === "subscription") {
        setAgentToAuthenticate(agent);
        toast.success(`${agent.name} created`, {
          description: memoryTotal
            ? `${memoryWritten} of ${memoryTotal} memories restored. Connect its subscription to start the agent.`
            : "Connect its subscription to start the agent.",
        });
      } else {
        toast.success(`${agent.name} is starting`);
      }
      if (memoryErrors.length)
        toast.error("Agent imported with restore errors", {
          description: memoryErrors.join("\n"),
        });
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
  const editMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAgentInput }) =>
      updateAgent(id, input),
    onSuccess: (agent) => {
      replaceAgent(agent);
      setAgentToEdit(null);
      toast.success(`${agent.name} updated`);
    },
    onError: (error) =>
      toast.error("Could not update agent", { description: error.message }),
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
    deleteMutation.isPending ||
    editMutation.isPending;
  const sidebar = useSidebarVisibility();

  return (
    <div className="flex min-h-dvh bg-background">
      {sidebar.open ? (
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
            <Link to="/" className="block">
              <SidebarItem icon={<Inbox />} label="Inbox" />
            </Link>
            <Link to="/repos" className="block">
              <SidebarItem icon={<BookMarked />} label="Repositories" />
            </Link>
            <Link to="/channels" className="block">
              <SidebarItem icon={<MessageSquare />} label="Channels" />
            </Link>
            <Link to="/pulse" className="block">
              <SidebarItem icon={<Zap />} label="Pulse" />
            </Link>
            <Link to="/projects" className="block">
              <SidebarItem icon={<FolderKanban />} label="Projects" />
            </Link>
            <Link to="/workflows" className="block">
              <SidebarItem icon={<GitFork />} label="Workflows" />
            </Link>
            <SidebarItem active icon={<Bot />} label="Agents" />
            <Link to="/settings" className="block">
              <SidebarItem icon={<Settings />} label="Settings" />
            </Link>
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
      ) : null}

      <main className="min-w-0 flex-1 overflow-y-auto px-4 py-7 sm:px-6 sm:py-8">
        <div className="mx-auto w-full max-w-6xl space-y-8 [container-type:inline-size]">
          <header className="flex min-w-0 items-start justify-between gap-4">
            <SidebarToggleButton />
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
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Deployed agents</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,240px))] justify-start gap-3 [@container(max-width:40rem)]:justify-center">
                {agents.map((agent) => (
                  <AgentCard
                    agent={agent}
                    key={agent.id}
                    pending={pending || preview}
                    onAddToChannel={() => setAgentToAddToChannel(agent)}
                    onAuthenticate={() => setAgentToAuthenticate(agent)}
                    onDelete={() => setAgentToDelete(agent)}
                    onEdit={() => setAgentToEdit(agent)}
                    onExport={() => setAgentToExport(agent)}
                    onViewActivity={() => setAgentActivity(agent)}
                    onViewMemory={() => setAgentToInspect(agent)}
                    onViewLogs={() => setAgentLog(agent)}
                    onSetRunning={(running) =>
                      stateMutation.mutate({ id: agent.id, running })
                    }
                  />
                ))}
                <button
                  aria-label="New agent"
                  className="group relative flex aspect-[4/5] w-full items-center justify-center rounded-2xl border border-dashed border-border/80 text-muted-foreground shadow-xs transition-colors hover:bg-muted/70 hover:text-foreground"
                  disabled={defaultsQuery.isLoading}
                  onClick={() => {
                    setPersonaToDeploy(null);
                    setSnapshotMemory([]);
                    onCreateOpenChange(true);
                  }}
                  type="button"
                >
                  <Plus className="h-7 w-7" />
                </button>
              </div>
            </section>
          ) : null}
          <PersonasSection
            ownerPubkey={ownerPubkey}
            onDeploy={(persona, memory = []) => {
              setPersonaToDeploy(persona);
              setSnapshotMemory(memory);
              onCreateOpenChange(true);
            }}
          />
          <TeamsSection
            agentDefaults={defaultsQuery.data}
            ownerPubkey={ownerPubkey}
          />
        </div>
      </main>

      <AgentCreateDialog
        defaults={personaDefaults(personaToDeploy)}
        globalDefaults={defaultsQuery.data}
        key={
          createOpen
            ? (personaToDeploy?.id ?? "new-agent-open")
            : "agent-dialog-closed"
        }
        open={createOpen}
        pending={createMutation.isPending}
        onClose={() => {
          onCreateOpenChange(false);
          setPersonaToDeploy(null);
          setSnapshotMemory([]);
        }}
        onSubmit={async (input: CreateAgentInput) => {
          if (preview) {
            onCreateOpenChange(false);
            setPersonaToDeploy(null);
            setSnapshotMemory([]);
            return;
          }
          await createMutation.mutateAsync({
            input: {
              ...input,
              ...(personaToDeploy ? { persona_id: personaToDeploy.id } : {}),
            },
            memory: snapshotMemory,
          });
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
      <AgentEditDialog
        agent={agentToEdit}
        pending={editMutation.isPending}
        onClose={() => setAgentToEdit(null)}
        onSubmit={async (input) => {
          if (!agentToEdit) return;
          await editMutation.mutateAsync({ id: agentToEdit.id, input });
        }}
      />
      <AgentMemoryDialog
        agent={agentToInspect}
        ownerPubkey={ownerPubkey}
        onClose={() => setAgentToInspect(null)}
      />
      {agentToExport ? (
        <AgentSnapshotExportDialog
          memoryAvailable
          name={agentToExport.name}
          onClose={() => setAgentToExport(null)}
          onExport={async (format, memoryLevel) => {
            try {
              await exportManagedAgentSnapshot(
                agentToExport,
                ownerPubkey,
                memoryLevel,
                format,
              );
              toast.success("Agent snapshot exported");
            } catch (error) {
              toast.error("Could not export snapshot", {
                description:
                  error instanceof Error ? error.message : "Export failed.",
              });
              throw error;
            }
          }}
        />
      ) : null}
      <AgentActivityDialog
        agent={agentActivity}
        ownerPubkey={ownerPubkey}
        onClose={() => setAgentActivity(null)}
      />
      <AgentLogDialog agent={agentLog} onClose={() => setAgentLog(null)} />
      <DestructiveConfirmDialog
        confirmLabel="Delete agent"
        description={
          <div className="space-y-3">
            <p>
              Deleting this agent removes the hosted agent from this community.
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Removes its management record and encrypted credentials</li>
              <li>Removes the agent from every channel it belongs to</li>
              <li>
                Hides its identity from active member lists and mention
                suggestions
              </li>
              <li>The agent harness must already be stopped</li>
            </ul>
          </div>
        }
        onClose={() => setAgentToDelete(null)}
        onConfirm={() => {
          if (!agentToDelete) return;
          void deleteMutation
            .mutateAsync(agentToDelete.id)
            .then(() => setAgentToDelete(null))
            .catch(() => {});
        }}
        open={agentToDelete !== null}
        pending={deleteMutation.isPending}
        pendingLabel="Deleting..."
        title="Delete this agent?"
      />
    </div>
  );
}

function personaDefaults(
  persona: AgentPersona | null,
): AgentCreateDefaults | undefined {
  if (!persona) return undefined;
  return {
    name: persona.namePool[0] ?? persona.displayName,
    instructions: persona.systemPrompt,
    runtime: persona.runtime ?? "codex",
    model: persona.model ?? undefined,
    provider: persona.provider ?? undefined,
    parallelism: persona.parallelism ?? undefined,
    respondTo: persona.respondTo ?? "owner-only",
    respondToAllowlist: persona.respondToAllowlist,
  };
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
