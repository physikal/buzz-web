import { Eye, Globe2, LockKeyhole, X } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { AgentProvider, AgentRuntime, RespondToMode } from "../agent-api";
import type { AgentPersona, PersonaInput } from "../persona-api";
import {
  runtimeCatalogEntry,
  runtimeDisplayName,
  useAgentRuntimeCatalog,
} from "../runtime-catalog";
import { AGENT_PROVIDERS } from "../runtime-config";

export function PersonaDialog({
  persona,
  pending,
  onClose,
  onSave,
}: {
  persona: AgentPersona | null;
  pending: boolean;
  onClose: () => void;
  onSave: (input: PersonaInput) => Promise<unknown>;
}) {
  const runtimeCatalog = useAgentRuntimeCatalog();
  const [displayName, setDisplayName] = useState(persona?.displayName ?? "");
  const [systemPrompt, setSystemPrompt] = useState(persona?.systemPrompt ?? "");
  const [avatarUrl, setAvatarUrl] = useState(persona?.avatarUrl ?? "");
  const [runtime, setRuntime] = useState<AgentRuntime>(
    persona?.runtime ?? "codex",
  );
  const [model, setModel] = useState(persona?.model ?? "");
  const [provider, setProvider] = useState<AgentProvider>(
    persona?.provider ?? "anthropic",
  );
  const [namePoolText, setNamePoolText] = useState(
    persona?.namePool.join("\n") ?? "",
  );
  const [respondTo, setRespondTo] = useState<RespondToMode>(
    persona?.respondTo ?? "owner-only",
  );
  const [allowlistText, setAllowlistText] = useState(
    persona?.respondToAllowlist.join("\n") ?? "",
  );
  const [parallelism, setParallelism] = useState(
    String(persona?.parallelism ?? 1),
  );
  const [shared, setShared] = useState(persona?.shared ?? false);
  const [advanced, setAdvanced] = useState(false);
  const allowlist = useMemo(
    () =>
      allowlistText
        .split(/[\s,]+/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    [allowlistText],
  );
  const allowlistValid = allowlist.every((key) => /^[0-9a-f]{64}$/.test(key));
  const parallel = Number(parallelism);
  const selectedRuntime = runtimeCatalogEntry(runtimeCatalog.runtimes, runtime);
  const runtimeKnown = runtimeCatalog.runtimes.some(
    (entry) => entry.id === runtime,
  );
  const runtimeOptions = runtimeKnown
    ? runtimeCatalog.runtimes
    : [
        ...runtimeCatalog.runtimes,
        {
          id: runtime,
          label: runtimeDisplayName(runtime),
          source: "operator" as const,
          supports_model: true,
          model_required: false,
          supports_subscription: false,
          supports_arguments: false,
          secret_fields: [],
        },
      ];
  const valid =
    runtimeKnown &&
    displayName.trim().length > 0 &&
    displayName.length <= 120 &&
    allowlistValid &&
    (respondTo !== "allowlist" || allowlist.length > 0) &&
    Number.isSafeInteger(parallel) &&
    parallel >= 1 &&
    parallel <= 32 &&
    (!selectedRuntime?.model_required || model.trim().length > 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    await onSave({
      displayName: displayName.trim(),
      systemPrompt,
      avatarUrl: avatarUrl.trim() || null,
      runtime,
      model: model.trim() || null,
      provider: runtime === "buzz-agent" ? provider : null,
      namePool: namePoolText
        .split("\n")
        .map((name) => name.trim())
        .filter(Boolean),
      respondTo,
      respondToAllowlist: respondTo === "allowlist" ? allowlist : [],
      parallelism: parallel,
      shared,
      catalogSource: persona?.catalogSource ?? null,
    });
  }

  return (
    <div
      aria-label={persona ? "Edit persona" : "Create persona"}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold">
              {persona ? `Edit ${persona.displayName}` : "Create persona"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Save a reusable agent definition across your Buzz clients.
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
          id="persona-form"
          onSubmit={submit}
        >
          <Field label="Persona name">
            <Input
              aria-label="Persona name"
              autoFocus
              disabled={pending}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Code reviewer"
              value={displayName}
            />
          </Field>
          <Field label="Instructions">
            <textarea
              aria-label="Persona instructions"
              className="min-h-40 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
              disabled={pending}
              onChange={(event) => setSystemPrompt(event.target.value)}
              placeholder="Describe the role, behavior, and boundaries for this persona."
              value={systemPrompt}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Harness">
              <select
                aria-label="Harness"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                disabled={pending}
                onChange={(event) =>
                  setRuntime(event.target.value as AgentRuntime)
                }
                value={runtime}
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
            </Field>
            {selectedRuntime?.supports_model !== false ? (
              <Field label="Model">
                <Input
                  aria-label="Model"
                  disabled={pending}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={
                    selectedRuntime?.model_required
                      ? "Choose a model"
                      : "Automatic"
                  }
                  value={model}
                />
              </Field>
            ) : null}
          </div>
          {runtime === "buzz-agent" ? (
            <Field label="Provider">
              <select
                aria-label="Provider"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                disabled={pending}
                onChange={(event) =>
                  setProvider(event.target.value as AgentProvider)
                }
                value={provider}
              >
                {AGENT_PROVIDERS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Avatar URL">
            <Input
              aria-label="Avatar URL"
              disabled={pending}
              onChange={(event) => setAvatarUrl(event.target.value)}
              placeholder="https://…"
              type="url"
              value={avatarUrl}
            />
          </Field>

          <button
            className="flex items-center gap-2 text-sm font-medium"
            onClick={() => setAdvanced((value) => !value)}
            type="button"
          >
            <Eye className="h-4 w-4" /> Advanced configuration
          </button>
          {advanced ? (
            <div className="space-y-5 border-l pl-4">
              <Field label="Instance name pool">
                <textarea
                  className="min-h-20 w-full rounded-md border bg-background p-2 text-sm"
                  onChange={(event) => setNamePoolText(event.target.value)}
                  placeholder="One optional name per line"
                  value={namePoolText}
                />
              </Field>
              <Field label="Who can send instructions">
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  onChange={(event) =>
                    setRespondTo(event.target.value as RespondToMode)
                  }
                  value={respondTo}
                >
                  <option value="owner-only">Only me</option>
                  <option value="allowlist">Selected people</option>
                  <option value="anyone">Anyone</option>
                </select>
                {respondTo === "allowlist" ? (
                  <textarea
                    className="mt-2 min-h-20 w-full rounded-md border bg-background p-2 font-mono text-xs"
                    onChange={(event) => setAllowlistText(event.target.value)}
                    placeholder="One public key per line"
                    value={allowlistText}
                  />
                ) : null}
              </Field>
              <Field label="Parallel turns">
                <Input
                  max={32}
                  min={1}
                  onChange={(event) => setParallelism(event.target.value)}
                  type="number"
                  value={parallelism}
                />
              </Field>
            </div>
          ) : null}

          <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
            <input
              checked={shared}
              className="mt-1"
              onChange={(event) => setShared(event.target.checked)}
              type="checkbox"
            />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                {shared ? (
                  <Globe2 className="h-4 w-4" />
                ) : (
                  <LockKeyhole className="h-4 w-4" />
                )}
                {shared ? "Shared with this community" : "Private to you"}
              </span>
              <span className="mt-1 block text-muted-foreground">
                Sharing makes the persona name and instructions readable to
                community members. Credentials are never part of a persona.
              </span>
            </span>
          </label>
        </form>
        <footer className="flex justify-end gap-2 border-t px-6 py-4">
          <Button disabled={pending} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={!valid || pending}
            form="persona-form"
            type="submit"
          >
            {pending ? "Saving…" : "Save persona"}
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
