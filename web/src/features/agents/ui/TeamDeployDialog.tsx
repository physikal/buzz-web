import { KeyRound, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { AgentDefaults } from "../agent-defaults-api";
import {
  createAgent,
  type AgentProvider,
  type AgentRuntimeCatalogEntry,
  type CreateAgentInput,
  type ManagedAgent,
  restoreAgentMemory,
  setAgentRunning,
} from "../agent-api";
import type { AgentPersona } from "../persona-api";
import type { AgentTeam } from "../team-api";
import { buildCredentialSecrets } from "../runtime-config";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import {
  runtimeCatalogEntry,
  runtimeDisplayName,
  useAgentRuntimeCatalog,
} from "../runtime-catalog";
import { RuntimeCredentialFields } from "./RuntimeCredentialFields";

export type TeamDeployResult = {
  agents: ManagedAgent[];
  failures: string[];
};

export function TeamDeployDialog({
  agentDefaults,
  personas,
  team,
  snapshotMemoryByPersona = {},
  onClose,
  onDeployed,
}: {
  agentDefaults?: AgentDefaults;
  personas: AgentPersona[];
  team: AgentTeam;
  snapshotMemoryByPersona?: Record<
    string,
    Array<{ slug: string; body: string }>
  >;
  onClose: () => void;
  onDeployed: (result: TeamDeployResult) => void;
}) {
  const runtimeCatalog = useAgentRuntimeCatalog();
  const members = useMemo(
    () =>
      team.personaIds
        .map((id) => personas.find((persona) => persona.id === id))
        .filter((persona): persona is AgentPersona => persona !== undefined),
    [personas, team.personaIds],
  );
  const needsAnthropic = members.some(
    (persona) =>
      persona.runtime === "buzz-agent" &&
      (persona.provider ?? "anthropic") === "anthropic",
  );
  const needsOpenAi = members.some(
    (persona) =>
      persona.runtime === "buzz-agent" && persona.provider === "openai",
  );
  const needsOpenRouter = members.some(
    (persona) =>
      persona.runtime === "buzz-agent" && persona.provider === "openrouter",
  );
  const needsDatabricks = members.some(
    (persona) =>
      persona.runtime === "buzz-agent" &&
      persona.provider?.startsWith("databricks"),
  );
  const [anthropicKey, setAnthropicKey] = useState(
    agentDefaults?.runtime === "buzz-agent" &&
      agentDefaults.provider === "anthropic"
      ? agentDefaults.apiKey
      : "",
  );
  const [openAiKey, setOpenAiKey] = useState(
    agentDefaults?.runtime === "buzz-agent" &&
      agentDefaults.provider === "openai"
      ? agentDefaults.apiKey
      : "",
  );
  const [openRouterKey, setOpenRouterKey] = useState(
    agentDefaults?.runtime === "buzz-agent" &&
      agentDefaults.provider === "openrouter"
      ? agentDefaults.apiKey
      : "",
  );
  const [databricksToken, setDatabricksToken] = useState(
    agentDefaults?.runtime === "buzz-agent" &&
      agentDefaults.provider.startsWith("databricks")
      ? agentDefaults.apiKey
      : "",
  );
  const [databricksHost, setDatabricksHost] = useState(
    agentDefaults?.runtime === "buzz-agent" &&
      agentDefaults.provider.startsWith("databricks")
      ? (agentDefaults.runtimeConfig.databricks_host ?? "")
      : "",
  );
  const [customSecrets, setCustomSecrets] = useState<
    Record<string, Record<string, string>>
  >({});
  const customRuntimeEntries = useMemo(() => {
    const entries = new Map<string, AgentRuntimeCatalogEntry>();
    for (const persona of members) {
      const entry = runtimeCatalogEntry(
        runtimeCatalog.runtimes,
        persona.runtime ?? "codex",
      );
      if (entry?.source === "operator") entries.set(entry.id, entry);
    }
    return [...entries.values()];
  }, [members, runtimeCatalog.runtimes]);
  const [pending, setPending] = useState(false);
  useEscapeSurface(true, onClose, pending);
  const canDeploy =
    members.length > 0 &&
    (!needsAnthropic || anthropicKey.length > 0) &&
    (!needsOpenAi || openAiKey.length > 0) &&
    (!needsOpenRouter || openRouterKey.length > 0) &&
    (!needsDatabricks || databricksHost.length > 0) &&
    members.every((persona) =>
      Boolean(
        runtimeCatalogEntry(
          runtimeCatalog.runtimes,
          persona.runtime ?? "codex",
        ),
      ),
    ) &&
    customRuntimeEntries.every((entry) =>
      entry.secret_fields.every(
        (field) =>
          !field.required || Boolean(customSecrets[entry.id]?.[field.env]),
      ),
    ) &&
    members.every((persona) => {
      const entry = runtimeCatalogEntry(
        runtimeCatalog.runtimes,
        persona.runtime ?? "codex",
      );
      return !entry?.model_required || Boolean(persona.model);
    });

  async function deploy() {
    if (!canDeploy) return;
    setPending(true);
    const usedNames = new Set<string>();
    const inputs = members.map((persona, index) => {
      let name = persona.namePool[0] ?? persona.displayName;
      if (usedNames.has(name)) name = `${name} ${index + 1}`;
      usedNames.add(name);
      return teamAgentInput(
        persona,
        team,
        name,
        {
          anthropic: anthropicKey,
          openai: openAiKey,
          openrouter: openRouterKey,
          databricks: databricksToken,
          databricks_v2: databricksToken,
        },
        databricksHost,
        runtimeCatalog.runtimes,
        customSecrets,
      );
    });
    const results = await Promise.allSettled(
      inputs.map(async (input, index) => {
        const memory = snapshotMemoryByPersona[members[index].id] ?? [];
        let agent = await createAgent({
          ...input,
          start_immediately: memory.length ? false : input.start_immediately,
        });
        const restoreFailures: string[] = [];
        for (const entry of memory) {
          try {
            await restoreAgentMemory(agent.id, entry);
          } catch (error) {
            restoreFailures.push(
              `${entry.slug}: ${error instanceof Error ? error.message : "restore failed"}`,
            );
          }
        }
        if (memory.length && input.credential_mode === "api-key") {
          try {
            agent = await setAgentRunning(agent.id, true);
          } catch (error) {
            restoreFailures.push(
              `start: ${error instanceof Error ? error.message : "start failed"}`,
            );
          }
        }
        return { agent, restoreFailures };
      }),
    );
    const agents: ManagedAgent[] = [];
    const failures: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        agents.push(result.value.agent);
        failures.push(
          ...result.value.restoreFailures.map(
            (failure) => `${members[index].displayName}: ${failure}`,
          ),
        );
      } else
        failures.push(
          `${members[index].displayName}: ${result.reason instanceof Error ? result.reason.message : "deployment failed"}`,
        );
    });
    setPending(false);
    onDeployed({ agents, failures });
  }

  return (
    <div
      aria-label="Deploy team"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="w-full max-w-lg rounded-lg bg-background shadow-2xl">
        <header className="flex items-start justify-between border-b px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold">Deploy {team.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create {members.length} centrally hosted agent
              {members.length === 1 ? "" : "s"} from this team.
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
        <div className="space-y-4 p-6">
          <div className="divide-y rounded-md border">
            {members.map((persona) => (
              <div
                className="flex items-center justify-between p-3 text-sm"
                key={persona.id}
              >
                <span className="font-medium">{persona.displayName}</span>
                <span className="text-muted-foreground">
                  {runtimeCatalogEntry(
                    runtimeCatalog.runtimes,
                    persona.runtime ?? "codex",
                  )?.label ?? runtimeDisplayName(persona.runtime ?? "codex")}
                </span>
              </div>
            ))}
          </div>
          {needsAnthropic ? (
            <label
              className="block text-sm font-medium"
              htmlFor="team-anthropic-key"
            >
              Anthropic API key
              <Input
                autoComplete="off"
                className="mt-2"
                id="team-anthropic-key"
                onChange={(event) => setAnthropicKey(event.target.value)}
                type="password"
                value={anthropicKey}
              />
            </label>
          ) : null}
          {needsOpenAi ? (
            <label
              className="block text-sm font-medium"
              htmlFor="team-openai-key"
            >
              OpenAI API key
              <Input
                autoComplete="off"
                className="mt-2"
                id="team-openai-key"
                onChange={(event) => setOpenAiKey(event.target.value)}
                type="password"
                value={openAiKey}
              />
            </label>
          ) : null}
          {needsOpenRouter ? (
            <CredentialField
              id="team-openrouter-key"
              label="OpenRouter API key"
              onChange={setOpenRouterKey}
              value={openRouterKey}
            />
          ) : null}
          {needsDatabricks ? (
            <>
              <label
                className="block text-sm font-medium"
                htmlFor="team-databricks-host"
              >
                Databricks host
                <Input
                  className="mt-2"
                  id="team-databricks-host"
                  onChange={(event) => setDatabricksHost(event.target.value)}
                  placeholder="https://workspace.cloud.databricks.com"
                  type="url"
                  value={databricksHost}
                />
              </label>
              <CredentialField
                id="team-databricks-token"
                label="Databricks token (optional)"
                onChange={setDatabricksToken}
                value={databricksToken}
              />
            </>
          ) : null}
          {customRuntimeEntries.map((entry) => (
            <div className="space-y-3" key={entry.id}>
              <p className="text-sm font-medium">{entry.label}</p>
              <RuntimeCredentialFields
                disabled={pending}
                fields={entry.secret_fields}
                onChange={(values) =>
                  setCustomSecrets((current) => ({
                    ...current,
                    [entry.id]: values,
                  }))
                }
                values={customSecrets[entry.id] ?? {}}
              />
            </div>
          ))}
          {members.some(
            (persona) =>
              runtimeCatalogEntry(
                runtimeCatalog.runtimes,
                persona.runtime ?? "codex",
              )?.supports_subscription,
          ) ? (
            <p className="flex items-start gap-2 rounded-md border p-3 text-sm text-muted-foreground">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
              Codex and Claude agents are created stopped. Connect each
              subscription from its agent menu before starting it.
            </p>
          ) : null}
          {members.some(
            (persona) => persona.runtime === "buzz-agent" && !persona.model,
          ) ? (
            <p className="text-sm text-destructive">
              Every Buzz Agent persona needs a model before this team can be
              deployed.
            </p>
          ) : null}
        </div>
        <footer className="flex justify-end gap-2 border-t px-6 py-4">
          <Button disabled={pending} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={!canDeploy || pending}
            onClick={() => void deploy()}
          >
            {pending ? "Deploying…" : "Deploy team"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function teamAgentInput(
  persona: AgentPersona,
  team: AgentTeam,
  name: string,
  credentials: Record<AgentProvider, string>,
  databricksHost: string,
  runtimeCatalog: AgentRuntimeCatalogEntry[],
  customSecrets: Record<string, Record<string, string>>,
): CreateAgentInput {
  const runtime = persona.runtime ?? "codex";
  const systemPrompt = [
    persona.systemPrompt,
    team.instructions ? `Team instructions:\n${team.instructions}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const secrets: Record<string, string> = {};
  let provider: AgentProvider | undefined;
  const runtimeConfig: Record<string, string> = {};
  if (runtime === "buzz-agent") {
    provider = persona.provider ?? "anthropic";
    Object.assign(
      secrets,
      buildCredentialSecrets(runtime, provider, credentials[provider]),
    );
    if (provider.startsWith("databricks"))
      runtimeConfig.databricks_host = databricksHost;
  } else if (
    runtimeCatalogEntry(runtimeCatalog, runtime)?.source === "operator"
  ) {
    Object.assign(secrets, customSecrets[runtime] ?? {});
  }
  return {
    name,
    persona_id: persona.id,
    system_prompt: systemPrompt,
    runtime,
    model: persona.model ?? undefined,
    provider,
    parallelism: persona.parallelism ?? 1,
    runtime_config: runtimeConfig,
    respond_to: persona.respondTo ?? "owner-only",
    respond_to_allowlist: persona.respondToAllowlist,
    credential_mode: runtimeCatalogEntry(runtimeCatalog, runtime)
      ?.supports_subscription
      ? "subscription"
      : "api-key",
    secrets,
  };
}

function CredentialField({
  id,
  label,
  onChange,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block text-sm font-medium" htmlFor={id}>
      {label}
      <Input
        autoComplete="off"
        className="mt-2"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        type="password"
        value={value}
      />
    </label>
  );
}
