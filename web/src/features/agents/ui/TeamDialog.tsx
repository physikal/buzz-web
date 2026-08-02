import { X } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import type { AgentPersona } from "../persona-api";
import { runtimeDisplayName } from "../runtime-catalog";
import type { AgentTeam, TeamInput } from "../team-api";

export function TeamDialog({
  personas,
  pending,
  team,
  onClose,
  onSave,
}: {
  personas: AgentPersona[];
  pending: boolean;
  team: AgentTeam | null;
  onClose: () => void;
  onSave: (input: TeamInput) => Promise<void>;
}) {
  const [name, setName] = useState(team?.name ?? "");
  const [description, setDescription] = useState(team?.description ?? "");
  const [instructions, setInstructions] = useState(team?.instructions ?? "");
  const [personaIds, setPersonaIds] = useState<string[]>(
    team?.personaIds ?? [],
  );
  useEscapeSurface(true, onClose, pending);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    await onSave({
      name: name.trim(),
      description: description.trim() || null,
      instructions: instructions.trim() || null,
      personaIds,
    });
  }

  return (
    <div
      aria-label={team ? "Edit team" : "Create team"}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-background shadow-2xl">
        <header className="flex items-start justify-between border-b px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold">
              {team ? `Edit ${team.name}` : "Create team"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Group personas that should work together.
            </p>
          </div>
          <Button
            aria-label="Close"
            disabled={pending}
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        <form
          className="space-y-5 overflow-y-auto p-6"
          id="team-form"
          onSubmit={submit}
        >
          <Field label="Team name">
            <Input
              aria-label="Team name"
              autoFocus
              onChange={(event) => setName(event.target.value)}
              placeholder="Engineering"
              value={name}
            />
          </Field>
          <Field label="Description">
            <Input
              aria-label="Team description"
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this team is responsible for"
              value={description}
            />
          </Field>
          <Field label="Team instructions">
            <textarea
              aria-label="Team instructions"
              className="min-h-24 w-full rounded-md border bg-background p-3 text-sm"
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Shared context applied to every deployed member"
              value={instructions}
            />
          </Field>
          <Field label="Personas">
            {personas.length ? (
              <div className="divide-y rounded-md border">
                {personas.map((persona) => (
                  <label
                    className="flex items-center gap-3 p-3 text-sm"
                    key={persona.id}
                  >
                    <input
                      checked={personaIds.includes(persona.id)}
                      onChange={(event) =>
                        setPersonaIds((current) =>
                          event.target.checked
                            ? [...current, persona.id]
                            : current.filter((id) => id !== persona.id),
                        )
                      }
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {persona.displayName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {persona.runtime
                        ? runtimeDisplayName(persona.runtime)
                        : "No harness"}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Create a persona before building a team.
              </p>
            )}
          </Field>
        </form>
        <footer className="flex justify-end gap-2 border-t px-6 py-4">
          <Button disabled={pending} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={pending || !name.trim()}
            form="team-form"
            type="submit"
          >
            {pending ? "Saving…" : "Save team"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      {children}
    </div>
  );
}
