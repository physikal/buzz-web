import { Bot, Headphones, Mic, MicOff, PhoneOff, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { ManagedAgent } from "@/features/agents/agent-api";
import type { UserProfile } from "@/features/channels/channel-api";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import type { useHuddle } from "./use-huddle";

type HuddleController = ReturnType<typeof useHuddle>;

export function HuddleHeaderButton({
  huddle,
  disabled,
  onStart,
}: {
  huddle: HuddleController;
  disabled?: boolean;
  onStart: () => void;
}) {
  const inSelectedHuddle =
    huddle.active?.ephemeralChannelId === huddle.joined?.ephemeralChannelId;
  const label = huddle.joined
    ? inSelectedHuddle
      ? "In huddle"
      : "Huddle active"
    : huddle.active
      ? `Join huddle with ${huddle.active.participants.length} participant${huddle.active.participants.length === 1 ? "" : "s"}`
      : "Start huddle";
  return (
    <Button
      aria-label={label}
      className={
        huddle.active || inSelectedHuddle ? "text-green-700" : undefined
      }
      disabled={disabled || huddle.pending || Boolean(huddle.joined)}
      onClick={() => {
        if (huddle.active)
          void huddle.join().catch((error) =>
            toast.error("Could not join huddle", {
              description:
                error instanceof Error ? error.message : "Audio setup failed.",
            }),
          );
        else onStart();
      }}
      size="icon"
      title={label}
      variant="ghost"
    >
      <Headphones className={inSelectedHuddle ? "fill-current" : undefined} />
    </Button>
  );
}

export function HuddleBar({
  huddle,
  channelName,
  profiles,
  agentNames,
}: {
  huddle: HuddleController;
  channelName: string | null;
  profiles: Map<string, UserProfile>;
  agentNames: Map<string, string>;
}) {
  if (!huddle.joined) return null;
  const names = huddle.joined.participants.map(
    (pubkey) =>
      agentNames.get(pubkey) ||
      profiles.get(pubkey)?.displayName ||
      truncatePubkey(pubkey),
  );
  return (
    <section
      aria-label="Active huddle"
      className="flex min-h-16 items-center gap-3 border-t bg-muted/35 px-3 sm:px-5"
    >
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-700 text-white">
        <Headphones className="h-4 w-4" />
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-green-400" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          Huddle in #{channelName ?? "channel"}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {names.length ? names.join(", ") : "Connected"}
        </p>
      </div>
      <span
        aria-label={`Microphone level ${Math.round(huddle.joined.micLevel * 100)} percent`}
        className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block"
        role="progressbar"
      >
        <span
          className="block h-full bg-green-600 transition-[width]"
          style={{
            width: `${huddle.muted ? 0 : huddle.joined.micLevel * 100}%`,
          }}
        />
      </span>
      <Button
        aria-label={huddle.muted ? "Unmute microphone" : "Mute microphone"}
        onClick={() => huddle.setMuted(!huddle.muted)}
        size="icon"
        variant={huddle.muted ? "destructive" : "outline"}
      >
        {huddle.muted ? <MicOff /> : <Mic />}
      </Button>
      <Button
        aria-label="Leave huddle"
        disabled={huddle.pending}
        onClick={() =>
          void huddle.leave().catch((error) =>
            toast.error("Could not leave huddle", {
              description:
                error instanceof Error ? error.message : "Relay update failed.",
            }),
          )
        }
        size="icon"
        variant="destructive"
      >
        <PhoneOff />
      </Button>
    </section>
  );
}

export function StartHuddleDialog({
  agents,
  huddle,
  open,
  onClose,
}: {
  agents: ManagedAgent[];
  huddle: HuddleController;
  open: boolean;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  if (!open) return null;
  return (
    <div
      aria-label="Start huddle"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-lg bg-background p-5 shadow-2xl">
        <header className="flex items-center gap-3">
          <Headphones className="h-5 w-5 text-muted-foreground" />
          <h2 className="min-w-0 flex-1 text-lg font-semibold">Start huddle</h2>
          <Button
            aria-label="Close"
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        <div className="mt-5">
          <h3 className="text-sm font-medium">Agents</h3>
          <div className="mt-2 divide-y rounded-md border">
            {agents.map((agent) => {
              const checked = selected.includes(agent.agent_pubkey);
              return (
                <label
                  className="flex cursor-pointer items-center gap-3 px-3 py-3 hover:bg-muted/60"
                  key={agent.id}
                >
                  <input
                    checked={checked}
                    onChange={() =>
                      setSelected((current) =>
                        checked
                          ? current.filter(
                              (pubkey) => pubkey !== agent.agent_pubkey,
                            )
                          : [...current, agent.agent_pubkey],
                      )
                    }
                    type="checkbox"
                  />
                  <Bot className="h-4 w-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {agent.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {agent.observed_state}
                  </span>
                </label>
              );
            })}
            {!agents.length ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                No configured agents
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={huddle.pending}
            onClick={() =>
              void huddle
                .start(selected)
                .then(onClose)
                .catch((error) =>
                  toast.error("Could not start huddle", {
                    description:
                      error instanceof Error
                        ? error.message
                        : "Audio setup failed.",
                  }),
                )
            }
          >
            <Headphones /> {huddle.pending ? "Starting…" : "Start"}
          </Button>
        </div>
      </div>
    </div>
  );
}
