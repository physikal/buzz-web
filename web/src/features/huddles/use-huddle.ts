import { useCallback, useEffect, useRef, useState } from "react";

import type { NostrEvent } from "@/shared/lib/nostr-client";
import { BrowserHuddleAudio, type HuddleAudioUpdate } from "./huddle-audio";
import {
  createHuddle,
  getHuddleEvents,
  leaveHuddleChannel,
  reconstructActiveHuddle,
  subscribeHuddleEvents,
  type ActiveHuddle,
} from "./huddle-api";

export type JoinedHuddle = {
  parentChannelId: string;
  ephemeralChannelId: string;
  isCreator: boolean;
  participants: string[];
  activeSpeakers: string[];
  micLevel: number;
};

export function useHuddle({
  channelId,
  channelName,
}: {
  channelId: string | null;
  channelName: string | null;
}) {
  const [active, setActive] = useState<ActiveHuddle | null>(null);
  const [joined, setJoined] = useState<JoinedHuddle | null>(null);
  const [pending, setPending] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<BrowserHuddleAudio | null>(null);

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

  const applyAudioUpdate = useCallback((update: HuddleAudioUpdate) => {
    setJoined((current) => (current ? { ...current, ...update } : null));
  }, []);

  const connect = useCallback(
    async (
      parentChannelId: string,
      ephemeralChannelId: string,
      isCreator: boolean,
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
      ready = true;
      setJoined({
        parentChannelId,
        ephemeralChannelId,
        isCreator,
        ...latest,
      });
    },
    [applyAudioUpdate],
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
        await connect(channelId, ephemeralChannelId, true);
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

  return {
    active,
    joined,
    pending,
    muted,
    error,
    clearError: () => setError(null),
    start,
    join,
    leave,
    setMuted,
  };
}
