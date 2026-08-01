import { KeyRound, X } from "lucide-react";
import { useMemo, useState } from "react";

import {
  createAgent,
  type CreateAgentInput,
  type ManagedAgent,
} from "@/features/agents/agent-api";
import { addAgentToChannel } from "@/features/agents/agent-channels";
import type { AgentPersona } from "@/features/agents/persona-api";
import type { AgentTeam } from "@/features/agents/team-api";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { ChannelTemplate } from "../channel-template-api";

type TemplateMember = { persona: AgentPersona; teamInstructions: string[] };

export type TemplateDeployResult = {
  agents: ManagedAgent[];
  failures: string[];
};

export function TemplateDeployDialog({
  channelId,
  personas,
  teams,
  template,
  onClose,
  onDeployed,
}: {
  channelId: string;
  personas: AgentPersona[];
  teams: AgentTeam[];
  template: ChannelTemplate;
  onClose: () => void;
  onDeployed: (result: TemplateDeployResult) => void;
}) {
  const members = useMemo(
    () => resolveMembers(template, personas, teams),
    [personas, teams, template],
  );
  const needsAnthropic = members.some(
    ({ persona }) =>
      persona.runtime === "buzz-agent" && persona.provider !== "openai",
  );
  const needsOpenAi = members.some(
    ({ persona }) =>
      persona.runtime === "buzz-agent" && persona.provider === "openai",
  );
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openAiKey, setOpenAiKey] = useState("");
  const [pending, setPending] = useState(false);
  const canDeploy =
    members.length > 0 &&
    (!needsAnthropic || anthropicKey.length > 0) &&
    (!needsOpenAi || openAiKey.length > 0) &&
    members.every(
      ({ persona }) =>
        persona.runtime !== "buzz-agent" || Boolean(persona.model),
    );

  async function deploy() {
    if (!canDeploy) return;
    setPending(true);
    const usedNames = new Set<string>();
    const jobs = members.map(async (member, index) => {
      let name = member.persona.namePool[0] ?? member.persona.displayName;
      if (usedNames.has(name)) name = `${name} ${index + 1}`;
      usedNames.add(name);
      const agent = await createAgent(
        agentInput(member, name, anthropicKey, openAiKey),
      );
      await addAgentToChannel({
        channelId,
        agentPubkey: agent.agent_pubkey,
        role: "bot",
      });
      return agent;
    });
    const results = await Promise.allSettled(jobs);
    const agents: ManagedAgent[] = [];
    const failures: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") agents.push(result.value);
      else
        failures.push(
          `${members[index].persona.displayName}: ${result.reason instanceof Error ? result.reason.message : "deployment failed"}`,
        );
    });
    setPending(false);
    onDeployed({ agents, failures });
  }

  return (
    <div
      aria-label="Finish template setup"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="w-full max-w-lg rounded-lg bg-background shadow-2xl">
        <header className="flex items-start justify-between border-b px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold">Finish template setup</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add {members.length} hosted agent{members.length === 1 ? "" : "s"}
              to this channel.
            </p>
          </div>
          <Button
            aria-label="Skip agent setup"
            disabled={pending}
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        <div className="space-y-4 p-6">
          <div className="max-h-52 divide-y overflow-y-auto rounded-md border">
            {members.map(({ persona }) => (
              <div
                className="flex items-center justify-between p-3 text-sm"
                key={persona.id}
              >
                <span className="font-medium">{persona.displayName}</span>
                <span className="text-muted-foreground">
                  {persona.runtime ?? "codex"}
                </span>
              </div>
            ))}
          </div>
          {needsAnthropic ? (
            <CredentialField
              id="template-anthropic-key"
              label="Anthropic API key"
              value={anthropicKey}
              onChange={setAnthropicKey}
            />
          ) : null}
          {needsOpenAi ? (
            <CredentialField
              id="template-openai-key"
              label="OpenAI API key"
              value={openAiKey}
              onChange={setOpenAiKey}
            />
          ) : null}
          {members.some(({ persona }) => persona.runtime !== "buzz-agent") ? (
            <p className="flex items-start gap-2 rounded-md border p-3 text-sm text-muted-foreground">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
              Codex and Claude agents are created stopped. Connect each
              subscription from Agents before starting it.
            </p>
          ) : null}
          {members.some(
            ({ persona }) => persona.runtime === "buzz-agent" && !persona.model,
          ) ? (
            <p className="text-sm text-destructive">
              Every Buzz Agent persona needs a model before deployment.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Provider keys are sent only to the encrypted agent-host credential
            endpoint. They are never included in the channel or template event.
          </p>
        </div>
        <footer className="flex justify-end gap-2 border-t px-6 py-4">
          <Button disabled={pending} onClick={onClose} variant="outline">
            Skip
          </Button>
          <Button
            disabled={!canDeploy || pending}
            onClick={() => void deploy()}
          >
            {pending ? "Adding agents…" : "Add agents"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function resolveMembers(
  template: ChannelTemplate,
  personas: AgentPersona[],
  teams: AgentTeam[],
): TemplateMember[] {
  const members = new Map<string, TemplateMember>();
  for (const id of template.personaIds) {
    const persona = personas.find((item) => item.id === id);
    if (persona) members.set(id, { persona, teamInstructions: [] });
  }
  for (const teamId of template.teamIds) {
    const team = teams.find((item) => item.id === teamId);
    if (!team) continue;
    for (const personaId of team.personaIds) {
      const persona = personas.find((item) => item.id === personaId);
      if (!persona) continue;
      const current = members.get(personaId) ?? {
        persona,
        teamInstructions: [],
      };
      if (team.instructions) current.teamInstructions.push(team.instructions);
      members.set(personaId, current);
    }
  }
  return [...members.values()];
}

function agentInput(
  member: TemplateMember,
  name: string,
  anthropicKey: string,
  openAiKey: string,
): CreateAgentInput {
  const { persona } = member;
  const runtime = persona.runtime ?? "codex";
  const secrets: Record<string, string> = {};
  if (runtime === "buzz-agent") {
    const provider = persona.provider ?? "anthropic";
    secrets.BUZZ_AGENT_PROVIDER = provider;
    secrets.BUZZ_AGENT_MODEL = persona.model ?? "";
    if (provider === "openai") secrets.OPENAI_COMPAT_API_KEY = openAiKey;
    else secrets.ANTHROPIC_API_KEY = anthropicKey;
  }
  return {
    name,
    system_prompt: [persona.systemPrompt, ...member.teamInstructions]
      .filter(Boolean)
      .join("\n\nTeam instructions:\n"),
    runtime,
    model: persona.model ?? undefined,
    respond_to: persona.respondTo ?? "owner-only",
    respond_to_allowlist: persona.respondToAllowlist,
    credential_mode: runtime === "buzz-agent" ? "api-key" : "subscription",
    secrets,
  };
}

function CredentialField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm font-medium" htmlFor={id}>
      {label}
      <Input
        autoComplete="off"
        className="mt-2"
        id={id}
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
