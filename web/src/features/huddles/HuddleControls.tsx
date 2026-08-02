import {
  Bot,
  Headphones,
  Mic,
  MicOff,
  PhoneOff,
  Settings2,
  SmilePlus,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { ManagedAgent } from "@/features/agents/agent-api";
import type { UserProfile } from "@/features/channels/channel-api";
import type { CustomEmoji } from "@/features/settings/custom-emoji-api";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
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
  agents,
  customEmoji,
  ownerPubkey,
}: {
  huddle: HuddleController;
  channelName: string | null;
  profiles: Map<string, UserProfile>;
  agentNames: Map<string, string>;
  agents: ManagedAgent[];
  customEmoji: CustomEmoji[];
  ownerPubkey: string;
}) {
  const [reactionOpen, setReactionOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  if (!huddle.joined) return null;
  const names = huddle.joined.participants.map(
    (pubkey) =>
      agentNames.get(pubkey) ||
      profiles.get(pubkey)?.displayName ||
      truncatePubkey(pubkey),
  );
  const senderName =
    profiles.get(ownerPubkey)?.displayName || truncatePubkey(ownerPubkey);
  const inputDevices = huddle.audioDevices.filter(
    (device) => device.kind === "audioinput",
  );
  const outputDevices = huddle.audioDevices.filter(
    (device) => device.kind === "audiooutput",
  );
  return (
    <section
      aria-label="Active huddle"
      className="relative flex min-h-16 items-center gap-3 border-t bg-muted/35 px-3 sm:px-5"
    >
      {huddle.reactions.length ? (
        <div
          aria-live="polite"
          className="pointer-events-none absolute bottom-full left-1/2 z-20 flex -translate-x-1/2 gap-2 pb-3"
        >
          {huddle.reactions.map((reaction) => (
            <span
              className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-lg"
              key={reaction.id}
            >
              {reaction.emojiUrl ? (
                <img
                  alt={reaction.emoji}
                  className="h-5 w-5 object-contain"
                  src={reaction.emojiUrl}
                />
              ) : (
                <span className="text-lg">{reaction.emoji}</span>
              )}
              <span className="max-w-28 truncate text-xs text-muted-foreground">
                {reaction.senderName}
              </span>
            </span>
          ))}
        </div>
      ) : null}
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
        aria-label={
          huddle.muted
            ? "Unmute microphone"
            : huddle.voiceInputMode === "push_to_talk"
              ? huddle.pttActive
                ? "Push to talk active"
                : "Push to talk ready"
              : "Mute microphone"
        }
        onClick={() => huddle.setMuted(!huddle.muted)}
        size="icon"
        variant={huddle.muted ? "destructive" : "outline"}
      >
        {huddle.muted ? <MicOff /> : <Mic />}
      </Button>
      <div className="relative">
        <Button
          aria-label="Emoji reactions"
          aria-pressed={reactionOpen}
          onClick={() => {
            setReactionOpen((value) => !value);
            setControlsOpen(false);
          }}
          size="icon"
          variant="outline"
        >
          <SmilePlus />
        </Button>
        {reactionOpen ? (
          <div className="absolute bottom-12 right-0 z-30 flex max-w-72 flex-wrap rounded-md border bg-popover p-1 shadow-lg">
            {["👍", "❤️", "😂", "🎉", "👀"].map((emoji) => (
              <button
                className="rounded p-1.5 text-lg hover:bg-muted"
                key={emoji}
                onClick={() => {
                  setReactionOpen(false);
                  void huddle.react(emoji, senderName).catch((error) =>
                    toast.error("Could not send reaction", {
                      description:
                        error instanceof Error ? error.message : undefined,
                    }),
                  );
                }}
                type="button"
              >
                {emoji}
              </button>
            ))}
            {customEmoji.map((emoji) => (
              <button
                aria-label={`React with :${emoji.shortcode}:`}
                className="rounded p-1.5 hover:bg-muted"
                key={emoji.shortcode}
                onClick={() => {
                  setReactionOpen(false);
                  void huddle
                    .react(`:${emoji.shortcode}:`, senderName, emoji.url)
                    .catch((error) =>
                      toast.error("Could not send reaction", {
                        description:
                          error instanceof Error ? error.message : undefined,
                      }),
                    );
                }}
                type="button"
              >
                <img
                  alt=""
                  className="h-5 w-5 object-contain"
                  src={emoji.url}
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <Button
        aria-label="Add agent to huddle"
        onClick={() => setAgentOpen(true)}
        size="icon"
        variant="outline"
      >
        <Bot />
      </Button>
      <div className="relative">
        <Button
          aria-label="Huddle audio settings"
          aria-pressed={controlsOpen}
          onClick={() => {
            setControlsOpen((value) => !value);
            setReactionOpen(false);
          }}
          size="icon"
          variant="outline"
        >
          <Settings2 />
        </Button>
        {controlsOpen ? (
          <div className="absolute bottom-12 right-0 z-30 w-72 space-y-4 rounded-md border bg-popover p-4 shadow-lg">
            <div>
              <span className="text-xs font-medium">Input mode</span>
              <div className="mt-2 grid grid-cols-2 rounded-md border p-0.5">
                <button
                  className={`rounded px-2 py-1.5 text-xs ${huddle.voiceInputMode === "voice_activity" ? "bg-accent font-medium" : "text-muted-foreground"}`}
                  onClick={() => huddle.setVoiceInputMode("voice_activity")}
                  type="button"
                >
                  Voice activity
                </button>
                <button
                  className={`rounded px-2 py-1.5 text-xs ${huddle.voiceInputMode === "push_to_talk" ? "bg-accent font-medium" : "text-muted-foreground"}`}
                  onClick={() => huddle.setVoiceInputMode("push_to_talk")}
                  type="button"
                >
                  Push to talk
                </button>
              </div>
            </div>
            <DeviceSelect
              devices={inputDevices}
              label="Microphone"
              selectedId={huddle.selectedInputDeviceId}
              onChange={(id) => huddle.setInputDevice(id)}
            />
            {outputDevices.length ? (
              <DeviceSelect
                devices={outputDevices}
                label="Speaker"
                selectedId={huddle.selectedOutputDeviceId}
                onChange={(id) => huddle.setOutputDevice(id)}
              />
            ) : null}
            <label className="block text-xs font-medium" htmlFor="huddle-gain">
              Input volume
              <span className="mt-2 flex items-center gap-2">
                <input
                  aria-label="Input volume"
                  className="w-full accent-foreground"
                  id="huddle-gain"
                  max="2"
                  min="0"
                  step="0.05"
                  type="range"
                  value={huddle.inputGain}
                  onChange={(event) =>
                    huddle.setInputGain(Number(event.target.value))
                  }
                />
                <span className="w-10 text-right text-muted-foreground">
                  {Math.round(huddle.inputGain * 100)}%
                </span>
              </span>
            </label>
          </div>
        ) : null}
      </div>
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
      <AddHuddleAgentDialog
        agents={agents}
        currentPubkeys={huddle.joined.agentPubkeys}
        huddle={huddle}
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
      />
    </section>
  );
}

function DeviceSelect({
  devices,
  selectedId,
  label,
  onChange,
}: {
  devices: MediaDeviceInfo[];
  selectedId: string;
  label: string;
  onChange: (id: string) => Promise<void>;
}) {
  return (
    <label className="block text-xs font-medium">
      {label}
      <select
        aria-label={label}
        className="mt-2 h-9 w-full rounded-md border bg-background px-2 text-xs"
        value={selectedId}
        onChange={(event) =>
          void onChange(event.target.value).catch((error) =>
            toast.error(`Could not change ${label.toLowerCase()}`, {
              description: error instanceof Error ? error.message : undefined,
            }),
          )
        }
      >
        <option value="">System default</option>
        {devices.map((device, index) => (
          <option
            key={device.deviceId || `${device.kind}-${index}`}
            value={device.deviceId}
          >
            {device.label || `${label} ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function AddHuddleAgentDialog({
  open,
  agents,
  currentPubkeys,
  huddle,
  onClose,
}: {
  open: boolean;
  agents: ManagedAgent[];
  currentPubkeys: string[];
  huddle: HuddleController;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  useEscapeSurface(open, onClose, adding !== null);
  if (!open) return null;
  const available = agents.filter(
    (agent) =>
      !currentPubkeys.includes(agent.agent_pubkey) &&
      agent.observed_state === "running",
  );
  return (
    <div
      aria-label="Add agent to huddle"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-lg bg-background p-5 shadow-2xl">
        <header className="flex items-center gap-3">
          <Bot className="h-5 w-5 text-muted-foreground" />
          <h2 className="min-w-0 flex-1 text-lg font-semibold">Add agent</h2>
          <Button
            aria-label="Close"
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        <div className="mt-4 divide-y rounded-md border">
          {available.map((agent) => (
            <button
              className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted disabled:opacity-50"
              disabled={adding !== null}
              key={agent.id}
              onClick={() => {
                setAdding(agent.agent_pubkey);
                void huddle
                  .addAgent(agent.agent_pubkey)
                  .then(({ parentWarning }) => {
                    if (parentWarning)
                      toast.warning("Agent joined the huddle", {
                        description: `Parent channel: ${parentWarning}`,
                      });
                    else toast.success(`${agent.name} added to huddle`);
                    onClose();
                  })
                  .catch((error) =>
                    toast.error("Could not add agent", {
                      description:
                        error instanceof Error ? error.message : undefined,
                    }),
                  )
                  .finally(() => setAdding(null));
              }}
              type="button"
            >
              <Bot className="h-4 w-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {agent.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {adding === agent.agent_pubkey ? "Adding…" : "running"}
              </span>
            </button>
          ))}
          {!available.length ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No additional running agents
            </p>
          ) : null}
        </div>
      </div>
    </div>
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
  useEscapeSurface(open, onClose, huddle.pending);
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
