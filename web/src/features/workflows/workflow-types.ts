export const WORKFLOW_TRIGGERS = [
  "message_posted",
  "reaction_added",
  "diff_posted",
  "webhook",
  "schedule",
] as const;

export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export const WORKFLOW_ACTIONS = [
  "delay",
  "send_message",
  "send_dm",
  "call_webhook",
  "request_approval",
  "add_reaction",
  "set_channel_topic",
] as const;

export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

export type WorkflowStep = {
  id: string;
  action: WorkflowAction;
  name?: string;
  if?: string;
  timeout_secs?: number;
  duration?: string;
  text?: string;
  channel?: string;
  to?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  from?: string;
  message?: string;
  timeout?: string;
  emoji?: string;
  topic?: string;
};

export type WorkflowDefinition = {
  name: string;
  description?: string;
  enabled?: boolean;
  trigger: {
    on: WorkflowTrigger;
    filter?: string;
    emoji?: string;
    cron?: string;
    interval?: string;
  };
  steps: WorkflowStep[];
};

export const TRIGGER_LABELS: Record<WorkflowTrigger, string> = {
  message_posted: "Message posted",
  reaction_added: "Reaction added",
  diff_posted: "Diff posted",
  webhook: "Webhook",
  schedule: "Schedule",
};

export const ACTION_LABELS: Record<WorkflowAction, string> = {
  delay: "Delay",
  send_message: "Send message",
  send_dm: "Send DM",
  call_webhook: "Call webhook",
  request_approval: "Request approval",
  add_reaction: "Add reaction",
  set_channel_topic: "Set channel topic",
};

export function workflowTriggerSummary(definition: WorkflowDefinition): string {
  const trigger = definition.trigger;
  const label = TRIGGER_LABELS[trigger.on];
  switch (trigger.on) {
    case "message_posted":
    case "diff_posted":
      return trigger.filter?.trim()
        ? `${label} · ${trigger.filter.trim()}`
        : label;
    case "reaction_added":
      return trigger.emoji?.trim()
        ? `${label} · ${trigger.emoji.trim()}`
        : label;
    case "schedule":
      if (trigger.cron?.trim()) return `${label} · ${trigger.cron.trim()}`;
      if (trigger.interval?.trim())
        return `${label} · ${trigger.interval.trim()}`;
      return label;
    default:
      return label;
  }
}

export function blankWorkflow(): WorkflowDefinition {
  return {
    name: "",
    enabled: true,
    trigger: { on: "message_posted" },
    steps: [],
  };
}

export function blankStep(index: number): WorkflowStep {
  return { id: `step_${index + 1}`, action: "delay", duration: "5s" };
}
