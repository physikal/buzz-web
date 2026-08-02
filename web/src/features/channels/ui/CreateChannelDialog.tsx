import { Hash, LayoutList, Lock, X } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import type { ChannelTemplate } from "@/features/channel-templates/channel-template-api";

export function CreateChannelDialog({
  open,
  pending,
  templates,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  templates: ChannelTemplate[];
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    description: string;
    channelType: "stream" | "forum";
    visibility: "open" | "private";
    templateId?: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [channelType, setChannelType] = useState<"stream" | "forum">("stream");
  const [visibility, setVisibility] = useState<"open" | "private">("open");
  const [templateId, setTemplateId] = useState("");
  useEscapeSurface(open, onClose, pending);
  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    await onSubmit({
      name: name.trim(),
      description: description.trim(),
      channelType,
      visibility,
      templateId: templateId || undefined,
    });
    setName("");
    setDescription("");
    setTemplateId("");
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
        {templates.length ? (
          <label
            className="mt-4 block text-sm font-medium"
            htmlFor="channel-template"
          >
            Template
            <select
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
              disabled={pending}
              id="channel-template"
              value={templateId}
              onChange={(event) => {
                const value = event.target.value;
                setTemplateId(value);
                const template = templates.find((item) => item.id === value);
                if (!template) return;
                setDescription(template.description);
                setChannelType(template.channelType);
                setVisibility(template.visibility);
              }}
            >
              <option value="">No template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Channel type</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <ChoiceButton
              active={channelType === "stream"}
              icon={<Hash />}
              label="Stream"
              description="Continuous conversation"
              onClick={() => setChannelType("stream")}
            />
            <ChoiceButton
              active={channelType === "forum"}
              icon={<LayoutList />}
              label="Forum"
              description="Posts with focused replies"
              onClick={() => setChannelType("forum")}
            />
          </div>
        </fieldset>
        <label className="mt-4 flex items-center justify-between gap-4 rounded-md border p-3 text-sm">
          <span className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Private channel
          </span>
          <input
            checked={visibility === "private"}
            disabled={pending}
            type="checkbox"
            onChange={(event) =>
              setVisibility(event.target.checked ? "private" : "open")
            }
          />
        </label>
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

function ChoiceButton({
  active,
  icon,
  label,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`min-w-0 rounded-md border p-3 text-left ${active ? "border-primary bg-primary/10" : "hover:bg-muted/60"}`}
      onClick={onClick}
      type="button"
    >
      <span className="flex items-center gap-2 text-sm font-medium [&_svg]:h-4 [&_svg]:w-4">
        {icon}
        {label}
      </span>
      <span className="mt-1 block text-xs text-muted-foreground">
        {description}
      </span>
    </button>
  );
}
