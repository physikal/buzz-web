import { parse, stringify } from "yaml";

import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  WORKFLOW_ACTIONS,
  WORKFLOW_TRIGGERS,
  type WorkflowDefinition,
} from "./workflow-types";

export type Workflow = {
  id: string;
  channelId: string;
  owner: string;
  yaml: string;
  definition: WorkflowDefinition;
  createdAt: number;
  updatedAt: number;
};

export type WorkflowSave = {
  workflowId: string;
  webhookSecret: string | null;
};

function tag(event: NostrEvent, name: string) {
  return event.tags.find((value) => value[0] === name)?.[1];
}

export function parseWorkflowYaml(yaml: string): WorkflowDefinition {
  const value = parse(yaml) as Partial<WorkflowDefinition> | null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Workflow YAML must contain an object.");
  if (!value.name?.trim()) throw new Error("Workflow name is required.");
  if (!value.trigger || !WORKFLOW_TRIGGERS.includes(value.trigger.on as never))
    throw new Error("Choose a supported workflow trigger.");
  if (!Array.isArray(value.steps))
    throw new Error("Workflow steps must be a list.");
  const stepIds = new Set<string>();
  for (const [index, step] of value.steps.entries()) {
    if (!step?.id?.trim()) throw new Error(`Step ${index + 1} needs an ID.`);
    if (stepIds.has(step.id))
      throw new Error(`Step ID "${step.id}" is duplicated.`);
    stepIds.add(step.id);
    if (!WORKFLOW_ACTIONS.includes(step.action as never))
      throw new Error(`Step ${index + 1} uses an unsupported action.`);
  }
  return value as WorkflowDefinition;
}

export function workflowToYaml(definition: WorkflowDefinition) {
  return stringify(definition, { lineWidth: 0 });
}

function eventToWorkflow(event: NostrEvent): Workflow | null {
  const id = tag(event, "d");
  const channelId = tag(event, "h");
  if (!id || !channelId) return null;
  try {
    return {
      id,
      channelId,
      owner: event.pubkey,
      yaml: event.content,
      definition: parseWorkflowYaml(event.content),
      createdAt: event.created_at,
      updatedAt: event.created_at,
    };
  } catch {
    return null;
  }
}

export async function listWorkflows(channelIds: string[]) {
  if (!channelIds.length) return [];
  const events = await queryEvents(
    relayWsUrl(),
    [
      { kinds: [30620], "#h": channelIds, limit: 1000 },
      { kinds: [5], limit: 2000 },
    ],
    { requireNip07: true },
  );
  const latest = new Map<string, NostrEvent>();
  for (const event of events.filter((value) => value.kind === 30620)) {
    const id = tag(event, "d");
    if (!id) continue;
    const key = `${event.pubkey}:${id}`;
    if ((latest.get(key)?.created_at ?? 0) < event.created_at)
      latest.set(key, event);
  }
  const deleted = new Set<string>();
  for (const event of events.filter((value) => value.kind === 5)) {
    for (const value of event.tags) {
      if (value[0] === "a" && value[1]?.startsWith("30620:"))
        deleted.add(`${event.pubkey}:${value[1]}`);
    }
  }
  return [...latest.values()]
    .filter((event) => {
      const id = tag(event, "d");
      return id && !deleted.has(`${event.pubkey}:30620:${event.pubkey}:${id}`);
    })
    .map(eventToWorkflow)
    .filter((value): value is Workflow => value !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function responseObject(message: string | undefined) {
  if (!message?.startsWith("response:")) return {};
  try {
    return JSON.parse(message.slice("response:".length)) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

export async function saveWorkflow(input: {
  id?: string;
  channelId: string;
  yaml: string;
}): Promise<WorkflowSave> {
  parseWorkflowYaml(input.yaml);
  const id = input.id ?? crypto.randomUUID();
  const { receipt } = await submitEvent({
    kind: 30620,
    content: input.yaml,
    tags: [
      ["d", id],
      ["h", input.channelId],
    ],
  });
  const response = responseObject(receipt.message);
  return {
    workflowId:
      typeof response.workflow_id === "string" ? response.workflow_id : id,
    webhookSecret:
      typeof response.webhook_secret === "string"
        ? response.webhook_secret
        : null,
  };
}

export async function deleteWorkflow(workflow: Workflow) {
  await submitEvent({
    kind: 5,
    content: `Delete workflow ${workflow.definition.name}`,
    tags: [["a", `30620:${workflow.owner}:${workflow.id}`]],
  });
}

export async function triggerWorkflow(workflow: Workflow) {
  if (workflow.definition.enabled === false)
    throw new Error("Enable this workflow before triggering it.");
  await submitEvent({ kind: 46020, content: "", tags: [["d", workflow.id]] });
}
