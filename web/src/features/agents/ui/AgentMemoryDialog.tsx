import { useQuery } from "@tanstack/react-query";
import { Copy, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import type { ManagedAgent } from "../agent-api";
import { listAgentMemory } from "../agent-memory-api";

export function AgentMemoryDialog({
  agent,
  ownerPubkey,
  onClose,
}: {
  agent: ManagedAgent | null;
  ownerPubkey: string;
  onClose: () => void;
}) {
  useEscapeSurface(Boolean(agent), onClose);
  if (!agent) return null;
  return (
    <div
      aria-label={`${agent.name} memory`}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="flex max-h-[88dvh] w-full max-w-2xl flex-col rounded-lg bg-background shadow-2xl">
        <header className="flex items-start justify-between border-b px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold">{agent.name} memory</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Owner-readable NIP-AE memory from this agent.
            </p>
          </div>
          <div className="flex gap-1">
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
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <AgentMemoryPanel
            agentPubkey={agent.agent_pubkey}
            ownerPubkey={ownerPubkey}
          />
        </div>
      </div>
    </div>
  );
}

export function AgentMemoryPanel({
  agentPubkey,
  ownerPubkey,
}: {
  agentPubkey: string;
  ownerPubkey: string;
}) {
  const query = useQuery({
    queryKey: ["agent-memory", agentPubkey, ownerPubkey],
    queryFn: () => listAgentMemory(agentPubkey, ownerPubkey),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          aria-label="Refresh memory"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
          size="icon"
          title="Refresh memory"
          variant="ghost"
        >
          <RefreshCw
            className={query.isFetching ? "animate-spin" : undefined}
          />
        </Button>
      </div>
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Decrypting memory…</p>
      ) : query.error ? (
        <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">
          {query.error.message}
        </p>
      ) : query.data?.entries.length ? (
        <div className="space-y-3">
          {query.data.entries.map((entry) => (
            <article className="rounded-md border" key={entry.slug}>
              <header className="flex items-center justify-between border-b px-4 py-2">
                <code className="text-xs font-semibold">{entry.slug}</code>
                <Button
                  aria-label={`Copy ${entry.slug}`}
                  onClick={() => {
                    void navigator.clipboard.writeText(entry.value);
                    toast.success("Memory copied");
                  }}
                  size="icon"
                  title="Copy memory"
                  variant="ghost"
                >
                  <Copy />
                </Button>
              </header>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs">
                {entry.value}
              </pre>
            </article>
          ))}
          {query.data.limitReached ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              The relay returned its 500-event limit. This listing may be
              incomplete.
            </p>
          ) : null}
          {query.data.rejected ? (
            <p className="text-xs text-muted-foreground">
              {query.data.rejected} invalid or undecryptable record
              {query.data.rejected === 1 ? " was" : "s were"} ignored.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          This agent has not published any memory yet.
        </p>
      )}
    </div>
  );
}
