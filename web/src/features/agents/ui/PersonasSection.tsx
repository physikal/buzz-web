import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Copy,
  Download,
  Globe2,
  Library,
  LockKeyhole,
  Pencil,
  Play,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { DestructiveConfirmDialog } from "@/shared/ui/destructive-confirm-dialog";
import {
  decodeAgentSnapshot,
  type DecodedAgentSnapshot,
  exportAgentSnapshot,
  snapshotPersonaInput,
} from "../agent-snapshot";
import {
  deletePersonaCascade,
  type AgentPersona,
  listPersonas,
  type PersonaInput,
  savePersona,
} from "../persona-api";
import type { ManagedAgent } from "../agent-api";
import { listTeams } from "../team-api";
import { runtimeDisplayName } from "../runtime-catalog";
import { PersonaDialog } from "./PersonaDialog";
import {
  catalogPersonaInput,
  type CatalogPersona,
  listPersonaCatalog,
} from "../persona-catalog-api";
import { PersonaCatalogDialog } from "./PersonaCatalogDialog";
import { AgentSnapshotExportDialog } from "./AgentSnapshotExportDialog";
import { AgentSnapshotImportDialog } from "./AgentSnapshotImportDialog";

export function PersonasSection({
  agents,
  ownerPubkey,
  onDeploy,
}: {
  agents: ManagedAgent[];
  ownerPubkey: string;
  onDeploy: (
    persona: AgentPersona,
    memory?: Array<{ slug: string; body: string }>,
  ) => void;
}) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AgentPersona | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [personaToDelete, setPersonaToDelete] = useState<AgentPersona | null>(
    null,
  );
  const [exporting, setExporting] = useState<AgentPersona | null>(null);
  const [snapshotImport, setSnapshotImport] =
    useState<DecodedAgentSnapshot | null>(null);
  const snapshotInput = useRef<HTMLInputElement>(null);
  const query = useQuery({
    queryKey: ["agent-personas", ownerPubkey],
    queryFn: () => listPersonas(ownerPubkey),
    staleTime: 30_000,
  });
  const catalog = useQuery({
    queryKey: ["persona-catalog", ownerPubkey],
    queryFn: () => listPersonaCatalog(ownerPubkey),
    enabled: catalogOpen,
    staleTime: 30_000,
  });
  const teams = useQuery({
    queryKey: ["agent-teams", ownerPubkey],
    queryFn: () => listTeams(ownerPubkey),
    staleTime: 30_000,
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["agent-personas", ownerPubkey],
    });
  const save = useMutation({
    mutationFn: ({
      input,
      persona,
    }: {
      input: PersonaInput;
      persona?: AgentPersona;
    }) => savePersona(input, persona),
    onSuccess: () => {
      setDialogOpen(false);
      setEditing(null);
      void refresh();
      toast.success("Persona saved");
    },
    onError: (error) =>
      toast.error("Could not save persona", { description: error.message }),
  });
  const remove = useMutation({
    mutationFn: async (persona: AgentPersona) => {
      const referencingTeam = teams.data?.find((team) =>
        team.personaIds.includes(persona.id),
      );
      if (referencingTeam) {
        throw new Error(
          `${persona.displayName} is used by the team ${referencingTeam.name}. Remove it from that team first.`,
        );
      }
      if (teams.error) {
        throw new Error("Could not verify whether a team uses this persona.");
      }
      await deletePersonaCascade(
        ownerPubkey,
        persona,
        agents.filter((agent) => agent.persona_id === persona.id),
      );
    },
    onSuccess: () => {
      setPersonaToDelete(null);
      void refresh();
      void queryClient.invalidateQueries({
        queryKey: ["managed-agents", ownerPubkey],
      });
      toast.success("Persona deleted");
    },
    onError: (error) => {
      void queryClient.invalidateQueries({
        queryKey: ["managed-agents", ownerPubkey],
      });
      toast.error("Could not delete persona", { description: error.message });
    },
  });
  const importPersona = useMutation({
    mutationFn: (persona: CatalogPersona) =>
      savePersona(catalogPersonaInput(persona)),
    onSuccess: () => {
      void refresh();
      toast.success("Persona added");
    },
    onError: (error) =>
      toast.error("Could not add persona", { description: error.message }),
  });
  const importSnapshot = useMutation({
    mutationFn: (keepAllowlist: boolean) => {
      if (!snapshotImport) throw new Error("Choose an agent snapshot.");
      return savePersona(
        snapshotPersonaInput(snapshotImport.snapshot, keepAllowlist),
      );
    },
    onSuccess: (persona) => {
      const memory = snapshotImport?.snapshot.memory.entries ?? [];
      setSnapshotImport(null);
      void refresh();
      toast.success("Agent snapshot imported");
      onDeploy(persona, memory);
    },
    onError: (error) =>
      toast.error("Could not import snapshot", { description: error.message }),
  });

  return (
    <section className="space-y-3">
      <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold">Personas</h2>
          <p className="text-sm text-muted-foreground">
            Reusable agent definitions synced through your relay.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            accept=".agent.json,.agent.png,application/json,image/png"
            aria-label="Import agent snapshot file"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              try {
                setSnapshotImport(await decodeAgentSnapshot(file));
              } catch (error) {
                toast.error("Could not read snapshot", {
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
            onClick={() => setCatalogOpen(true)}
            size="sm"
            variant="outline"
          >
            <Library /> Agent catalog
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            size="sm"
            variant="outline"
          >
            <Plus /> Create persona
          </Button>
        </div>
      </header>
      {query.isLoading ? (
        <p className="py-5 text-sm text-muted-foreground">Loading personas…</p>
      ) : query.error ? (
        <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">
          Could not load personas.
        </p>
      ) : query.data?.length ? (
        <div className="divide-y rounded-md border">
          {query.data.map((persona) => (
            <article className="flex items-center gap-3 p-3" key={persona.id}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary">
                {persona.avatarUrl ? (
                  <img
                    alt=""
                    className="h-full w-full object-cover"
                    src={persona.avatarUrl}
                  />
                ) : (
                  <Bot className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">
                    {persona.displayName}
                  </p>
                  <Badge variant="outline">
                    {persona.shared ? (
                      <Globe2 className="h-3 w-3" />
                    ) : (
                      <LockKeyhole className="h-3 w-3" />
                    )}
                    {persona.shared ? "Shared" : "Private"}
                  </Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {persona.model || runtimeLabel(persona.runtime)}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  aria-label={`Deploy ${persona.displayName}`}
                  onClick={() => onDeploy(persona)}
                  size="icon"
                  title="Deploy persona"
                  variant="ghost"
                >
                  <Play />
                </Button>
                <Button
                  aria-label={`Edit ${persona.displayName}`}
                  onClick={() => {
                    setEditing(persona);
                    setDialogOpen(true);
                  }}
                  size="icon"
                  title="Edit persona"
                  variant="ghost"
                >
                  <Pencil />
                </Button>
                <Button
                  aria-label={`Export ${persona.displayName}`}
                  onClick={() => setExporting(persona)}
                  size="icon"
                  title="Export snapshot"
                  variant="ghost"
                >
                  <Download />
                </Button>
                <Button
                  aria-label={`Duplicate ${persona.displayName}`}
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate({
                      input: {
                        ...persona,
                        displayName: `${persona.displayName} copy`,
                        catalogSource: null,
                      },
                    })
                  }
                  size="icon"
                  title="Duplicate persona"
                  variant="ghost"
                >
                  <Copy />
                </Button>
                <Button
                  aria-label={`Delete ${persona.displayName}`}
                  disabled={remove.isPending || teams.isLoading}
                  onClick={() => setPersonaToDelete(persona)}
                  size="icon"
                  title="Delete persona"
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
          No personas yet. Create one to reuse an agent configuration.
        </div>
      )}
      {dialogOpen ? (
        <PersonaDialog
          key={editing?.id ?? "new-persona"}
          pending={save.isPending}
          persona={editing}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
          onSave={(input) =>
            save.mutateAsync({ input, persona: editing ?? undefined })
          }
        />
      ) : null}
      {catalogOpen ? (
        <PersonaCatalogDialog
          catalog={catalog.data ?? []}
          error={catalog.error?.message ?? null}
          importing={importPersona.isPending}
          loading={catalog.isLoading}
          localPersonas={query.data ?? []}
          onClose={() => setCatalogOpen(false)}
          onImport={(persona) => importPersona.mutate(persona)}
        />
      ) : null}
      {exporting ? (
        <AgentSnapshotExportDialog
          name={exporting.displayName}
          onClose={() => setExporting(null)}
          onExport={async (format) => {
            try {
              await exportAgentSnapshot(exporting, format);
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
      {snapshotImport ? (
        <AgentSnapshotImportDialog
          decoded={snapshotImport}
          pending={importSnapshot.isPending}
          onClose={() => setSnapshotImport(null)}
          onImport={(keepAllowlist) => importSnapshot.mutate(keepAllowlist)}
        />
      ) : null}
      <DestructiveConfirmDialog
        confirmLabel="Delete"
        description={personaDeleteDescription(
          personaToDelete,
          agents.filter((agent) => agent.persona_id === personaToDelete?.id)
            .length,
        )}
        onClose={() => setPersonaToDelete(null)}
        onConfirm={() => {
          if (personaToDelete) remove.mutate(personaToDelete);
        }}
        open={personaToDelete !== null}
        pending={remove.isPending}
        pendingLabel="Deleting..."
        title="Delete agent?"
      />
    </section>
  );
}

function personaDeleteDescription(
  persona: AgentPersona | null,
  instanceCount: number,
) {
  if (!persona) return "Delete this agent.";
  if (instanceCount === 0) return `Delete ${persona.displayName}.`;
  const cascade =
    instanceCount === 1
      ? "Also deletes 1 hosted agent instance and removes its relay membership, so it no longer appears in member lists or mention suggestions."
      : `Also deletes ${instanceCount} hosted agent instances and removes their relay memberships, so they no longer appear in member lists or mention suggestions.`;
  return `Delete ${persona.displayName}. ${cascade}`;
}

function runtimeLabel(runtime: AgentPersona["runtime"]) {
  return runtime
    ? runtimeDisplayName(runtime)
    : "Choose a harness when deploying";
}
