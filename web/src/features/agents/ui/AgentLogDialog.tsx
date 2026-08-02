import { Clipboard, Logs, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  getAgentRuntimeLog,
  type AgentRuntimeLog,
  type ManagedAgent,
} from "../agent-api";
import { Button } from "@/shared/ui/button";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";

export function AgentLogDialog({
  agent,
  onClose,
}: {
  agent: ManagedAgent | null;
  onClose: () => void;
}) {
  const [log, setLog] = useState<AgentRuntimeLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscapeSurface(Boolean(agent), onClose);

  async function refresh() {
    if (!agent) return;
    setLoading(true);
    setError(null);
    try {
      setLog(await getAgentRuntimeLog(agent.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load log");
    } finally {
      setLoading(false);
    }
  }

  // Refresh when a different agent is selected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: agent identity is the request key
  useEffect(() => void refresh(), [agent?.id]);
  if (!agent) return null;

  return (
    <div
      aria-label={`${agent.name} harness log`}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="flex max-h-[88dvh] w-full max-w-3xl flex-col rounded-lg bg-background shadow-2xl">
        <header className="flex items-start justify-between border-b px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <Logs className="h-5 w-5" />
              <h2 className="text-lg font-semibold">
                {agent.name} harness log
              </h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Recent redacted output from the centralized agent host.
            </p>
          </div>
          <div className="flex gap-1">
            <Button
              aria-label="Copy log"
              disabled={!log?.output}
              onClick={() => {
                void navigator.clipboard.writeText(log?.output ?? "");
                toast.success("Log copied");
              }}
              size="icon"
              title="Copy log"
              variant="ghost"
            >
              <Clipboard />
            </Button>
            <Button
              aria-label="Refresh log"
              disabled={loading}
              onClick={() => void refresh()}
              size="icon"
              title="Refresh log"
              variant="ghost"
            >
              <RefreshCw className={loading ? "animate-spin" : undefined} />
            </Button>
            <Button
              aria-label="Close"
              onClick={onClose}
              size="icon"
              variant="ghost"
            >
              <X />
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-6">
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </p>
          ) : (
            <pre className="min-h-48 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-4 font-mono text-xs">
              {loading && !log
                ? "Loading harness output…"
                : log?.output || "No log output yet."}
            </pre>
          )}
          {log?.truncated ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Older output was discarded when the in-memory limit was reached.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
