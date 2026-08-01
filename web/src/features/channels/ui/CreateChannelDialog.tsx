import { X } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export function CreateChannelDialog({
  open,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; description: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    await onSubmit({ name: name.trim(), description: description.trim() });
    setName("");
    setDescription("");
  }

  return (
    <div
      aria-label="Create channel"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !pending) onClose();
      }}
    >
      <form
        className="w-full max-w-md rounded-lg bg-background p-6 shadow-2xl"
        onSubmit={submit}
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Create channel</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Start a shared conversation.
            </p>
          </div>
          <Button
            aria-label="Close"
            disabled={pending}
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        <label
          className="mt-5 block text-sm font-medium"
          htmlFor="channel-name"
        >
          Channel name
        </label>
        <Input
          autoFocus
          className="mt-2"
          disabled={pending}
          id="channel-name"
          maxLength={80}
          placeholder="project-alpha"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <label
          className="mt-4 block text-sm font-medium"
          htmlFor="channel-description"
        >
          Description
        </label>
        <textarea
          className="mt-2 min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          disabled={pending}
          id="channel-description"
          maxLength={500}
          placeholder="What is this channel for?"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <div className="mt-6 flex justify-end gap-2">
          <Button
            disabled={pending}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={pending || !name.trim()} type="submit">
            {pending ? "Creating…" : "Create channel"}
          </Button>
        </div>
      </form>
    </div>
  );
}
