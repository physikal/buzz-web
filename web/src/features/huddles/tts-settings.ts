export type WebTtsSettings = {
  enabled: boolean;
  voiceUri: string | null;
};

export const TTS_SETTINGS_EVENT = "buzz-web:tts-settings";

const DEFAULT_TTS_SETTINGS: WebTtsSettings = {
  enabled: true,
  voiceUri: null,
};

function storageKey(ownerPubkey: string) {
  return `buzz-web:tts-settings:${ownerPubkey}`;
}

export function readTtsSettings(ownerPubkey: string): WebTtsSettings {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(storageKey(ownerPubkey)) ?? "null",
    ) as unknown;
    if (!parsed || typeof parsed !== "object") return DEFAULT_TTS_SETTINGS;
    const value = parsed as Record<string, unknown>;
    return {
      enabled:
        typeof value.enabled === "boolean"
          ? value.enabled
          : DEFAULT_TTS_SETTINGS.enabled,
      voiceUri:
        typeof value.voiceUri === "string" && value.voiceUri.length <= 1_024
          ? value.voiceUri
          : null,
    };
  } catch {
    return DEFAULT_TTS_SETTINGS;
  }
}

export function writeTtsSettings(
  ownerPubkey: string,
  settings: WebTtsSettings,
) {
  localStorage.setItem(storageKey(ownerPubkey), JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent(TTS_SETTINGS_EVENT));
}

export function localSpeechVoices(): SpeechSynthesisVoice[] {
  if (!("speechSynthesis" in window)) return [];
  return window.speechSynthesis
    .getVoices()
    .filter((voice) => voice.localService)
    .sort(
      (left, right) =>
        Number(right.default) - Number(left.default) ||
        left.lang.localeCompare(right.lang) ||
        left.name.localeCompare(right.name),
    );
}

export function selectedSpeechVoice(
  voices: readonly SpeechSynthesisVoice[],
  voiceUri: string | null,
) {
  return (
    voices.find((voice) => voice.voiceURI === voiceUri) ??
    voices.find((voice) => voice.default) ??
    voices[0] ??
    null
  );
}
