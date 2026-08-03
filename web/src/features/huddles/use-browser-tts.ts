import { useEffect, useState } from "react";

import { listHuddleAgentPubkeys } from "./huddle-api";
import {
  localSpeechVoices,
  readTtsSettings,
  selectedSpeechVoice,
  TTS_SETTINGS_EVENT,
  writeTtsSettings,
} from "./tts-settings";
import { subscribeEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";

const AGENT_REFRESH_MS = 30_000;
const MAX_PENDING_MEMBERSHIP_EVENTS = 100;
const MAX_QUEUED_UTTERANCES = 50;
const MAX_SEEN_EVENTS = 5_000;
const MESSAGE_KINDS = [9, 40002];

function textWithoutAttachments(event: NostrEvent) {
  const urls = new Set(
    event.tags
      .filter((tag) => tag[0] === "imeta")
      .flatMap((tag) =>
        tag
          .slice(1)
          .filter((field) => field.startsWith("url "))
          .map((field) => field.slice(4)),
      ),
  );
  if (!urls.size) return event.content.trim();
  return event.content
    .split("\n")
    .filter((line) => ![...urls].some((url) => line.includes(`](${url})`)))
    .join("\n")
    .replace(/(^|\n)\s*\|\|\s*\n(?:\s*\n)*\s*\|\|\s*(?=\n|$)/gu, "$1")
    .trim();
}

export function useBrowserTts({
  ephemeralChannelId,
  ownerPubkey,
}: {
  ephemeralChannelId: string | null;
  ownerPubkey: string;
}) {
  const [settings, setSettings] = useState(() => readTtsSettings(ownerPubkey));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    localSpeechVoices(),
  );
  const selectedVoice = selectedSpeechVoice(voices, settings.voiceUri);

  useEffect(() => {
    const refresh = () => setSettings(readTtsSettings(ownerPubkey));
    refresh();
    window.addEventListener(TTS_SETTINGS_EVENT, refresh);
    return () => window.removeEventListener(TTS_SETTINGS_EVENT, refresh);
  }, [ownerPubkey]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const refresh = () => setVoices(localSpeechVoices());
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, []);

  useEffect(() => {
    if (!ephemeralChannelId || !settings.enabled) {
      window.speechSynthesis?.cancel();
      return;
    }
    const voice = selectedVoice;
    if (!voice) return;

    let membershipKnown = false;
    let membershipSettled = false;
    let disposed = false;
    const agentPubkeys = new Set<string>();
    const seen = new Set<string>();
    const seenOrder: string[] = [];
    let pending: NostrEvent[] = [];
    let queuedUtterances = 0;
    const speak = (event: NostrEvent) => {
      if (
        disposed ||
        seen.has(event.id) ||
        !agentPubkeys.has(event.pubkey) ||
        event.pubkey === ownerPubkey
      )
        return;
      seen.add(event.id);
      seenOrder.push(event.id);
      if (seenOrder.length > MAX_SEEN_EVENTS) {
        const oldest = seenOrder.shift();
        if (oldest) seen.delete(oldest);
      }
      const text = textWithoutAttachments(event);
      if (
        !text ||
        text.startsWith("[System]") ||
        queuedUtterances >= MAX_QUEUED_UTTERANCES
      )
        return;
      queuedUtterances += 1;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      const release = () => {
        queuedUtterances = Math.max(0, queuedUtterances - 1);
      };
      utterance.addEventListener("end", release, { once: true });
      utterance.addEventListener("error", release, { once: true });
      window.speechSynthesis.speak(utterance);
    };
    const loadMembership = async () => {
      try {
        const pubkeys = await listHuddleAgentPubkeys(ephemeralChannelId);
        if (disposed) return;
        agentPubkeys.clear();
        for (const pubkey of pubkeys) agentPubkeys.add(pubkey);
        membershipKnown = true;
        membershipSettled = true;
        const buffered = pending;
        pending = [];
        for (const event of buffered) speak(event);
      } catch {
        agentPubkeys.clear();
        membershipKnown = false;
        membershipSettled = true;
        pending = [];
      }
    };
    void loadMembership();
    const refreshTimer = window.setInterval(loadMembership, AGENT_REFRESH_MS);
    const subscription = subscribeEvents(
      relayWsUrl(),
      { kinds: MESSAGE_KINDS, "#h": [ephemeralChannelId], limit: 0 },
      (event) => {
        if (disposed) return;
        if (!membershipKnown) {
          if (!membershipSettled) {
            pending.push(event);
            if (pending.length > MAX_PENDING_MEMBERSHIP_EVENTS) pending.shift();
          }
          return;
        }
        speak(event);
      },
      { requireNip07: true },
    );

    return () => {
      disposed = true;
      window.clearInterval(refreshTimer);
      subscription.close();
      window.speechSynthesis.cancel();
    };
  }, [ephemeralChannelId, ownerPubkey, selectedVoice, settings.enabled]);

  return {
    ttsEnabled: settings.enabled,
    ttsAvailable: Boolean(selectedVoice),
    setTtsEnabled(enabled: boolean) {
      writeTtsSettings(ownerPubkey, { ...settings, enabled });
    },
  };
}
