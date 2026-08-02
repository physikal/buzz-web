import { Bot, KeyRound, RefreshCw, Terminal } from "lucide-react";

import type { AgentRuntimeCatalogEntry } from "@/features/agents/agent-api";
import { useAgentRuntimeCatalog } from "@/features/agents/runtime-catalog";
import { Button } from "@/shared/ui/button";

export function AgentRuntimesPanel() {
  const catalog = useAgentRuntimeCatalog();

  return (
    <section aria-labelledby="agent-runtimes-heading">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold" id="agent-runtimes-heading">
            Agent runtimes
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Agent tools available on the centralized host.
          </p>
        </div>
        <Button
          disabled={catalog.isFetching}
          onClick={() => void catalog.refetch()}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCw
            className={catalog.isFetching ? "animate-spin" : undefined}
          />
          Check again
        </Button>
      </header>

      {catalog.isPending ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Checking agent runtimes…
        </p>
      ) : (
        <div className="mt-6 divide-y rounded-md border">
          {catalog.runtimes.map((runtime) => (
            <RuntimeRow key={runtime.id} runtime={runtime} />
          ))}
        </div>
      )}
      {catalog.error instanceof Error ? (
        <p className="mt-3 text-sm text-destructive">{catalog.error.message}</p>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        Built-in runtimes ship in the agent image. Operators add custom ACP
        runtimes through the deployment image and runtime catalog.
      </p>
    </section>
  );
}

function RuntimeRow({ runtime }: { runtime: AgentRuntimeCatalogEntry }) {
  const Icon = runtime.id === "buzz-agent" ? Bot : Terminal;
  return (
    <div className="flex min-h-16 items-center gap-3 px-4 py-3">
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{runtime.label}</p>
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {runtime.source === "built-in" ? "Built in" : "Operator"}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {runtimeAuthDescription(runtime)}
        </p>
      </div>
      {runtime.supports_subscription ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5" /> Subscription
        </span>
      ) : null}
    </div>
  );
}

function runtimeAuthDescription(runtime: AgentRuntimeCatalogEntry) {
  if (runtime.supports_subscription) return "Subscription or API key";
  if (runtime.secret_fields.length === 1)
    return runtime.secret_fields[0]?.label ?? "Credential configured per agent";
  if (runtime.secret_fields.length > 1)
    return `${runtime.secret_fields.length} credentials configured per agent`;
  return runtime.id === "buzz-agent"
    ? "Provider API key configured per agent"
    : "No credentials required";
}
