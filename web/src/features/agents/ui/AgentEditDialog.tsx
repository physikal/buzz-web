import { Eye, EyeOff, X } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type {
  AgentCredentialMode,
  AgentRuntime,
  ManagedAgent,
  RespondToMode,
  UpdateAgentInput,
} from "../agent-api";

export function AgentEditDialog({
  agent,
  pending,
  onClose,
  onSubmit,
}: {
  agent: ManagedAgent | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: UpdateAgentInput) => Promise<void>;
}) {
  if (!agent) return null;
  return (
    <AgentEditForm
      agent={agent}
      pending={pending}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}

function AgentEditForm({
  agent,
  pending,
  onClose,
  onSubmit,
}: {
  agent: ManagedAgent;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: UpdateAgentInput) => Promise<void>;
}) {
  const [name, setName] = useState(agent.name);
  const [instructions, setInstructions] = useState(agent.system_prompt);
  const [runtime, setRuntime] = useState<AgentRuntime>(agent.runtime);
  const [model, setModel] = useState(agent.model ?? "");
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [credentialMode, setCredentialMode] = useState<AgentCredentialMode>(
    agent.credential_mode,
  );
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [respondTo, setRespondTo] = useState<RespondToMode>(agent.respond_to);
  const [allowlistText, setAllowlistText] = useState(
    agent.respond_to_allowlist.join("\n"),
  );
  const allowlist = useMemo(
    () =>
      allowlistText
        .split(/[\s,]+/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    [allowlistText],
  );
  const allowlistValid = allowlist.every((key) => /^[0-9a-f]{64}$/.test(key));
  const stopped =
    agent.desired_state === "stopped" && agent.observed_state === "stopped";

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: UpdateAgentInput = {
      name: name.trim(),
      system_prompt: instructions.trim(),
      runtime,
      model: model.trim() || null,
      credential_mode: credentialMode,
      respond_to: respondTo,
      respond_to_allowlist: respondTo === "allowlist" ? allowlist : [],
    };
    if (apiKey) {
      if (runtime === "buzz-agent") {
        input.secrets = {
          BUZZ_AGENT_PROVIDER: provider,
          BUZZ_AGENT_MODEL: model.trim(),
          [provider === "anthropic"
            ? "ANTHROPIC_API_KEY"
            : "OPENAI_COMPAT_API_KEY"]: apiKey,
        };
      } else {
        input.secrets = {
          [runtime === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"]:
            apiKey,
        };
      }
    }
    await onSubmit(input);
  }

  return (
    <div
      aria-label="Edit agent"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold">Edit {agent.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Configuration changes apply on the next start.
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
          id="edit-agent-form"
          onSubmit={submit}
        >
          {!stopped ? (
            <p className="rounded-md border border-amber-600/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              Stop this agent before editing its configuration.
            </p>
          ) : null}
          <Field label="Agent name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Agent instructions">
            <textarea
              className="min-h-36 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Harness">
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={runtime}
                onChange={(event) => {
                  const next = event.target.value as AgentRuntime;
                  setRuntime(next);
                  if (next === "buzz-agent") setCredentialMode("api-key");
                  else if (agent.runtime !== next)
                    setCredentialMode("subscription");
                }}
              >
                <option value="buzz-agent">Buzz Agent</option>
                <option value="codex">Codex</option>
                <option value="claude">Claude Code</option>
              </select>
            </Field>
            <Field label="Model">
              <Input
                placeholder="Automatic"
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </Field>
          </div>
          {runtime === "buzz-agent" ? (
            <Field label="LLM provider">
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={provider}
                onChange={(event) =>
                  setProvider(event.target.value as "anthropic" | "openai")
                }
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI compatible</option>
              </select>
            </Field>
          ) : null}
          {runtime !== "buzz-agent" ? (
            <Field label="Authentication">
              <div className="grid grid-cols-2 rounded-md border bg-muted/40 p-1">
                {(["subscription", "api-key"] as const).map((mode) => (
                  <button
                    className={`h-9 rounded text-sm ${credentialMode === mode ? "bg-background font-medium shadow-xs" : "text-muted-foreground"}`}
                    key={mode}
                    onClick={() => setCredentialMode(mode)}
                    type="button"
                  >
                    {mode === "subscription" ? "Subscription" : "API key"}
                  </button>
                ))}
              </div>
            </Field>
          ) : null}
          {credentialMode === "api-key" ? (
            <Field label="Replace API key">
              <div className="flex items-center rounded-md border px-3">
                <Input
                  className="border-0 px-0 shadow-none"
                  placeholder="Leave blank to keep the current key"
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <button
                  aria-label={showApiKey ? "Hide API key" : "Show API key"}
                  onClick={() => setShowApiKey((value) => !value)}
                  type="button"
                >
                  {showApiKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </Field>
          ) : null}
          <Field label="Who can send instructions">
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={respondTo}
              onChange={(event) =>
                setRespondTo(event.target.value as RespondToMode)
              }
            >
              <option value="owner-only">Only me</option>
              <option value="allowlist">Selected people</option>
              <option value="anyone">Anyone</option>
            </select>
            {respondTo === "allowlist" ? (
              <textarea
                className="mt-2 min-h-20 w-full rounded-md border bg-background p-2 font-mono text-xs"
                value={allowlistText}
                onChange={(event) => setAllowlistText(event.target.value)}
              />
            ) : null}
            {!allowlistValid ? (
              <p className="mt-1 text-xs text-destructive">
                Enter 64-character hexadecimal public keys.
              </p>
            ) : null}
          </Field>
        </form>
        <footer className="flex justify-end gap-2 border-t px-6 py-4">
          <Button disabled={pending} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={
              pending ||
              !stopped ||
              !name.trim() ||
              !allowlistValid ||
              (runtime !== agent.runtime &&
                credentialMode === "api-key" &&
                !apiKey) ||
              (runtime === "buzz-agent" && !model.trim()) ||
              (respondTo === "allowlist" && !allowlist.length)
            }
            form="edit-agent-form"
            type="submit"
          >
            {pending ? "Saving…" : "Save changes"}
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
