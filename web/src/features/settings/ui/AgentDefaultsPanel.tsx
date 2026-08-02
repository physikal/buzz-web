import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  type AgentDefaults,
  EMPTY_AGENT_DEFAULTS,
  getAgentDefaults,
  saveAgentDefaults,
} from "@/features/agents/agent-defaults-api";
import type {
  AgentCredentialMode,
  AgentRuntime,
} from "@/features/agents/agent-api";
import {
  runtimeCatalogEntry,
  runtimeDisplayName,
  useAgentRuntimeCatalog,
} from "@/features/agents/runtime-catalog";
import {
  AGENT_PROVIDERS,
  buildRuntimeConfig,
  EMPTY_ADVANCED_RUNTIME_DRAFT,
  parseAgentArgs,
  providerMetadata,
  type AdvancedRuntimeDraft,
  validateAdvancedRuntimeDraft,
} from "@/features/agents/runtime-config";
import { AdvancedRuntimeFields } from "@/features/agents/ui/AdvancedRuntimeFields";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export function AgentDefaultsPanel({ ownerPubkey }: { ownerPubkey: string }) {
  const runtimeCatalog = useAgentRuntimeCatalog();
  const [draft, setDraft] = useState<AgentDefaults>(EMPTY_AGENT_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [advancedDraft, setAdvancedDraft] = useState<AdvancedRuntimeDraft>(
    EMPTY_ADVANCED_RUNTIME_DRAFT,
  );

  useEffect(() => {
    let active = true;
    void getAgentDefaults(ownerPubkey)
      .then((value) => {
        if (active) {
          setDraft(value);
          setAdvancedDraft(advancedDraftFromDefaults(value));
        }
      })
      .catch((error) => {
        if (active)
          toast.error("Could not load agent defaults", {
            description: error instanceof Error ? error.message : undefined,
          });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      setDraft(EMPTY_AGENT_DEFAULTS);
    };
  }, [ownerPubkey]);

  async function save() {
    setSaving(true);
    try {
      await saveAgentDefaults({
        ...draft,
        agentArgs:
          runtimeCatalogEntry(runtimeCatalog.runtimes, draft.runtime)
            ?.supports_arguments === false
            ? []
            : parseAgentArgs(advancedDraft.agentArgsText),
        parallelism: Number(advancedDraft.parallelism),
        idleTimeoutSeconds: advancedDraft.idleTimeout
          ? Number(advancedDraft.idleTimeout)
          : null,
        maxTurnDurationSeconds: advancedDraft.maxTurnDuration
          ? Number(advancedDraft.maxTurnDuration)
          : null,
        runtimeConfig: buildRuntimeConfig(
          draft.runtime,
          draft.provider,
          advancedDraft,
        ),
      });
      const saved = await getAgentDefaults(ownerPubkey);
      setDraft(saved);
      setAdvancedDraft(advancedDraftFromDefaults(saved));
      toast.success("Agent defaults saved");
    } catch (error) {
      toast.error("Could not save agent defaults", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  const advancedError = validateAdvancedRuntimeDraft(
    draft.runtime,
    draft.provider,
    advancedDraft,
  );
  const selectedRuntime = runtimeCatalogEntry(
    runtimeCatalog.runtimes,
    draft.runtime,
  );
  const customRuntime = selectedRuntime?.source === "operator";
  const runtimeKnown = runtimeCatalog.runtimes.some(
    (entry) => entry.id === draft.runtime,
  );
  const runtimeOptions = runtimeKnown
    ? runtimeCatalog.runtimes
    : [
        ...runtimeCatalog.runtimes,
        {
          id: draft.runtime,
          label: runtimeDisplayName(draft.runtime),
          source: "operator" as const,
          supports_model: true,
          model_required: false,
          supports_subscription: false,
          supports_arguments: false,
          secret_fields: [],
        },
      ];
  const credentialRequired =
    draft.credentialMode === "api-key" &&
    !customRuntime &&
    (draft.runtime !== "buzz-agent" ||
      providerMetadata(draft.provider).credentialRequired);

  return (
    <section>
      <h2 className="text-xl font-semibold">Agent defaults</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Defaults for new centrally hosted agents.
      </p>
      {loading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading defaults…</p>
      ) : (
        <div className="mt-6 space-y-5">
          <label
            className="block text-sm font-medium"
            htmlFor="default-agent-runtime"
          >
            Default harness
            <select
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
              id="default-agent-runtime"
              value={draft.runtime}
              onChange={(event) => {
                const runtime = event.target.value as AgentRuntime;
                setDraft((current) => ({
                  ...current,
                  runtime,
                  credentialMode: runtimeCatalogEntry(
                    runtimeCatalog.runtimes,
                    runtime,
                  )?.supports_subscription
                    ? "subscription"
                    : "api-key",
                  apiKey: "",
                }));
              }}
            >
              {runtimeOptions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            {!runtimeKnown && !runtimeCatalog.isPending ? (
              <p className="mt-2 text-xs text-destructive">
                This harness is not installed on the agent host.
              </p>
            ) : null}
          </label>
          {draft.runtime === "buzz-agent" ? (
            <label
              className="block text-sm font-medium"
              htmlFor="default-agent-provider"
            >
              LLM provider
              <select
                className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
                id="default-agent-provider"
                value={draft.provider}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    provider: event.target.value as AgentDefaults["provider"],
                  }))
                }
              >
                {AGENT_PROVIDERS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
          ) : selectedRuntime?.supports_subscription ? (
            <label
              className="block text-sm font-medium"
              htmlFor="default-agent-auth"
            >
              Authentication
              <select
                className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
                id="default-agent-auth"
                value={draft.credentialMode}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    credentialMode: event.target.value as AgentCredentialMode,
                  }))
                }
              >
                <option value="subscription">Subscription</option>
                <option value="api-key">API key</option>
              </select>
            </label>
          ) : null}
          {selectedRuntime?.supports_model !== false ? (
            <label
              className="block text-sm font-medium"
              htmlFor="default-agent-model"
            >
              Default model
              <Input
                className="mt-2"
                id="default-agent-model"
                maxLength={255}
                placeholder={
                  draft.runtime === "buzz-agent" ||
                  selectedRuntime?.model_required
                    ? "Choose a model"
                    : "Automatic"
                }
                value={draft.model}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
                }
              />
            </label>
          ) : null}
          {draft.credentialMode === "api-key" && !customRuntime ? (
            <div>
              <label
                className="block text-sm font-medium"
                htmlFor="default-agent-key"
              >
                {draft.runtime === "buzz-agent"
                  ? `Default ${providerMetadata(draft.provider).credentialLabel}`
                  : "Default API key"}
              </label>
              <div className="mt-2 flex items-center gap-2 rounded-md border px-3">
                <Input
                  autoComplete="off"
                  className="border-0 px-0 shadow-none focus-visible:ring-0"
                  id="default-agent-key"
                  type={showKey ? "text" : "password"}
                  value={draft.apiKey}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      apiKey: event.target.value,
                    }))
                  }
                />
                <button
                  aria-label={
                    showKey ? "Hide default API key" : "Show default API key"
                  }
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setShowKey((value) => !value)}
                  type="button"
                >
                  {showKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          ) : null}
          <AdvancedRuntimeFields
            disabled={saving}
            draft={advancedDraft}
            onChange={setAdvancedDraft}
            provider={draft.provider}
            runtime={draft.runtime}
            supportsArguments={selectedRuntime?.supports_arguments}
          />
          {advancedError ? (
            <p className="text-xs text-destructive">{advancedError}</p>
          ) : null}
          <Button
            disabled={
              saving ||
              !runtimeKnown ||
              (draft.runtime === "buzz-agent" && !draft.model.trim()) ||
              (selectedRuntime?.model_required && !draft.model.trim()) ||
              (credentialRequired && !draft.apiKey) ||
              advancedError !== null
            }
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save defaults"}
          </Button>
        </div>
      )}
    </section>
  );
}

function advancedDraftFromDefaults(
  defaults: AgentDefaults,
): AdvancedRuntimeDraft {
  return {
    agentArgsText: defaults.agentArgs.join(", "),
    parallelism: String(defaults.parallelism),
    idleTimeout: defaults.idleTimeoutSeconds?.toString() ?? "",
    maxTurnDuration: defaults.maxTurnDurationSeconds?.toString() ?? "",
    thinkingEffort: defaults.runtimeConfig.thinking_effort ?? "",
    maxRounds: defaults.runtimeConfig.max_rounds ?? "",
    maxOutputTokens: defaults.runtimeConfig.max_output_tokens ?? "",
    maxContextTokens: defaults.runtimeConfig.max_context_tokens ?? "",
    baseUrl: defaults.runtimeConfig.base_url ?? "",
    apiMode: defaults.runtimeConfig.api_mode ?? "",
    apiVersion: defaults.runtimeConfig.api_version ?? "",
    databricksHost: defaults.runtimeConfig.databricks_host ?? "",
  };
}
