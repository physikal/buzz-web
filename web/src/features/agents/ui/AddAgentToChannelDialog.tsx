import { Check, Copy, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import {
  addAgentToChannel,
  type AgentChannel,
  type AgentChannelRole,
  listAgentChannels,
} from "../agent-channels";
import type { ManagedAgent } from "../agent-api";
import { Button } from "@/shared/ui/button";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring";

export function AddAgentToChannelDialog({
  agent,
  open,
  previewChannels,
  onAdded,
  onClose,
}: {
  agent: ManagedAgent | null;
  open: boolean;
  previewChannels?: AgentChannel[];
  onAdded: (channel: AgentChannel) => void;
  onClose: () => void;
}) {
  const [channels, setChannels] = useState<AgentChannel[]>([]);
  const [channelId, setChannelId] = useState("");
  const [role, setRole] = useState<AgentChannelRole>("bot");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !agent) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const request = previewChannels
      ? Promise.resolve(previewChannels)
      : listAgentChannels(agent.agent_pubkey);
    void request
      .then((result) => {
        if (cancelled) return;
        setChannels(result);
        setChannelId((current) => current || result[0]?.id || "");
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Could not load channels.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agent, open, previewChannels]);

  if (!open || !agent) return null;
  const selectedAgent = agent;
  const selectedChannel =
    channels.find((channel) => channel.id === channelId) ?? null;

  function close() {
    if (submitting) return;
    resetAndClose();
  }

  function resetAndClose() {
    setChannels([]);
    setChannelId("");
    setRole("bot");
    setError(null);
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedChannel) return;
    setSubmitting(true);
    setError(null);
    try {
      if (!previewChannels) {
        await addAgentToChannel({
          channelId: selectedChannel.id,
          agentPubkey: selectedAgent.agent_pubkey,
          role,
        });
      }
      onAdded(selectedChannel);
      setSubmitting(false);
      resetAndClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not add the agent.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div
      aria-label="Add agent to channel"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) close();
      }}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border/60 px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold">Add agent to channel</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Add {agent.name} to a channel so desktop chat can `@mention` it.
              Running agents pick up new channels automatically via membership
              notifications.
            </p>
          </div>
          <Button
            aria-label="Close"
            disabled={submitting}
            onClick={close}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>

        <form
          className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5"
          id="add-agent-to-channel-form"
          onSubmit={submit}
        >
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="agent-channel-id">
              Channel
            </label>
            <select
              className={SELECT_CLASS}
              disabled={loading || submitting || channels.length === 0}
              id="agent-channel-id"
              onChange={(event) => setChannelId(event.target.value)}
              value={channelId}
            >
              {channels.length === 0 ? (
                <option value="">
                  {loading ? "Loading channels…" : "No channels available"}
                </option>
              ) : null}
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name} · {channel.visibility}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Only channels accessible to the connected owner are shown here.
            </p>
          </div>

          {selectedChannel?.alreadyMember ? (
            <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <Check className="h-4 w-4" />
              <span>Already a member of this channel</span>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="agent-channel-role">
              Role
            </label>
            <select
              className={SELECT_CLASS}
              disabled={submitting}
              id="agent-channel-role"
              onChange={(event) =>
                setRole(event.target.value as AgentChannelRole)
              }
              value={role}
            >
              <option value="bot">bot</option>
              <option value="member">member</option>
              <option value="guest">guest</option>
              <option value="admin">admin</option>
            </select>
          </div>

          <div className="rounded-md border border-border/70 bg-muted/20 p-4">
            <p className="text-sm font-semibold">Agent pubkey</p>
            <div className="mt-3 flex items-center gap-3">
              <code className="min-w-0 flex-1 break-all rounded-md border border-border/70 bg-background/80 px-3 py-2 text-xs">
                {agent.agent_pubkey}
              </code>
              <Button
                aria-label="Copy pubkey"
                onClick={() =>
                  void navigator.clipboard.writeText(agent.agent_pubkey)
                }
                size="icon"
                type="button"
                variant="outline"
              >
                <Copy />
              </Button>
            </div>
          </div>

          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-border/60 px-6 py-4">
          <Button
            disabled={submitting}
            onClick={close}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={!selectedChannel || loading || submitting}
            form="add-agent-to-channel-form"
            type="submit"
          >
            {submitting
              ? "Adding…"
              : selectedChannel?.alreadyMember
                ? "Re-add to channel"
                : "Add to channel"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
