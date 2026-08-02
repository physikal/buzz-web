import { OctagonX, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  subscribeEvents,
  type NostrEvent,
  validNostrEvent,
} from "@/shared/lib/nostr-client";
import {
  nip44DecryptFromPeer,
  nip44EncryptToPeer,
} from "@/shared/lib/nostr-signer";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { Button } from "@/shared/ui/button";
import { getAgentActivity, type ManagedAgent } from "../agent-api";
import { AgentSessionTranscriptView } from "../session/AgentSessionTranscriptView";
import {
  buildTranscriptState,
  describeRawEvent,
} from "../session/agentSessionTranscript";
import type { ObserverEvent } from "../session/agentSessionTypes";

type ObserverFrame = ObserverEvent & {
  id: string;
};

type ConnectionState = "connecting" | "live" | "offline";

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
    void getAgentActivity(agent.id)
      .then(async (events) => {
        const archived = await Promise.all(
          events.map((event) =>
            parseObserverFrame(event, agent.agent_pubkey, ownerPubkey),
          ),
        );
        if (!active) return;
        for (const event of events) seen.current.add(event.id);
        setFrames((current) =>
          mergeObserverFrames(
            current,
            archived.filter((frame): frame is ObserverFrame => frame !== null),
          ),
        );
      })
      .catch(() => {
        // Live telemetry remains available if history retrieval is unavailable.
      });
    const subscription = subscribeEvents(
      relayWsUrl(),
      {
        kinds: [24200],
        "#p": [ownerPubkey],
        limit: 1000,
        since: Math.floor(Date.now() / 1000) - 300,
      },
      (event) => {
        if (!active || seen.current.has(event.id)) return;
        seen.current.add(event.id);
        void parseObserverFrame(event, agent.agent_pubkey, ownerPubkey).then(
          (frame) => {
            if (!active || !frame) return;
            setFrames((current) => mergeObserverFrames(current, [frame]));
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
  const transcript = useMemo(
    () => buildTranscriptState(frames).items,
    [frames],
  );
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
      <div className="flex max-h-[90dvh] w-full max-w-6xl flex-col rounded-lg bg-background shadow-2xl">
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
              {frames.length
                ? `${frames.length} encrypted event${frames.length === 1 ? "" : "s"} in this session`
                : "Waiting for the next agent turn."}
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
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <AgentSessionTranscriptView items={transcript} />
            <RawEventRail events={frames} />
          </div>
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
    !validNostrEvent(event) ||
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
      !/^[a-z][a-z0-9_./-]{0,63}$/.test(kind) ||
      payload === undefined
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
    const startedAt = nullableString(value.startedAt);
    const agentIndex =
      value.agentIndex === null || value.agentIndex === undefined
        ? null
        : Number.isSafeInteger(value.agentIndex) &&
            Number(value.agentIndex) >= 0
          ? Number(value.agentIndex)
          : undefined;
    if (
      channelId === undefined ||
      sessionId === undefined ||
      turnId === undefined ||
      startedAt === undefined ||
      agentIndex === undefined
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
      kind,
      agentIndex,
      channelId,
      sessionId,
      turnId,
      startedAt,
      payload,
    };
  } catch {
    return null;
  }
}

function mergeObserverFrames(
  current: ObserverFrame[],
  incoming: ObserverFrame[],
): ObserverFrame[] {
  const byId = new Map(current.map((frame) => [frame.id, frame]));
  for (const frame of incoming) byId.set(frame.id, frame);
  return [...byId.values()]
    .sort(
      (left, right) =>
        Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
        left.seq - right.seq,
    )
    .slice(-3_000);
}

function RawEventRail({ events }: { events: ObserverFrame[] }) {
  return (
    <section className="min-w-0 border-t pt-5 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
      <h3 className="text-sm font-semibold">Raw ACP events</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Decrypted locally for owner inspection.
      </p>
      {events.length ? (
        <div className="mt-3 space-y-2">
          {events.map((event) => (
            <details
              className="group rounded-md border border-border/55 bg-muted/25 px-2.5 py-1.5 open:bg-muted/35"
              key={event.id}
            >
              <summary className="cursor-pointer select-none text-xs text-muted-foreground group-open:text-foreground">
                <span className="font-mono text-muted-foreground/70">
                  #{event.seq}
                </span>{" "}
                {describeRawEvent(event)}
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/40 bg-background/45 p-2 font-mono text-xs leading-5 text-muted-foreground">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No raw events yet.
        </p>
      )}
    </section>
  );
}
