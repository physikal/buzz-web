import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Play, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import type { ManagedAgent } from "../agent-api";
import { listPersonas } from "../persona-api";
import {
  deleteTeam,
  type AgentTeam,
  listTeams,
  saveTeam,
  type TeamInput,
} from "../team-api";
import { TeamDeployDialog } from "./TeamDeployDialog";
import { TeamDialog } from "./TeamDialog";

export function TeamsSection({ ownerPubkey }: { ownerPubkey: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AgentTeam | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deploying, setDeploying] = useState<AgentTeam | null>(null);
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

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Teams</h2>
          <p className="text-sm text-muted-foreground">
            Deploy groups of personas with shared instructions.
          </p>
        </div>
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
          onSave={(input) =>
            save.mutateAsync({ input, team: editing ?? undefined })
          }
        />
      ) : null}
      {deploying ? (
        <TeamDeployDialog
          personas={personas.data ?? []}
          team={deploying}
          onClose={() => setDeploying(null)}
          onDeployed={({ agents, failures }) => {
            queryClient.setQueryData<ManagedAgent[]>(
              ["managed-agents", ownerPubkey],
              (current = []) => [...current, ...agents],
            );
            setDeploying(null);
            if (agents.length)
              toast.success(
                `${agents.length} team agent${agents.length === 1 ? "" : "s"} created`,
              );
            if (failures.length)
              toast.error(`${failures.length} agent deployments failed`, {
                description: failures.join("\n"),
              });
          }}
        />
      ) : null}
    </section>
  );
}
