import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Pencil,
  Play,
  Plus,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import type { AgentDefaults } from "../agent-defaults-api";
import { listAgents, type ManagedAgent } from "../agent-api";
import {
  deletePersona,
  type AgentPersona,
  listPersonas,
  savePersona,
} from "../persona-api";
import {
  deleteTeam,
  type AgentTeam,
  listTeams,
  saveTeam,
  type TeamInput,
} from "../team-api";
import { TeamDeployDialog } from "./TeamDeployDialog";
import { TeamDialog } from "./TeamDialog";
import {
  decodeTeamSnapshot,
  type DecodedTeamSnapshot,
  exportTeamSnapshot,
  teamSnapshotInput,
  teamSnapshotMemoryByPersona,
  teamSnapshotPersonaInputs,
} from "../team-snapshot";
import { TeamSnapshotExportDialog } from "./TeamSnapshotExportDialog";
import { TeamSnapshotImportDialog } from "./TeamSnapshotImportDialog";

export function TeamsSection({
  agentDefaults,
  ownerPubkey,
}: {
  agentDefaults?: AgentDefaults;
  ownerPubkey: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AgentTeam | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deploying, setDeploying] = useState<AgentTeam | null>(null);
  const [exporting, setExporting] = useState<AgentTeam | null>(null);
  const [snapshotImport, setSnapshotImport] =
    useState<DecodedTeamSnapshot | null>(null);
  const [snapshotDeployPersonas, setSnapshotDeployPersonas] = useState<
    AgentPersona[]
  >([]);
  const [snapshotMemory, setSnapshotMemory] = useState<
    Record<string, Array<{ slug: string; body: string }>>
  >({});
  const snapshotInput = useRef<HTMLInputElement>(null);
  const teams = useQuery({
    queryKey: ["agent-teams", ownerPubkey],
    queryFn: () => listTeams(ownerPubkey),
    staleTime: 30_000,
  });
  const personas = useQuery({
    queryKey: ["agent-personas", ownerPubkey],
    queryFn: () => listPersonas(ownerPubkey),
    staleTime: 30_000,
  });
  const agents = useQuery({
    queryKey: ["managed-agents", ownerPubkey],
    queryFn: listAgents,
    staleTime: 15_000,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["agent-teams", ownerPubkey] });
  const save = useMutation({
    mutationFn: ({ input, team }: { input: TeamInput; team?: AgentTeam }) =>
      saveTeam(input, team),
    onSuccess: () => {
      setFormOpen(false);
      setEditing(null);
      void refresh();
      toast.success("Team saved");
    },
    onError: (error) =>
      toast.error("Could not save team", { description: error.message }),
  });
  const remove = useMutation({
    mutationFn: (team: AgentTeam) => deleteTeam(ownerPubkey, team),
    onSuccess: () => {
      void refresh();
      toast.success("Team deleted");
    },
    onError: (error) =>
      toast.error("Could not delete team", { description: error.message }),
  });
  const importSnapshot = useMutation({
    mutationFn: async (keepAllowlist: boolean) => {
      if (!snapshotImport) throw new Error("Choose a team snapshot.");
      const created: AgentPersona[] = [];
      try {
        for (const input of teamSnapshotPersonaInputs(
          snapshotImport.snapshot,
          keepAllowlist,
        ))
          created.push(await savePersona(input));
        const team = await saveTeam(
          teamSnapshotInput(
            snapshotImport.snapshot,
            created.map((persona) => persona.id),
          ),
        );
        return {
          team,
          personas: created,
          memory: teamSnapshotMemoryByPersona(snapshotImport.snapshot, created),
        };
      } catch (error) {
        const cleanupErrors: string[] = [];
        for (const persona of created) {
          try {
            await deletePersona(ownerPubkey, persona);
          } catch (cleanupError) {
            cleanupErrors.push(
              cleanupError instanceof Error
                ? cleanupError.message
                : "persona cleanup failed",
            );
          }
        }
        if (cleanupErrors.length)
          throw new Error(
            `${error instanceof Error ? error.message : "Import failed."} Cleanup also failed: ${cleanupErrors.join("; ")}`,
          );
        throw error;
      }
    },
    onSuccess: ({ team, personas: imported, memory }) => {
      setSnapshotImport(null);
      setSnapshotDeployPersonas(imported);
      setSnapshotMemory(memory);
      setDeploying(team);
      void refresh();
      void queryClient.invalidateQueries({
        queryKey: ["agent-personas", ownerPubkey],
      });
      toast.success("Team snapshot imported", {
        description: "Configure credentials to deploy its hosted agents.",
      });
    },
    onError: (error) =>
      toast.error("Could not import team snapshot", {
        description: error.message,
      }),
  });

  return (
    <section className="space-y-3">
      <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold">Teams</h2>
          <p className="text-sm text-muted-foreground">
            Deploy groups of personas with shared instructions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            accept=".team.json,.team.png,application/json,image/png"
            aria-label="Import team snapshot file"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              try {
                setSnapshotImport(await decodeTeamSnapshot(file));
              } catch (error) {
                toast.error("Could not read team snapshot", {
                  description:
                    error instanceof Error ? error.message : "Invalid file.",
                });
              }
            }}
            ref={snapshotInput}
            type="file"
          />
          <Button
            onClick={() => snapshotInput.current?.click()}
            size="sm"
            variant="outline"
          >
            <Upload /> Import snapshot
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            size="sm"
            variant="outline"
          >
            <Plus /> Create team
          </Button>
        </div>
      </header>
      {teams.isLoading ? (
        <p className="py-5 text-sm text-muted-foreground">Loading teams…</p>
      ) : teams.error ? (
        <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">
          Could not load teams.
        </p>
      ) : teams.data?.length ? (
        <div className="divide-y rounded-md border">
          {teams.data.map((team) => (
            <article className="flex items-center gap-3 p-3" key={team.id}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary">
                <Users className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{team.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {team.personaIds.length} persona
                  {team.personaIds.length === 1 ? "" : "s"}
                  {team.description ? ` · ${team.description}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  aria-label={`Deploy ${team.name}`}
                  disabled={!team.personaIds.length}
                  onClick={() => setDeploying(team)}
                  size="icon"
                  title="Deploy team"
                  variant="ghost"
                >
                  <Play />
                </Button>
                <Button
                  aria-label={`Edit ${team.name}`}
                  onClick={() => {
                    setEditing(team);
                    setFormOpen(true);
                  }}
                  size="icon"
                  title="Edit team"
                  variant="ghost"
                >
                  <Pencil />
                </Button>
                <Button
                  aria-label={`Export ${team.name}`}
                  onClick={() => setExporting(team)}
                  size="icon"
                  title="Export team snapshot"
                  variant="ghost"
                >
                  <Download />
                </Button>
                <Button
                  aria-label={`Delete ${team.name}`}
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete ${team.name}?`))
                      remove.mutate(team);
                  }}
                  size="icon"
                  title="Delete team"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No teams yet. Group personas to deploy them together.
        </div>
      )}
      {formOpen ? (
        <TeamDialog
          key={editing?.id ?? "new-team"}
          pending={save.isPending}
          personas={personas.data ?? []}
          team={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSave={async (input) => {
            await save.mutateAsync({ input, team: editing ?? undefined });
          }}
        />
      ) : null}
      {deploying ? (
        <TeamDeployDialog
          agentDefaults={agentDefaults}
          personas={
            snapshotDeployPersonas.length
              ? snapshotDeployPersonas
              : (personas.data ?? [])
          }
          snapshotMemoryByPersona={snapshotMemory}
          team={deploying}
          onClose={() => {
            setDeploying(null);
            setSnapshotDeployPersonas([]);
            setSnapshotMemory({});
          }}
          onDeployed={({ agents, failures }) => {
            queryClient.setQueryData<ManagedAgent[]>(
              ["managed-agents", ownerPubkey],
              (current = []) => [...current, ...agents],
            );
            setDeploying(null);
            setSnapshotDeployPersonas([]);
            setSnapshotMemory({});
            if (agents.length)
              toast.success(
                `${agents.length} team agent${agents.length === 1 ? "" : "s"} created`,
              );
            if (failures.length)
              toast.error(`${failures.length} team agent issues`, {
                description: failures.join("\n"),
              });
          }}
        />
      ) : null}
      {exporting ? (
        <TeamSnapshotExportDialog
          linkedMembers={
            new Set(
              (agents.data ?? [])
                .filter((agent) =>
                  exporting.personaIds.includes(agent.persona_id ?? ""),
                )
                .map((agent) => agent.persona_id),
            ).size
          }
          team={exporting}
          onClose={() => setExporting(null)}
          onExport={async (memoryLevel, format) => {
            try {
              await exportTeamSnapshot(
                exporting,
                personas.data ?? [],
                agents.data ?? [],
                ownerPubkey,
                memoryLevel,
                format,
              );
              toast.success("Team snapshot exported");
            } catch (error) {
              toast.error("Could not export team snapshot", {
                description:
                  error instanceof Error ? error.message : "Export failed.",
              });
              throw error;
            }
          }}
        />
      ) : null}
      {snapshotImport ? (
        <TeamSnapshotImportDialog
          decoded={snapshotImport}
          pending={importSnapshot.isPending}
          onClose={() => setSnapshotImport(null)}
          onImport={(keepAllowlist) => importSnapshot.mutate(keepAllowlist)}
        />
      ) : null}
    </section>
  );
}
