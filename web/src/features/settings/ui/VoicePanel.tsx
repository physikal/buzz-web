import { Play, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  localSpeechVoices,
  readTtsSettings,
  selectedSpeechVoice,
  writeTtsSettings,
} from "@/features/huddles/tts-settings";
import { Button } from "@/shared/ui/button";

export function VoicePanel({ ownerPubkey }: { ownerPubkey: string }) {
  const [settings, setSettings] = useState(() => readTtsSettings(ownerPubkey));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    localSpeechVoices(),
  );
  const supported = "speechSynthesis" in window;
  const selected = selectedSpeechVoice(voices, settings.voiceUri);

  useEffect(() => {
    if (!supported) return;
    const refresh = () => setVoices(localSpeechVoices());
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, [supported]);

  function save(next: typeof settings) {
    setSettings(next);
    writeTtsSettings(ownerPubkey, next);
  }

  function preview() {
    if (!selected) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      "Hello! This is how I'll read agent responses.",
    );
    utterance.voice = selected;
    utterance.addEventListener("error", () =>
      toast.error("Voice preview could not be played."),
    );
    window.speechSynthesis.speak(utterance);
  }

  return (
    <section data-testid="settings-voice">
      <header className="mb-6">
        <h2 className="text-2xl font-semibold">Voice</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose whether Buzz reads new agent responses aloud during an active
          huddle.
        </p>
      </header>
      <div className="divide-y rounded-md border">
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <label className="text-sm font-medium" htmlFor="tts-enabled">
              Agent text to speech
            </label>
            <p className="text-sm text-muted-foreground">
              Read new agent messages aloud in the order they arrive.
            </p>
          </div>
          <input
            aria-label="Agent text to speech"
            checked={settings.enabled && Boolean(selected)}
            disabled={!selected}
            id="tts-enabled"
            onChange={(event) =>
              save({ ...settings, enabled: event.target.checked })
            }
            type="checkbox"
          />
        </div>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">System voice</p>
            <p className="text-sm text-muted-foreground">
              Only voices marked as local by your browser are available.
            </p>
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <select
              aria-label="System voice"
              className="h-9 min-w-0 max-w-56 rounded-md border bg-background px-2 text-sm"
              disabled={!settings.enabled || !selected}
              onChange={(event) =>
                save({ ...settings, voiceUri: event.target.value })
              }
              value={selected?.voiceURI ?? ""}
            >
              {voices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
            <Button
              aria-label="Preview voice"
              disabled={!settings.enabled || !selected}
              onClick={preview}
              size="icon"
              type="button"
              variant="outline"
            >
              <Play />
            </Button>
          </div>
        </div>
      </div>
      {!selected ? (
        <p
          className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="status"
        >
          <Volume2 className="mr-2 inline h-4 w-4" />
          {supported
            ? "This browser did not provide an on-device speech voice."
            : "This browser does not support speech synthesis."}
        </p>
      ) : null}
    </section>
  );
}
