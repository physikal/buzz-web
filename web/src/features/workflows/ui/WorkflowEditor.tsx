import { Code2, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import type { Channel } from "@/features/channels/channel-api";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  ACTION_LABELS,
  blankStep,
  blankWorkflow,
  TRIGGER_LABELS,
  WORKFLOW_ACTIONS,
  WORKFLOW_TRIGGERS,
  type WorkflowDefinition,
  type WorkflowStep,
} from "../workflow-types";
import { parseWorkflowYaml, workflowToYaml } from "../workflow-api";

export function WorkflowEditor({
  channels,
  initialChannelId,
  initialYaml,
  pending,
  onCancel,
  onSave,
}: {
  channels: Channel[];
  initialChannelId: string;
  initialYaml?: string;
  pending: boolean;
  onCancel: () => void;
  onSave: (value: { channelId: string; yaml: string }) => Promise<void>;
}) {
  const initial = useMemo(() => {
    if (!initialYaml) return blankWorkflow();
    try {
      return parseWorkflowYaml(initialYaml);
    } catch {
      return blankWorkflow();
    }
  }, [initialYaml]);
  const [definition, setDefinition] = useState(initial);
  const [channelId, setChannelId] = useState(initialChannelId);
  const [raw, setRaw] = useState(initialYaml ?? workflowToYaml(initial));
  const [mode, setMode] = useState<"form" | "yaml">("form");
  const [error, setError] = useState<string | null>(null);

  const update = (next: WorkflowDefinition) => {
    setDefinition(next);
    setRaw(workflowToYaml(next));
    setError(null);
  };
  const toggleMode = () => {
    if (mode === "yaml") {
      try {
        const next = parseWorkflowYaml(raw);
        setDefinition(next);
        setMode("form");
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Invalid YAML");
      }
    } else {
      setMode("yaml");
      setError(null);
    }
  };
  const submit = async () => {
    try {
      parseWorkflowYaml(raw);
      if (!channelId) throw new Error("Choose a channel.");
      setError(null);
      await onSave({ channelId, yaml: raw });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invalid workflow");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <label className="min-w-0 flex-1 text-sm font-medium">
          Channel
          <select
            aria-label="Workflow channel"
            className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
            disabled={pending}
            onChange={(event) => setChannelId(event.target.value)}
            value={channelId}
          >
            <option value="">Choose a channel</option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          className="mt-6"
          onClick={toggleMode}
          type="button"
          variant="ghost"
        >
          <Code2 /> {mode === "form" ? "Edit YAML" : "Use form"}
        </Button>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {mode === "yaml" ? (
        <label className="block text-sm font-medium">
          Definition
          <textarea
            aria-label="Workflow YAML"
            className="mt-2 min-h-96 w-full resize-y rounded-md border bg-background p-3 font-mono text-xs"
            disabled={pending}
            onChange={(event) => setRaw(event.target.value)}
            spellCheck={false}
            value={raw}
          />
        </label>
      ) : (
        <VisualEditor
          definition={definition}
          disabled={pending}
          onChange={update}
        />
      )}

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button
          disabled={pending}
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          disabled={pending || !channelId}
          onClick={() => void submit()}
          type="button"
        >
          {pending ? "Saving..." : "Save workflow"}
        </Button>
      </div>
    </div>
  );
}

function VisualEditor({
  definition,
  disabled,
  onChange,
}: {
  definition: WorkflowDefinition;
  disabled: boolean;
  onChange: (value: WorkflowDefinition) => void;
}) {
  const updateStep = (index: number, step: WorkflowStep) => {
    const steps = [...definition.steps];
    steps[index] = step;
    onChange({ ...definition, steps });
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Workflow name">
          <Input
            aria-label="Workflow name"
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...definition, name: event.target.value })
            }
            placeholder="Deploy notifier"
            value={definition.name}
          />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            checked={definition.enabled !== false}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...definition, enabled: event.target.checked })
            }
            type="checkbox"
          />
          Workflow is enabled
        </label>
      </div>
      <Field label="Description">
        <textarea
          className="min-h-20 w-full rounded-md border bg-background p-3 text-sm"
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...definition, description: event.target.value })
          }
          value={definition.description ?? ""}
        />
      </Field>
      <div className="space-y-3 rounded-md border p-4">
        <h3 className="font-medium">Trigger</h3>
        <Field label="Event">
          <select
            aria-label="Workflow trigger"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...definition,
                trigger: {
                  on: event.target.value as WorkflowDefinition["trigger"]["on"],
                },
              })
            }
            value={definition.trigger.on}
          >
            {WORKFLOW_TRIGGERS.map((trigger) => (
              <option key={trigger} value={trigger}>
                {TRIGGER_LABELS[trigger]}
              </option>
            ))}
          </select>
        </Field>
        <TriggerFields
          definition={definition}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium">Steps</h3>
          <Button
            disabled={disabled}
            onClick={() =>
              onChange({
                ...definition,
                steps: [
                  ...definition.steps,
                  blankStep(definition.steps.length),
                ],
              })
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus /> Add step
          </Button>
        </div>
        <div className="space-y-3">
          {definition.steps.map((step, index) => (
            <StepEditor
              disabled={disabled}
              index={index}
              key={step.id}
              onChange={(next) => updateStep(index, next)}
              onRemove={() =>
                onChange({
                  ...definition,
                  steps: definition.steps.filter((_, value) => value !== index),
                })
              }
              step={step}
            />
          ))}
          {!definition.steps.length ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Add a step to define what the workflow does.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function TriggerFields({
  definition,
  disabled,
  onChange,
}: {
  definition: WorkflowDefinition;
  disabled: boolean;
  onChange: (value: WorkflowDefinition) => void;
}) {
  const set = (patch: Partial<WorkflowDefinition["trigger"]>) =>
    onChange({ ...definition, trigger: { ...definition.trigger, ...patch } });
  if (["message_posted", "diff_posted"].includes(definition.trigger.on))
    return (
      <Field label="Filter expression (optional)">
        <Input
          disabled={disabled}
          onChange={(e) => set({ filter: e.target.value })}
          placeholder={'contains(text, "deploy")'}
          value={definition.trigger.filter ?? ""}
        />
      </Field>
    );
  if (definition.trigger.on === "reaction_added")
    return (
      <Field label="Emoji (optional)">
        <Input
          disabled={disabled}
          onChange={(e) => set({ emoji: e.target.value })}
          placeholder="thumbsup"
          value={definition.trigger.emoji ?? ""}
        />
      </Field>
    );
  if (definition.trigger.on === "schedule")
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cron expression">
          <Input
            disabled={disabled}
            onChange={(e) => set({ cron: e.target.value })}
            placeholder="0 9 * * 1-5"
            value={definition.trigger.cron ?? ""}
          />
        </Field>
        <Field label="Interval">
          <Input
            disabled={disabled}
            onChange={(e) => set({ interval: e.target.value })}
            placeholder="1h"
            value={definition.trigger.interval ?? ""}
          />
        </Field>
      </div>
    );
  if (definition.trigger.on === "webhook")
    return (
      <p className="text-xs text-muted-foreground">
        The relay generates a webhook URL and one-time secret when this workflow
        is created.
      </p>
    );
  return null;
}

function StepEditor({
  step,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  step: WorkflowStep;
  index: number;
  disabled: boolean;
  onChange: (step: WorkflowStep) => void;
  onRemove: () => void;
}) {
  const field = (name: keyof WorkflowStep, value: unknown) =>
    onChange({ ...step, [name]: value || undefined });
  return (
    <article className="space-y-3 rounded-md border p-4">
      <header className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Step {index + 1}</h4>
        <Button
          aria-label={`Remove step ${index + 1}`}
          disabled={disabled}
          onClick={onRemove}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Trash2 />
        </Button>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Step ID">
          <Input
            disabled={disabled}
            onChange={(e) => field("id", e.target.value)}
            value={step.id}
          />
        </Field>
        <Field label="Action">
          <select
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            disabled={disabled}
            onChange={(e) =>
              onChange({
                id: step.id,
                action: e.target.value as WorkflowStep["action"],
              })
            }
            value={step.action}
          >
            {WORKFLOW_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {ACTION_LABELS[action]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label (optional)">
          <Input
            disabled={disabled}
            onChange={(e) => field("name", e.target.value)}
            value={step.name ?? ""}
          />
        </Field>
        <Field label="Condition (optional)">
          <Input
            disabled={disabled}
            onChange={(e) => field("if", e.target.value)}
            placeholder="trigger.author == ..."
            value={step.if ?? ""}
          />
        </Field>
        <Field label="Timeout seconds (optional)">
          <Input
            disabled={disabled}
            inputMode="numeric"
            min="1"
            onChange={(event) =>
              field(
                "timeout_secs",
                /^\d+$/.test(event.target.value)
                  ? Number(event.target.value)
                  : undefined,
              )
            }
            type="number"
            value={step.timeout_secs ?? ""}
          />
        </Field>
      </div>
      <ActionFields disabled={disabled} field={field} step={step} />
    </article>
  );
}

function ActionFields({
  step,
  disabled,
  field,
}: {
  step: WorkflowStep;
  disabled: boolean;
  field: (name: keyof WorkflowStep, value: unknown) => void;
}) {
  switch (step.action) {
    case "delay":
      return (
        <Field label="Duration">
          <Input
            disabled={disabled}
            onChange={(e) => field("duration", e.target.value)}
            placeholder="5s"
            value={step.duration ?? ""}
          />
        </Field>
      );
    case "send_message":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Message">
            <Input
              disabled={disabled}
              onChange={(e) => field("text", e.target.value)}
              value={step.text ?? ""}
            />
          </Field>
          <Field label="Channel override (optional)">
            <Input
              disabled={disabled}
              onChange={(e) => field("channel", e.target.value)}
              value={step.channel ?? ""}
            />
          </Field>
        </div>
      );
    case "send_dm":
      return (
        <div className="space-y-3">
          <UnsupportedNote text="The relay does not execute send-DM steps yet; a run will fail at this step." />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Recipient pubkey">
              <Input
                disabled={disabled}
                onChange={(e) => field("to", e.target.value)}
                value={step.to ?? ""}
              />
            </Field>
            <Field label="Message">
              <Input
                disabled={disabled}
                onChange={(e) => field("text", e.target.value)}
                value={step.text ?? ""}
              />
            </Field>
          </div>
        </div>
      );
    case "call_webhook":
      return (
        <div className="space-y-3">
          <p className="text-xs text-amber-700">
            Webhook actions require a channel owner or admin role.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="HTTPS URL">
              <Input
                disabled={disabled}
                onChange={(e) => field("url", e.target.value)}
                value={step.url ?? ""}
              />
            </Field>
            <Field label="Method">
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                disabled={disabled}
                onChange={(e) => field("method", e.target.value)}
                value={step.method ?? "POST"}
              >
                {["POST", "GET", "PUT", "PATCH", "DELETE"].map((method) => (
                  <option key={method}>{method}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Body (optional)">
            <textarea
              className="min-h-20 w-full rounded-md border bg-background p-3 font-mono text-xs"
              disabled={disabled}
              onChange={(e) => field("body", e.target.value)}
              value={step.body ?? ""}
            />
          </Field>
          <HeaderEditor
            disabled={disabled}
            headers={step.headers ?? {}}
            onChange={(headers) => field("headers", headers)}
          />
        </div>
      );
    case "request_approval":
      return (
        <div className="space-y-3">
          <UnsupportedNote text="Approval gates are not executed by the relay yet; a run will stop at this step." />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Approver">
              <Input
                disabled={disabled}
                onChange={(e) => field("from", e.target.value)}
                value={step.from ?? ""}
              />
            </Field>
            <Field label="Message">
              <Input
                disabled={disabled}
                onChange={(e) => field("message", e.target.value)}
                value={step.message ?? ""}
              />
            </Field>
            <Field label="Timeout">
              <Input
                disabled={disabled}
                onChange={(e) => field("timeout", e.target.value)}
                value={step.timeout ?? ""}
              />
            </Field>
          </div>
        </div>
      );
    case "add_reaction":
      return (
        <Field label="Emoji">
          <Input
            disabled={disabled}
            onChange={(e) => field("emoji", e.target.value)}
            value={step.emoji ?? ""}
          />
        </Field>
      );
    case "set_channel_topic":
      return (
        <div className="space-y-3">
          <UnsupportedNote text="The relay does not execute set-topic steps yet; a run will fail at this step." />
          <Field label="Topic">
            <Input
              disabled={disabled}
              onChange={(e) => field("topic", e.target.value)}
              value={step.topic ?? ""}
            />
          </Field>
        </div>
      );
  }
}

function HeaderEditor({
  headers,
  disabled,
  onChange,
}: {
  headers: Record<string, string>;
  disabled: boolean;
  onChange: (headers: Record<string, string>) => void;
}) {
  const entries = Object.entries(headers);
  const replace = (index: number, key: string, value: string) => {
    const next = [...entries];
    next[index] = [key, value];
    onChange(Object.fromEntries(next.filter(([name]) => name.trim())));
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">Headers (optional)</p>
        <Button
          disabled={disabled}
          onClick={() => {
            let index = entries.length + 1;
            while (headers[`Header-${index}`] !== undefined) index += 1;
            onChange({ ...headers, [`Header-${index}`]: "" });
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Plus /> Add header
        </Button>
      </div>
      <div className="space-y-2">
        {entries.map(([key, value], index) => (
          <HeaderRow
            disabled={disabled}
            index={index}
            key={key}
            name={key}
            onNameChange={(name) => replace(index, name, value)}
            onRemove={() =>
              onChange(
                Object.fromEntries(
                  entries.filter((_, entryIndex) => entryIndex !== index),
                ),
              )
            }
            onValueChange={(nextValue) => replace(index, key, nextValue)}
            value={value}
          />
        ))}
      </div>
    </div>
  );
}

function HeaderRow({
  name,
  value,
  index,
  disabled,
  onNameChange,
  onValueChange,
  onRemove,
}: {
  name: string;
  value: string;
  index: number;
  disabled: boolean;
  onNameChange: (name: string) => void;
  onValueChange: (value: string) => void;
  onRemove: () => void;
}) {
  const [draftName, setDraftName] = useState(name);
  return (
    <div className="flex gap-2">
      <Input
        aria-label={`Header ${index + 1} name`}
        disabled={disabled}
        onBlur={() => onNameChange(draftName)}
        onChange={(event) => setDraftName(event.target.value)}
        value={draftName}
      />
      <Input
        aria-label={`Header ${index + 1} value`}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
        value={value}
      />
      <Button
        aria-label={`Remove header ${index + 1}`}
        disabled={disabled}
        onClick={onRemove}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function UnsupportedNote({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700">
      {text}
    </p>
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
    <div className="block text-sm font-medium">
      <p>{label}</p>
      <span className="mt-2 block">{children}</span>
    </div>
  );
}
