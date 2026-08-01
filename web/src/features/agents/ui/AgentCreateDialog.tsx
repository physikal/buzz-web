import { AlertTriangle, ChevronDown, Eye, EyeOff, X } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import type {
  AgentRuntime,
  CreateAgentInput,
  RespondToMode,
} from "../agent-api";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

const FIELD_SHELL =
  "rounded-md border border-input bg-background shadow-xs focus-within:ring-1 focus-within:ring-ring";

const RUNTIMES: Array<{ value: AgentRuntime; label: string }> = [
  { value: "buzz-agent", label: "Buzz Agent" },
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude Code" },
];

export function AgentCreateDialog({
  open,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: CreateAgentInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [runtime, setRuntime] = useState<AgentRuntime>("buzz-agent");
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [respondTo, setRespondTo] = useState<RespondToMode>("owner-only");
  const [allowlistText, setAllowlistText] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const allowlist = useMemo(
    () =>
      allowlistText
        .split(/[\s,]+/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    [allowlistText],
  );
  const allowlistValid = allowlist.every((key) => /^[0-9a-f]{64}$/.test(key));
  const usesProvider = runtime === "buzz-agent";
  const canSubmit =
    name.trim().length > 0 &&
    (!usesProvider || (provider.length > 0 && model.trim().length > 0)) &&
    apiKey.length > 0 &&
    (respondTo !== "allowlist" || (allowlist.length > 0 && allowlistValid));

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const secrets: Record<string, string> = {};
    if (runtime === "buzz-agent") {
      secrets.BUZZ_AGENT_PROVIDER = provider;
      secrets.BUZZ_AGENT_MODEL = model.trim();
    }
    if (runtime === "buzz-agent") {
      secrets[
        provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_COMPAT_API_KEY"
      ] = apiKey;
    } else if (runtime === "codex") {
      secrets.OPENAI_API_KEY = apiKey;
    } else if (runtime === "claude") {
      secrets.ANTHROPIC_API_KEY = apiKey;
    }
    await onSubmit({
      name: name.trim(),
      system_prompt: instructions.trim(),
      runtime,
      model: model.trim() || undefined,
      respond_to: respondTo,
      respond_to_allowlist: respondTo === "allowlist" ? allowlist : [],
      secrets,
    });
  }

  return (
    <div
      aria-label="Create agent"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !pending) onClose();
      }}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
          <div>
            <h2 className="text-lg font-semibold">Create agent</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create an agent and start it immediately.
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
          className="overflow-y-auto px-6 py-3"
          id="create-agent-form"
          onSubmit={submit}
        >
          <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="relative hidden aspect-[4/5] items-center justify-center rounded-2xl border border-border/70 bg-muted/50 lg:flex">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary text-3xl font-semibold text-primary-foreground">
                {(name.trim()[0] ?? "A").toUpperCase()}
              </div>
              <div className="absolute mt-56 w-44 truncate text-sm font-semibold">
                {name.trim() || "Agent name"}
              </div>
            </div>

            <div className="space-y-5">
              <Field label="Agent name">
                <div
                  className={`${FIELD_SHELL} flex min-h-11 items-center px-3`}
                >
                  <Input
                    autoCorrect="off"
                    className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
                    disabled={pending}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Fizz"
                    value={name}
                  />
                </div>
              </Field>

              <Field label="Agent instructions">
                <div className={FIELD_SHELL}>
                  <textarea
                    className="min-h-40 w-full resize-y bg-transparent px-3 py-3 text-sm leading-5 outline-none placeholder:text-muted-foreground"
                    disabled={pending}
                    onChange={(event) => setInstructions(event.target.value)}
                    placeholder="Describe what this agent should do."
                    value={instructions}
                  />
                </div>
              </Field>

              <Field label="Harness">
                <Select
                  disabled={pending}
                  onChange={(value) => setRuntime(value as AgentRuntime)}
                  value={runtime}
                  options={RUNTIMES}
                />
              </Field>

              {usesProvider ? (
                <Field label="LLM provider" required>
                  <Select
                    disabled={pending}
                    onChange={setProvider}
                    value={provider}
                    options={[
                      { value: "anthropic", label: "Anthropic" },
                      { value: "openai", label: "OpenAI compatible" },
                    ]}
                  />
                </Field>
              ) : null}

              <Field
                label={
                  runtime === "claude" ||
                  (runtime === "buzz-agent" && provider === "anthropic")
                    ? "Anthropic API key"
                    : "OpenAI API key"
                }
                required
              >
                <div
                  className={`${FIELD_SHELL} flex min-h-11 items-center gap-2 px-3`}
                >
                  <Input
                    autoComplete="off"
                    className="h-8 flex-1 border-0 px-0 shadow-none focus-visible:ring-0"
                    disabled={pending}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="Paste API key…"
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                  />
                  <button
                    aria-label={showApiKey ? "Hide API key" : "Show API key"}
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setShowApiKey((shown) => !shown)}
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

              <Field label="Model" required={usesProvider}>
                <div
                  className={`${FIELD_SHELL} flex min-h-11 items-center px-3`}
                >
                  <Input
                    className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
                    disabled={pending}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder={
                      runtime === "buzz-agent" ? "Choose a model" : "Automatic"
                    }
                    value={model}
                  />
                </div>
              </Field>

              <Field label="Run on">
                <div
                  className={`${FIELD_SHELL} flex min-h-11 items-center px-3 text-sm`}
                >
                  This server
                </div>
              </Field>

              <div className="space-y-3">
                <button
                  aria-expanded={showAdvanced}
                  className="inline-flex h-9 items-center gap-1.5 text-sm font-medium"
                  onClick={() => setShowAdvanced((shown) => !shown)}
                  type="button"
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
                  />
                  Advanced
                </button>
                {showAdvanced ? (
                  <Field label="Who can send instructions">
                    <Select
                      disabled={pending}
                      onChange={(value) => setRespondTo(value as RespondToMode)}
                      value={respondTo}
                      options={[
                        { value: "owner-only", label: "Only me (default)" },
                        { value: "anyone", label: "Anyone" },
                        { value: "allowlist", label: "Selected people" },
                      ]}
                    />
                    {respondTo === "owner-only" ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Only you can send instructions.
                      </p>
                    ) : null}
                    {respondTo === "allowlist" ? (
                      <textarea
                        className={`${FIELD_SHELL} mt-2 min-h-24 w-full px-3 py-2 font-mono text-xs outline-none`}
                        onChange={(event) =>
                          setAllowlistText(event.target.value)
                        }
                        placeholder="Paste pubkeys, separated by commas or new lines"
                        value={allowlistText}
                      />
                    ) : null}
                    {respondTo !== "owner-only" ? (
                      <div className="mt-2 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-bg px-3 py-2.5 text-xs leading-5 text-warning">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>
                          {respondTo === "anyone"
                            ? "Anyone"
                            : "Selected people"}{" "}
                          can use this agent to access the server it runs on,
                          including any accounts and tools available there.
                        </p>
                      </div>
                    ) : null}
                    {!allowlistValid ? (
                      <p className="mt-2 text-xs text-destructive">
                        Enter 64-character hex public keys.
                      </p>
                    ) : null}
                  </Field>
                ) : null}
              </div>
            </div>
          </div>
        </form>

        <footer className="flex justify-end gap-2 px-6 pt-2 pb-6">
          <Button
            disabled={pending}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={!canSubmit || pending}
            form="create-agent-form"
            type="submit"
          >
            {pending ? "Creating…" : "Create agent"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">
        {label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
      </p>
      {children}
    </div>
  );
}

function Select({
  disabled,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  value: string;
}) {
  return (
    <select
      className={`${FIELD_SHELL} h-11 w-full px-3 text-sm`}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      value={value}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
