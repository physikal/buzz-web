import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Copy,
  FileStack,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { listPersonas } from "@/features/agents/persona-api";
import { listTeams } from "@/features/agents/team-api";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import {
  deleteChannelTemplate,
  listChannelTemplates,
  saveChannelTemplate,
  type ChannelTemplate,
  type ChannelTemplateInput,
} from "../channel-template-api";

export function ChannelTemplatesPanel({
  ownerPubkey,
}: {
  ownerPubkey: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ChannelTemplate | null | undefined>();
  const query = useQuery({
    queryKey: ["channel-templates", ownerPubkey],
    queryFn: () => listChannelTemplates(ownerPubkey),
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["channel-templates", ownerPubkey],
    });
  const save = useMutation({
    mutationFn: ({
      input,
      existing,
    }: {
      input: ChannelTemplateInput;
      existing?: ChannelTemplate;
    }) => saveChannelTemplate(input, existing),
    onSuccess: () => {
      setEditing(undefined);
      void refresh();
      toast.success("Template saved");
    },
    onError: (error) =>
      toast.error("Could not save template", { description: error.message }),
  });
  const remove = useMutation({
    mutationFn: (template: ChannelTemplate) =>
      deleteChannelTemplate(ownerPubkey, template),
    onSuccess: () => {
      void refresh();
      toast.success("Template deleted");
    },
    onError: (error) =>
      toast.error("Could not delete template", { description: error.message }),
  });

  return (
    <section>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Channel templates</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Save reusable channel, canvas, persona, and team configurations.
            Templates are encrypted to your owner key.
          </p>
        </div>
        <Button onClick={() => setEditing(null)} size="sm" variant="outline">
          <Plus /> Create
        </Button>
      </header>
      {query.isLoading ? (
        <p className="py-6 text-sm text-muted-foreground">Loading templates…</p>
      ) : query.error ? (
        <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">
          Could not decrypt channel templates.
        </p>
      ) : query.data?.length ? (
        <div className="divide-y rounded-md border">
          {query.data.map((template) => (
            <article className="flex items-center gap-3 p-3" key={template.id}>
              <FileStack className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{template.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {template.description ||
                    `${template.channelType} · ${template.visibility}`}
                </p>
                <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                  {template.personaIds.length ? (
                    <span className="flex items-center gap-1">
                      <Bot className="h-3 w-3" /> {template.personaIds.length}
                    </span>
                  ) : null}
                  {template.teamIds.length ? (
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" /> {template.teamIds.length}
                    </span>
                  ) : null}
                  {template.canvasTemplate ? <span>Canvas</span> : null}
                </div>
              </div>
              <Button
                aria-label={`Edit ${template.name}`}
                onClick={() => setEditing(template)}
                size="icon"
                title="Edit template"
                variant="ghost"
              >
                <Pencil />
              </Button>
              <Button
                aria-label={`Duplicate ${template.name}`}
                disabled={save.isPending}
                onClick={() =>
                  save.mutate({
                    input: {
                      ...template,
                      name: `${template.name} copy`,
                    },
                  })
                }
                size="icon"
                title="Duplicate template"
                variant="ghost"
              >
                <Copy />
              </Button>
              <Button
                aria-label={`Delete ${template.name}`}
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Delete ${template.name}?`))
                    remove.mutate(template);
                }}
                size="icon"
                title="Delete template"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No templates yet.
        </div>
      )}
      {editing !== undefined ? (
        <TemplateDialog
          existing={editing}
          ownerPubkey={ownerPubkey}
          pending={save.isPending}
          onClose={() => setEditing(undefined)}
          onSubmit={(input) =>
            save.mutate({ input, existing: editing ?? undefined })
          }
        />
      ) : null}
    </section>
  );
}

function TemplateDialog({
  existing,
  ownerPubkey,
  pending,
  onClose,
  onSubmit,
}: {
  existing: ChannelTemplate | null;
  ownerPubkey: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: ChannelTemplateInput) => void;
}) {
  useEscapeSurface(true, onClose, pending);
  const personas = useQuery({
    queryKey: ["agent-personas", ownerPubkey],
    queryFn: () => listPersonas(ownerPubkey),
  });
  const teams = useQuery({
    queryKey: ["agent-teams", ownerPubkey],
    queryFn: () => listTeams(ownerPubkey),
  });
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [channelType, setChannelType] = useState<"stream" | "forum">(
    existing?.channelType ?? "stream",
  );
  const [visibility, setVisibility] = useState<"open" | "private">(
    existing?.visibility ?? "open",
  );
  const [canvasTemplate, setCanvasTemplate] = useState(
    existing?.canvasTemplate ?? "",
  );
  const [personaIds, setPersonaIds] = useState(existing?.personaIds ?? []);
  const [teamIds, setTeamIds] = useState(existing?.teamIds ?? []);
  const toggle = (
    id: string,
    values: string[],
    setValues: (values: string[]) => void,
  ) =>
    setValues(
      values.includes(id)
        ? values.filter((value) => value !== id)
        : [...values, id],
    );
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      name,
      description,
      channelType,
      visibility,
      canvasTemplate,
      personaIds,
      teamIds,
    });
  }
  return (
    <div
      aria-label={existing ? "Edit template" : "Create template"}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <form
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg bg-background shadow-2xl"
        onSubmit={submit}
      >
        <header className="sticky top-0 flex items-start justify-between border-b bg-background px-6 py-5">
          <div>
            <h3 className="text-lg font-semibold">
              {existing ? "Edit template" : "Create template"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Save a reusable channel configuration.
            </p>
          </div>
          <Button
            aria-label="Close"
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        <div className="space-y-5 p-6">
          <Field label="Name" id="template-name">
            <Input
              autoFocus
              id="template-name"
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Description (optional)" id="template-description">
            <textarea
              className="min-h-16 w-full rounded-md border bg-background p-3 text-sm"
              id="template-description"
              maxLength={2000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Channel type" id="template-type">
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                id="template-type"
                value={channelType}
                onChange={(event) =>
                  setChannelType(event.target.value as "stream" | "forum")
                }
              >
                <option value="stream">Stream</option>
                <option value="forum">Forum</option>
              </select>
            </Field>
            <Field label="Visibility" id="template-visibility">
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                id="template-visibility"
                value={visibility}
                onChange={(event) =>
                  setVisibility(event.target.value as "open" | "private")
                }
              >
                <option value="open">Open</option>
                <option value="private">Private</option>
              </select>
            </Field>
          </div>
          <Field label="Canvas template (optional)" id="template-canvas">
            <textarea
              className="min-h-28 w-full rounded-md border bg-background p-3 font-mono text-xs"
              id="template-canvas"
              maxLength={128 * 1024}
              placeholder="# {channel.name}"
              value={canvasTemplate}
              onChange={(event) => setCanvasTemplate(event.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Supports {"{channel.name}"} and {"{template.name}"}.
            </p>
          </Field>
          <Selector
            title="Agent personas"
            entries={(personas.data ?? []).map((persona) => ({
              id: persona.id,
              name: persona.displayName,
            }))}
            selected={personaIds}
            onToggle={(id) => toggle(id, personaIds, setPersonaIds)}
          />
          <Selector
            title="Agent teams"
            entries={(teams.data ?? []).map((team) => ({
              id: team.id,
              name: team.name,
            }))}
            selected={teamIds}
            onToggle={(id) => toggle(id, teamIds, setTeamIds)}
          />
        </div>
        <footer className="sticky bottom-0 flex justify-end gap-2 border-t bg-background px-6 py-4">
          <Button
            disabled={pending}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={pending || !name.trim()} type="submit">
            {pending ? "Saving…" : "Save"}
          </Button>
        </footer>
      </form>
    </div>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-medium" htmlFor={id}>
      {label}
      <div className="mt-2">{children}</div>
    </label>
  );
}

function Selector({
  title,
  entries,
  selected,
  onToggle,
}: {
  title: string;
  entries: Array<{ id: string; name: string }>;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{title}</legend>
      {entries.length ? (
        <div className="mt-2 max-h-36 divide-y overflow-y-auto rounded-md border">
          {entries.map((entry) => (
            <label
              className="flex items-center gap-3 p-3 text-sm"
              key={entry.id}
            >
              <input
                checked={selected.includes(entry.id)}
                type="checkbox"
                onChange={() => onToggle(entry.id)}
              />
              {entry.name}
            </label>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">None configured.</p>
      )}
    </fieldset>
  );
}
