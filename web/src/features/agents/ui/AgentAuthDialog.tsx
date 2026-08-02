import { ExternalLink, KeyRound, X } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import {
  cancelAgentAuth,
  getAgentAuthStatus,
  sendAgentAuthInput,
  startAgentAuth,
  type ManagedAgent,
} from "../agent-api";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";

export function AgentAuthDialog({
  agent,
  onClose,
  onAuthenticated,
}: {
  agent: ManagedAgent | null;
  onClose: () => void;
  onAuthenticated: (agent: ManagedAgent) => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const statusQuery = useQuery({
    queryKey: ["agent-auth", agent?.id],
    queryFn: () => getAgentAuthStatus(agent?.id ?? ""),
    enabled: Boolean(agent),
    refetchInterval: (query) =>
      query.state.data?.state === "waiting" ? 2_000 : false,
    retry: false,
  });
  const startMutation = useMutation({
    mutationFn: () => startAgentAuth(agent?.id ?? ""),
    onSuccess: () => statusQuery.refetch(),
  });
  const inputMutation = useMutation({
    mutationFn: (value: string) => sendAgentAuthInput(agent?.id ?? "", value),
    onSuccess: () => {
      setInput("");
      void statusQuery.refetch();
    },
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelAgentAuth(agent?.id ?? ""),
  });
  const status = statusQuery.data;
  const url = useMemo(
    () => status?.output.match(/https:\/\/\S+/)?.[0] ?? null,
    [status?.output],
  );
  const code = useMemo(
    () => status?.output.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,8}\b/)?.[0] ?? null,
    [status?.output],
  );
  const pending =
    startMutation.isPending ||
    inputMutation.isPending ||
    cancelMutation.isPending;
  useEscapeSurface(Boolean(agent), onClose, pending);

  if (!agent) return null;
  const provider = agent.runtime === "codex" ? "OpenAI Codex" : "Claude";
  const error =
    startMutation.error?.message ??
    inputMutation.error?.message ??
    statusQuery.error?.message ??
    status?.error;

  function submitInput(event: FormEvent) {
    event.preventDefault();
    if (input.trim()) inputMutation.mutate(input.trim());
  }

  return (
    <div
      aria-label="Connect subscription"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="w-full max-w-lg rounded-lg bg-background p-6 shadow-2xl">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Connect {provider}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in with the subscription used by {agent.name}.
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

        {statusQuery.isLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">
            Checking authentication…
          </p>
        ) : null}
        {status?.state === "disconnected" ||
        status?.state === "failed" ||
        status?.state === "cancelled" ? (
          <Button
            className="mt-6 w-full"
            disabled={pending}
            onClick={() => startMutation.mutate()}
          >
            <KeyRound />{" "}
            {startMutation.isPending
              ? "Starting sign-in…"
              : `Connect ${provider}`}
          </Button>
        ) : null}
        {status?.state === "waiting" ? (
          <div className="mt-6 space-y-4">
            {url ? (
              <Button asChild className="w-full">
                <a href={url} rel="noreferrer" target="_blank">
                  <ExternalLink /> Open {provider} sign-in
                </a>
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Preparing the secure sign-in link…
              </p>
            )}
            {code ? (
              <div className="rounded-md border bg-muted/40 p-4 text-center">
                <p className="text-xs font-medium text-muted-foreground">
                  One-time code
                </p>
                <code className="mt-2 block text-xl font-semibold">{code}</code>
              </div>
            ) : null}
            {status.needs_input ? (
              <form onSubmit={submitInput}>
                <label
                  className="text-sm font-medium"
                  htmlFor="agent-auth-code"
                >
                  Confirmation code
                </label>
                <div className="mt-2 flex gap-2">
                  <Input
                    autoComplete="one-time-code"
                    id="agent-auth-code"
                    maxLength={4096}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Paste the code from Claude"
                    value={input}
                  />
                  <Button disabled={pending || !input.trim()} type="submit">
                    Continue
                  </Button>
                </div>
              </form>
            ) : null}
            <Button
              className="w-full"
              disabled={pending}
              onClick={() => {
                cancelMutation.mutate();
                onClose();
              }}
              variant="ghost"
            >
              Cancel sign-in
            </Button>
          </div>
        ) : null}
        {status?.connected ? (
          <div className="mt-6">
            <p className="rounded-md border border-emerald-600/25 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-700 dark:text-emerald-300">
              {provider} is connected for this agent.
            </p>
            <Button
              className="mt-4 w-full"
              disabled={pending}
              onClick={() => onAuthenticated(agent)}
            >
              Start agent
            </Button>
          </div>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {status?.output && !url && status.state === "waiting" ? (
          <pre className="mt-4 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
            {status.output}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
