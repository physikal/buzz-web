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
import {
  decodeAgentSnapshot,
  type DecodedAgentSnapshot,
  exportAgentSnapshot,
  snapshotPersonaInput,
} from "../agent-snapshot";
import {
  deletePersona,
  type AgentPersona,
  listPersonas,
  type PersonaInput,
  savePersona,
} from "../persona-api";
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
  ownerPubkey,
  onDeploy,
}: {
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
    mutationFn: (persona: AgentPersona) => deletePersona(ownerPubkey, persona),
    onSuccess: () => {
      void refresh();
      toast.success("Persona deleted");
    },
    onError: (error) =>
      toast.error("Could not delete persona", { description: error.message }),
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
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete ${persona.displayName}?`))
                      remove.mutate(persona);
                  }}
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
    </section>
  );
}

function runtimeLabel(runtime: AgentPersona["runtime"]) {
  if (runtime === "codex") return "Codex";
  if (runtime === "claude") return "Claude Code";
  if (runtime === "buzz-agent") return "Buzz Agent";
  return "Choose a harness when deploying";
}
