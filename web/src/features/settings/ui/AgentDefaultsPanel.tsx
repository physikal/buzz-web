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
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export function AgentDefaultsPanel({ ownerPubkey }: { ownerPubkey: string }) {
  const [draft, setDraft] = useState<AgentDefaults>(EMPTY_AGENT_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    let active = true;
    void getAgentDefaults(ownerPubkey)
      .then((value) => {
        if (active) setDraft(value);
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
      await saveAgentDefaults(draft);
      setDraft(await getAgentDefaults(ownerPubkey));
      toast.success("Agent defaults saved");
    } catch (error) {
      toast.error("Could not save agent defaults", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

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
                  credentialMode:
                    runtime === "buzz-agent" ? "api-key" : "subscription",
                }));
              }}
            >
              <option value="buzz-agent">Buzz Agent</option>
              <option value="codex">Codex</option>
              <option value="claude">Claude Code</option>
            </select>
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
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI compatible</option>
              </select>
            </label>
          ) : (
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
          )}
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
                draft.runtime === "buzz-agent" ? "Choose a model" : "Automatic"
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
          {draft.credentialMode === "api-key" ? (
            <div>
              <label
                className="block text-sm font-medium"
                htmlFor="default-agent-key"
              >
                Default API key
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
          <Button
            disabled={
              saving ||
              (draft.runtime === "buzz-agent" && !draft.model.trim()) ||
              (draft.credentialMode === "api-key" && !draft.apiKey)
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
