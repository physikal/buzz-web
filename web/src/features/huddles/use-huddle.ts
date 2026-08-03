import { useCallback, useEffect, useRef, useState } from "react";

import type { NostrEvent } from "@/shared/lib/nostr-client";
import { BrowserHuddleAudio, type HuddleAudioUpdate } from "./huddle-audio";
import { useBrowserTts } from "./use-browser-tts";
import {
  addAgentToHuddle,
  createHuddle,
  getHuddleEvents,
  leaveHuddleChannel,
  listHuddleAgentPubkeys,
  reconstructActiveHuddle,
  sendHuddleReaction,
  subscribeHuddleEvents,
  subscribeHuddleReactions,
  type ActiveHuddle,
  type HuddleReaction,
} from "./huddle-api";

export type VoiceInputMode = "push_to_talk" | "voice_activity";

export type JoinedHuddle = {
  parentChannelId: string;
  ephemeralChannelId: string;
  isCreator: boolean;
  participants: string[];
  agentPubkeys: string[];
  activeSpeakers: string[];
  micLevel: number;
};

export function useHuddle({
  channelId,
  channelName,
  ownerPubkey,
}: {
  channelId: string | null;
  channelName: string | null;
  ownerPubkey: string;
}) {
  const [active, setActive] = useState<ActiveHuddle | null>(null);
  const [joined, setJoined] = useState<JoinedHuddle | null>(null);
  const [pending, setPending] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceInputMode, setVoiceInputModeState] = useState<VoiceInputMode>(
    () =>
      localStorage.getItem("buzz-web:huddle-input-mode") === "push_to_talk"
        ? "push_to_talk"
        : "voice_activity",
  );
  const [pttActive, setPttActive] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState("");
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState("");
  const [inputGain, setInputGainState] = useState(1);
  const [reactions, setReactions] = useState<HuddleReaction[]>([]);
  const audioRef = useRef<BrowserHuddleAudio | null>(null);
  const reactionTimersRef = useRef(new Map<string, number>());
  const joinedHuddleId = joined?.ephemeralChannelId ?? null;
  const tts = useBrowserTts({
    ephemeralChannelId: joinedHuddleId,
    ownerPubkey,
  });

  const burstReaction = useCallback((reaction: HuddleReaction) => {
    if (reactionTimersRef.current.has(reaction.id)) return;
    setReactions((current) => [...current.slice(-5), reaction]);
    const timer = window.setTimeout(() => {
      reactionTimersRef.current.delete(reaction.id);
      setReactions((current) =>
        current.filter((item) => item.id !== reaction.id),
      );
    }, 4_000);
    reactionTimersRef.current.set(reaction.id, timer);
  }, []);

  useEffect(() => {
    if (!channelId) {
      setActive(null);
      return;
    }
    let disposed = false;
    const events = new Map<string, NostrEvent>();
    const update = () => {
      if (!disposed) setActive(reconstructActiveHuddle(events.values()));
    };
    void getHuddleEvents(channelId)
      .then((initial) => {
        for (const event of initial) events.set(event.id, event);
        update();
      })
      .catch(() => {});
    const subscription = subscribeHuddleEvents(channelId, (event) => {
      events.set(event.id, event);
      update();
    });
    return () => {
      disposed = true;
      subscription.close();
    };
  }, [channelId]);

  useEffect(
    () => () => {
      audioRef.current?.stop();
      audioRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!joinedHuddleId) {
      setReactions([]);
      return;
    }
    const subscription = subscribeHuddleReactions(
      joinedHuddleId,
      burstReaction,
    );
    return () => {
      subscription.close();
      for (const timer of reactionTimersRef.current.values())
        window.clearTimeout(timer);
      reactionTimersRef.current.clear();
      setReactions([]);
    };
  }, [burstReaction, joinedHuddleId]);

  useEffect(() => {
    if (!joinedHuddleId) return;
    const refresh = () => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((devices) =>
          setAudioDevices(
            devices.filter(
              (device) =>
                device.kind === "audioinput" || device.kind === "audiooutput",
            ),
          ),
        )
        .catch(() => {});
    };
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () =>
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, [joinedHuddleId]);

  useEffect(() => {
    if (!joinedHuddleId || voiceInputMode !== "push_to_talk" || muted) {
      setPttActive(false);
      audioRef.current?.setTransmitting(voiceInputMode === "voice_activity");
      return;
    }
    audioRef.current?.setTransmitting(false);
    const editableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(
        element?.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(element?.tagName ?? ""),
      );
    };
    const keyDown = (event: KeyboardEvent) => {
      if (
        event.code !== "Space" ||
        !event.ctrlKey ||
        event.repeat ||
        editableTarget(event.target)
      )
        return;
      event.preventDefault();
      setPttActive(true);
      audioRef.current?.setTransmitting(true);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      setPttActive(false);
      audioRef.current?.setTransmitting(false);
    };
    const release = () => {
      setPttActive(false);
      audioRef.current?.setTransmitting(false);
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", release);
      release();
    };
  }, [joinedHuddleId, muted, voiceInputMode]);

  const applyAudioUpdate = useCallback((update: HuddleAudioUpdate) => {
    setJoined((current) => (current ? { ...current, ...update } : null));
  }, []);

  const connect = useCallback(
    async (
      parentChannelId: string,
      ephemeralChannelId: string,
      isCreator: boolean,
      knownAgentPubkeys: string[] = [],
    ) => {
      let ready = false;
      let latest: HuddleAudioUpdate = {
        participants: [],
        activeSpeakers: [],
        micLevel: 0,
      };
      const audio = new BrowserHuddleAudio(
        (update) => {
          latest = update;
          if (ready) applyAudioUpdate(update);
        },
        (audioError) => {
          if (!ready) return;
          audioRef.current = null;
          setJoined(null);
          setMutedState(false);
          setError(audioError.message);
        },
      );
      audioRef.current = audio;
      await audio.connect(ephemeralChannelId, parentChannelId);
      audio.setInputGain(inputGain);
      audio.setTransmitting(voiceInputMode === "voice_activity");
      const agentPubkeys = await listHuddleAgentPubkeys(ephemeralChannelId)
        .then((pubkeys) => [...new Set([...knownAgentPubkeys, ...pubkeys])])
        .catch(() => knownAgentPubkeys);
      ready = true;
      setJoined({
        parentChannelId,
        ephemeralChannelId,
        isCreator,
        agentPubkeys,
        ...latest,
      });
    },
    [applyAudioUpdate, inputGain, voiceInputMode],
  );

  const start = useCallback(
    async (agentPubkeys: string[]) => {
      if (!channelId || !channelName || pending || joined) return;
      setPending(true);
      setError(null);
      let ephemeralChannelId: string | null = null;
      try {
        ephemeralChannelId = await createHuddle({
          parentChannelId: channelId,
          parentChannelName: channelName,
          agentPubkeys,
        });
        await connect(channelId, ephemeralChannelId, true, agentPubkeys);
      } catch (cause) {
        audioRef.current?.stop();
        audioRef.current = null;
        setJoined(null);
        if (ephemeralChannelId)
          await leaveHuddleChannel(channelId, ephemeralChannelId, true).catch(
            () => {},
          );
        setError(
          cause instanceof Error ? cause.message : "Could not start huddle.",
        );
        throw cause;
      } finally {
        setPending(false);
      }
    },
    [channelId, channelName, connect, joined, pending],
  );

  const join = useCallback(async () => {
    if (!channelId || !active || pending || joined) return;
    setPending(true);
    setError(null);
    try {
      await connect(channelId, active.ephemeralChannelId, false);
    } catch (cause) {
      audioRef.current?.stop();
      audioRef.current = null;
      setJoined(null);
      setError(
        cause instanceof Error ? cause.message : "Could not join huddle.",
      );
      throw cause;
    } finally {
      setPending(false);
    }
  }, [active, channelId, connect, joined, pending]);

  const leave = useCallback(async () => {
    if (!joined || pending) return;
    setPending(true);
    setError(null);
    audioRef.current?.stop();
    audioRef.current = null;
    try {
      await leaveHuddleChannel(
        joined.parentChannelId,
        joined.ephemeralChannelId,
        joined.isCreator,
      );
      setJoined(null);
      setMutedState(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not leave huddle.",
      );
      setJoined(null);
      throw cause;
    } finally {
      setPending(false);
    }
  }, [joined, pending]);

  const setMuted = useCallback((value: boolean) => {
    setMutedState(value);
    audioRef.current?.setMuted(value);
  }, []);

  const setVoiceInputMode = useCallback((mode: VoiceInputMode) => {
    setVoiceInputModeState(mode);
    localStorage.setItem("buzz-web:huddle-input-mode", mode);
    setPttActive(false);
    audioRef.current?.setTransmitting(mode === "voice_activity");
  }, []);

  const setInputGain = useCallback((value: number) => {
    const normalized = Math.max(0, Math.min(2, value));
    setInputGainState(normalized);
    audioRef.current?.setInputGain(normalized);
  }, []);

  const setInputDevice = useCallback(async (deviceId: string) => {
    await audioRef.current?.setInputDevice(deviceId);
    setSelectedInputDeviceId(deviceId);
  }, []);

  const setOutputDevice = useCallback(async (deviceId: string) => {
    await audioRef.current?.setOutputDevice(deviceId);
    setSelectedOutputDeviceId(deviceId);
  }, []);

  const react = useCallback(
    async (emoji: string, senderName: string, emojiUrl?: string) => {
      if (!joined) return;
      const reaction = await sendHuddleReaction({
        ephemeralChannelId: joined.ephemeralChannelId,
        emoji,
        senderName,
        emojiUrl,
      });
      if (reaction) burstReaction(reaction);
    },
    [burstReaction, joined],
  );

  const addAgent = useCallback(
    async (pubkey: string) => {
      if (!joined) throw new Error("Join the huddle before adding an agent.");
      const result = await addAgentToHuddle(
        joined.parentChannelId,
        joined.ephemeralChannelId,
        pubkey,
      );
      setJoined((current) =>
        current && current.ephemeralChannelId === joined.ephemeralChannelId
          ? {
              ...current,
              agentPubkeys: [...new Set([...current.agentPubkeys, pubkey])],
            }
          : current,
      );
      return result;
    },
    [joined],
  );

  return {
    active,
    joined,
    pending,
    muted,
    voiceInputMode,
    pttActive,
    audioDevices,
    selectedInputDeviceId,
    selectedOutputDeviceId,
    inputGain,
    reactions,
    ttsEnabled: tts.ttsEnabled,
    ttsAvailable: tts.ttsAvailable,
    error,
    clearError: () => setError(null),
    start,
    join,
    leave,
    setMuted,
    setVoiceInputMode,
    setInputGain,
    setInputDevice,
    setOutputDevice,
    setTtsEnabled: tts.setTtsEnabled,
    react,
    addAgent,
  };
}
