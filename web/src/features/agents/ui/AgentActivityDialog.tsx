import { Activity, OctagonX, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { subscribeEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import {
  nip44DecryptFromPeer,
  nip44EncryptToPeer,
} from "@/shared/lib/nostr-signer";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { Button } from "@/shared/ui/button";
import type { ManagedAgent } from "../agent-api";

type ObserverFrame = {
  id: string;
  seq: number;
  timestamp: string;
  kind: "acp_read" | "acp_write" | "turn_started" | "session_resolved";
  channelId: string | null;
  sessionId: string | null;
  turnId: string | null;
  payload: Record<string, unknown>;
};

type ConnectionState = "connecting" | "live" | "offline";
const KNOWN_KINDS = new Set([
  "acp_read",
  "acp_write",
  "turn_started",
  "session_resolved",
]);

export function AgentActivityDialog({
  agent,
  ownerPubkey,
  onClose,
}: {
  agent: ManagedAgent | null;
  ownerPubkey: string;
  onClose: () => void;
}) {
  const [generation, setGeneration] = useState(0);
  const [frames, setFrames] = useState<ObserverFrame[]>([]);
  const [status, setStatus] = useState<ConnectionState>("connecting");
  const [cancelling, setCancelling] = useState(false);
  const seen = useRef(new Set<string>());
  // generation intentionally restarts the ephemeral subscription on demand.
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit reconnect trigger
  useEffect(() => {
    if (!agent) return;
    let active = true;
    setFrames([]);
    seen.current.clear();
    const subscription = subscribeEvents(
      relayWsUrl(),
      {
        kinds: [24200],
        "#p": [ownerPubkey],
        since: Math.floor(Date.now() / 1000),
      },
      (event) => {
        if (!active || seen.current.has(event.id)) return;
        seen.current.add(event.id);
        void parseObserverFrame(event, agent.agent_pubkey, ownerPubkey).then(
          (frame) => {
            if (!active || !frame) return;
            setFrames((current) =>
              [...current, frame]
                .sort(
                  (a, b) =>
                    Date.parse(a.timestamp) - Date.parse(b.timestamp) ||
                    a.seq - b.seq,
                )
                .slice(-800),
            );
          },
        );
      },
      { requireNip07: true, onStatus: setStatus },
    );
    return () => {
      active = false;
      subscription.close();
      setFrames([]);
      seen.current.clear();
    };
  }, [agent, generation, ownerPubkey]);
  if (!agent) return null;
  const activeAgent = agent;
  const activeChannelId = [...frames]
    .reverse()
    .find((frame) => frame.channelId)?.channelId;
  async function cancelTurn() {
    if (!activeChannelId) return;
    setCancelling(true);
    try {
      const content = await nip44EncryptToPeer(
        activeAgent.agent_pubkey,
        JSON.stringify({ type: "cancel_turn", channelId: activeChannelId }),
      );
      await submitEvent({
        kind: 24200,
        tags: [
          ["p", activeAgent.agent_pubkey],
          ["agent", activeAgent.agent_pubkey],
          ["frame", "control"],
          ["h", activeChannelId],
        ],
        content,
      });
      toast.success("Cancel request sent");
    } catch (error) {
      toast.error("Could not cancel turn", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setCancelling(false);
    }
  }
  return (
    <div
      aria-label={`${agent.name} activity`}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="flex max-h-[88dvh] w-full max-w-3xl flex-col rounded-lg bg-background shadow-2xl">
        <header className="flex items-start justify-between border-b px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{agent.name} activity</h2>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span
                  className={`h-2 w-2 rounded-full ${status === "live" ? "bg-emerald-500" : status === "connecting" ? "bg-amber-500" : "bg-muted-foreground"}`}
                />
                {status}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Live encrypted ACP telemetry. Frames are held only in this window.
            </p>
          </div>
          <div className="flex gap-1">
            <Button
              aria-label="Cancel active turn"
              disabled={!activeChannelId || cancelling}
              onClick={() => void cancelTurn()}
              size="icon"
              title="Cancel active turn"
              variant="ghost"
            >
              <OctagonX />
            </Button>
            <Button
              aria-label="Reconnect activity"
              onClick={() => setGeneration((value) => value + 1)}
              size="icon"
              title="Reconnect activity"
              variant="ghost"
            >
              <RefreshCw />
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
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {frames.length ? (
            <div className="space-y-2">
              {frames.map((frame) => (
                <article className="rounded-md border p-4" key={frame.id}>
                  <header className="flex items-center gap-2 text-xs">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <strong>{frameLabel(frame.kind)}</strong>
                    <time className="ml-auto text-muted-foreground">
                      {new Date(frame.timestamp).toLocaleTimeString()}
                    </time>
                  </header>
                  <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
                    {JSON.stringify(frame.payload, null, 2)}
                  </pre>
                </article>
              ))}
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Waiting for the next agent turn…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

async function parseObserverFrame(
  event: NostrEvent,
  agentPubkey: string,
  ownerPubkey: string,
): Promise<ObserverFrame | null> {
  const exact = (name: string) =>
    event.tags.filter((tag) => tag.length === 2 && tag[0] === name);
  if (
    event.kind !== 24200 ||
    event.pubkey !== agentPubkey ||
    exact("p").length !== 1 ||
    exact("p")[0][1] !== ownerPubkey ||
    exact("agent").length !== 1 ||
    exact("agent")[0][1] !== agentPubkey ||
    exact("frame").length !== 1 ||
    exact("frame")[0][1] !== "telemetry"
  )
    return null;
  try {
    const plaintext = await nip44DecryptFromPeer(agentPubkey, event.content);
    if (new TextEncoder().encode(plaintext).length > 65_535) return null;
    const value = JSON.parse(plaintext) as Record<string, unknown>;
    const { seq, timestamp, kind, payload } = value;
    if (
      !Number.isSafeInteger(seq) ||
      Number(seq) < 0 ||
      typeof timestamp !== "string" ||
      timestamp.length > 64 ||
      !Number.isFinite(Date.parse(timestamp)) ||
      typeof kind !== "string" ||
      !KNOWN_KINDS.has(kind) ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    )
      return null;
    const nullableString = (input: unknown) =>
      input === null || input === undefined
        ? null
        : typeof input === "string" && input.length <= 255
          ? input
          : undefined;
    const channelId = nullableString(value.channelId);
    const sessionId = nullableString(value.sessionId);
    const turnId = nullableString(value.turnId);
    if (
      channelId === undefined ||
      sessionId === undefined ||
      turnId === undefined
    )
      return null;
    if (
      channelId !== null &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        channelId,
      )
    )
      return null;
    return {
      id: event.id,
      seq: Number(seq),
      timestamp,
      kind: kind as ObserverFrame["kind"],
      channelId,
      sessionId,
      turnId,
      payload: payload as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

function frameLabel(kind: ObserverFrame["kind"]) {
  return {
    acp_read: "Agent received",
    acp_write: "Agent sent",
    turn_started: "Turn started",
    session_resolved: "Session resolved",
  }[kind];
}
