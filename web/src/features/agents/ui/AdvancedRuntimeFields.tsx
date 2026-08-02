import type { AgentProvider, AgentRuntime } from "../agent-api";
import { type AdvancedRuntimeDraft, THINKING_EFFORTS } from "../runtime-config";
import { Input } from "@/shared/ui/input";

const CONTROL = "h-9 w-full rounded-md border bg-background px-3 text-sm";

export function AdvancedRuntimeFields({
  disabled,
  draft,
  provider,
  runtime,
  onChange,
}: {
  disabled: boolean;
  draft: AdvancedRuntimeDraft;
  provider: AgentProvider;
  runtime: AgentRuntime;
  onChange: (draft: AdvancedRuntimeDraft) => void;
}) {
  const set = (key: keyof AdvancedRuntimeDraft, value: string) =>
    onChange({ ...draft, [key]: value });
  return (
    <div className="space-y-5 border-l pl-4">
      <Field label="Agent runtime args" optional>
        <Input
          aria-label="Agent runtime args"
          disabled={disabled}
          onChange={(event) => set("agentArgsText", event.target.value)}
          placeholder="Comma-separated"
          value={draft.agentArgsText}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Parallelism">
          <Input
            aria-label="Parallelism"
            disabled={disabled}
            max={32}
            min={1}
            onChange={(event) => set("parallelism", event.target.value)}
            type="number"
            value={draft.parallelism}
          />
        </Field>
        <Field label="Idle timeout" optional suffix="seconds">
          <Input
            aria-label="Idle timeout seconds"
            disabled={disabled}
            min={1}
            onChange={(event) => set("idleTimeout", event.target.value)}
            placeholder="900"
            type="number"
            value={draft.idleTimeout}
          />
        </Field>
        <Field label="Maximum turn duration" optional suffix="seconds">
          <Input
            aria-label="Maximum turn duration seconds"
            disabled={disabled}
            min={2}
            onChange={(event) => set("maxTurnDuration", event.target.value)}
            placeholder="7200"
            type="number"
            value={draft.maxTurnDuration}
          />
        </Field>
      </div>

      {runtime === "buzz-agent" ? (
        <>
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            Buzz Agent model tuning
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Thinking / Effort" optional>
              <select
                aria-label="Thinking effort"
                className={CONTROL}
                disabled={disabled}
                onChange={(event) => set("thinkingEffort", event.target.value)}
                value={draft.thinkingEffort}
              >
                <option value="">Default</option>
                {THINKING_EFFORTS.map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Max rounds" optional>
              <Input
                aria-label="Max rounds"
                disabled={disabled}
                min={0}
                onChange={(event) => set("maxRounds", event.target.value)}
                placeholder="Unlimited"
                type="number"
                value={draft.maxRounds}
              />
            </Field>
            <Field label="Max output tokens" optional>
              <Input
                aria-label="Max output tokens"
                disabled={disabled}
                min={1}
                onChange={(event) => set("maxOutputTokens", event.target.value)}
                placeholder="32768"
                type="number"
                value={draft.maxOutputTokens}
              />
            </Field>
            <Field label="Context limit" optional>
              <Input
                aria-label="Context limit"
                disabled={disabled}
                min={1}
                onChange={(event) =>
                  set("maxContextTokens", event.target.value)
                }
                placeholder="200000"
                type="number"
                value={draft.maxContextTokens}
              />
            </Field>
          </div>

          {provider.startsWith("databricks") ? (
            <Field label="Databricks host">
              <Input
                aria-label="Databricks host"
                disabled={disabled}
                onChange={(event) => set("databricksHost", event.target.value)}
                placeholder="https://workspace.cloud.databricks.com"
                type="url"
                value={draft.databricksHost}
              />
            </Field>
          ) : (
            <Field label="Provider base URL" optional>
              <Input
                aria-label="Provider base URL"
                disabled={disabled}
                onChange={(event) => set("baseUrl", event.target.value)}
                placeholder="Use provider default"
                type="url"
                value={draft.baseUrl}
              />
            </Field>
          )}
          {provider === "openai" ? (
            <Field label="OpenAI API mode" optional>
              <select
                aria-label="OpenAI API mode"
                className={CONTROL}
                disabled={disabled}
                onChange={(event) => set("apiMode", event.target.value)}
                value={draft.apiMode}
              >
                <option value="">Automatic</option>
                <option value="auto">Auto</option>
                <option value="chat">Chat Completions</option>
                <option value="responses">Responses</option>
              </select>
            </Field>
          ) : null}
          {provider === "anthropic" ? (
            <Field label="Anthropic API version" optional>
              <Input
                aria-label="Anthropic API version"
                disabled={disabled}
                onChange={(event) => set("apiVersion", event.target.value)}
                placeholder="2023-06-01"
                value={draft.apiVersion}
              />
            </Field>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Field({
  children,
  label,
  optional,
  suffix,
}: {
  children: React.ReactNode;
  label: string;
  optional?: boolean;
  suffix?: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">
        {label}
        {optional ? (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            Optional
          </span>
        ) : null}
        {suffix ? (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </p>
      {children}
    </div>
  );
}
