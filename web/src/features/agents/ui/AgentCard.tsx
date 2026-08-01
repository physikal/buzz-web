import {
  Activity,
  AlertTriangle,
  Bot,
  Brain,
  EllipsisVertical,
  KeyRound,
  MessageSquarePlus,
  OctagonX,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import type { ManagedAgent } from "../agent-api";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

const RUNTIME_LABELS: Record<ManagedAgent["runtime"], string> = {
  "buzz-agent": "Buzz Agent",
  codex: "Codex",
  claude: "Claude Code",
};

export function AgentCard({
  agent,
  pending,
  onAddToChannel,
  onAuthenticate,
  onDelete,
  onEdit,
  onViewActivity,
  onViewMemory,
  onSetRunning,
}: {
  agent: ManagedAgent;
  pending: boolean;
  onAddToChannel: () => void;
  onAuthenticate: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onViewActivity: () => void;
  onViewMemory: () => void;
  onSetRunning: (running: boolean) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const active = ["pending", "starting", "running", "stopping"].includes(
    agent.observed_state,
  );
  const status = statusLabel(agent);

  return (
    <article className="group relative aspect-[4/5] w-full min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-muted/50 text-left shadow-xs transition-colors hover:border-border hover:bg-muted/65">
      <div className="flex h-full flex-col items-center justify-center gap-5 px-4 pb-12 text-center">
        <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-secondary">
          <Bot className="h-10 w-10 text-secondary-foreground" />
          {active ? (
            <span
              className={`absolute right-1 bottom-1 h-4 w-4 rounded-full border-[3px] border-background ${agent.desired_state === "running" ? "bg-emerald-500" : "bg-amber-500"}`}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={`Start ${agent.name}`}
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 text-transparent transition-colors hover:bg-black/45 hover:text-white"
                  disabled={pending}
                  onClick={() =>
                    agent.credential_mode === "subscription"
                      ? onAuthenticate()
                      : onSetRunning(true)
                  }
                  type="button"
                >
                  <Play className="h-8 w-8 fill-current" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Start agent</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="absolute top-3 right-3 z-20">
        <Button
          aria-label={`${agent.name} actions`}
          className="h-8 w-8 bg-background/80"
          onClick={() => setMenuOpen((open) => !open)}
          size="icon"
          variant="outline"
        >
          <EllipsisVertical />
        </Button>
        {menuOpen ? (
          <div className="absolute top-10 right-0 z-30 w-40 rounded-md border bg-popover p-1 shadow-lg">
            <button
              className="flex h-9 w-full items-center gap-2 rounded px-2 text-sm hover:bg-accent disabled:opacity-50"
              disabled={pending || active || agent.desired_state !== "stopped"}
              onClick={() => {
                setMenuOpen(false);
                onEdit();
              }}
              type="button"
            >
              <Pencil className="h-4 w-4" /> Edit agent
            </button>
            <button
              className="flex h-9 w-full items-center gap-2 rounded px-2 text-sm hover:bg-accent"
              disabled={pending}
              onClick={() => {
                setMenuOpen(false);
                onAddToChannel();
              }}
              type="button"
            >
              <MessageSquarePlus className="h-4 w-4" /> Add to channel
            </button>
            <button
              className="flex h-9 w-full items-center gap-2 rounded px-2 text-sm hover:bg-accent"
              disabled={pending}
              onClick={() => {
                setMenuOpen(false);
                onViewMemory();
              }}
              type="button"
            >
              <Brain className="h-4 w-4" /> View memory
            </button>
            <button
              className="flex h-9 w-full items-center gap-2 rounded px-2 text-sm hover:bg-accent"
              disabled={pending}
              onClick={() => {
                setMenuOpen(false);
                onViewActivity();
              }}
              type="button"
            >
              <Activity className="h-4 w-4" /> View activity
            </button>
            {agent.credential_mode === "subscription" ? (
              <button
                className="flex h-9 w-full items-center gap-2 rounded px-2 text-sm hover:bg-accent"
                disabled={pending || active}
                onClick={() => {
                  setMenuOpen(false);
                  onAuthenticate();
                }}
                type="button"
              >
                <KeyRound className="h-4 w-4" /> Connect subscription
              </button>
            ) : null}
            {agent.desired_state === "running" && active ? (
              <button
                className="flex h-9 w-full items-center gap-2 rounded px-2 text-sm hover:bg-accent"
                disabled={pending}
                onClick={() => {
                  setMenuOpen(false);
                  onSetRunning(false);
                }}
                type="button"
              >
                <OctagonX className="h-4 w-4" /> Stop agent
              </button>
            ) : null}
            <button
              className="flex h-9 w-full items-center gap-2 rounded px-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
              disabled={pending || active || agent.desired_state !== "stopped"}
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
              type="button"
            >
              <Trash2 className="h-4 w-4" /> Delete agent
            </button>
          </div>
        ) : null}
      </div>

      <div className="absolute right-3 bottom-3 left-3 flex min-w-0 flex-col gap-0.5 text-left text-sm leading-5">
        <span className="truncate font-semibold">{agent.name}</span>
        <span className="truncate text-xs text-secondary-foreground/75">
          {agent.model || RUNTIME_LABELS[agent.runtime]}
        </span>
        {agent.observed_state === "error" ? (
          <Badge
            className="mt-1 w-fit gap-1"
            title={agent.last_error ?? undefined}
            variant="destructive"
          >
            <AlertTriangle className="h-3 w-3" /> Error
          </Badge>
        ) : (
          <span className="mt-0.5 text-xs capitalize text-muted-foreground">
            {status}
          </span>
        )}
      </div>
    </article>
  );
}

function statusLabel(agent: ManagedAgent): string {
  if (agent.observed_state === "pending" && agent.desired_state === "running") {
    return "Starting…";
  }
  return agent.observed_state.replace(/_/g, " ");
}
