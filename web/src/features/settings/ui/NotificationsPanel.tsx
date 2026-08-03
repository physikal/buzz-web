import { ChevronDown, ChevronUp, Pause, Play } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import {
  COMING_SOON_SLOTS,
  playNotificationSound,
  readNotificationSettings,
  RECOMMENDED_SOUND_BY_SLOT,
  setAllSlotAlerts,
  SLOT_DESCRIPTIONS,
  SLOT_LABELS,
  SOUND_NAMES,
  SOUND_SLOTS,
  type SoundName,
  type SoundSlot,
  type WebNotificationSettings,
  writeNotificationSettings,
} from "../notification-settings";

const LIVE_SLOTS = SOUND_SLOTS.filter((slot) => !COMING_SOON_SLOTS.has(slot));

export function NotificationsPanel({ ownerPubkey }: { ownerPubkey: string }) {
  const [settings, setSettings] = useState(() =>
    readNotificationSettings(ownerPubkey),
  );
  const [showComingSoon, setShowComingSoon] = useState(false);
  const permission =
    "Notification" in window ? Notification.permission : "unsupported";
  const anyAlertsOn = LIVE_SLOTS.some(
    (slot) => settings.slotAlertsEnabled[slot],
  );
  const visibleSlots = SOUND_SLOTS.filter(
    (slot) => showComingSoon || !COMING_SOON_SLOTS.has(slot),
  );

  function save(next: WebNotificationSettings) {
    setSettings(next);
    writeNotificationSettings(ownerPubkey, next);
  }

  async function toggleDesktopEnabled(enabled: boolean) {
    if (enabled) {
      if (!("Notification" in window)) {
        toast.error("This browser does not support notifications.");
        return;
      }
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        toast.error("Browser notification permission was not granted.");
        return;
      }
    }
    save({ ...settings, desktopEnabled: enabled });
  }

  return (
    <section>
      <header className="mb-6">
        <h2 className="text-2xl font-semibold">Notifications</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Browser alerts are available for the same categories as Buzz desktop.
        </p>
      </header>
      <div className="space-y-4">
        <div className="divide-y rounded-md border">
          <ToggleRow
            checked={settings.desktopEnabled}
            description="Show native browser alerts for the categories enabled below."
            label="Browser alerts"
            onChange={(value) => void toggleDesktopEnabled(value)}
          />
          <ToggleRow
            checked={settings.desktopEnabled && settings.notifyWhileViewing}
            description="Also alert for direct messages in the conversation you have open."
            disabled={!settings.desktopEnabled}
            label="Notify while viewing"
            onChange={(value) =>
              save({ ...settings, notifyWhileViewing: value })
            }
          />
        </div>

        {settings.desktopEnabled ? (
          <>
            <div className="divide-y rounded-md border">
              <ToggleRow
                checked={anyAlertsOn}
                description="Alert with the selected sound for the events below."
                label="Sound"
                onChange={(value) => save(setAllSlotAlerts(settings, value))}
              />
            </div>
            {anyAlertsOn ? (
              <>
                <div className="divide-y rounded-md border">
                  {visibleSlots.map((slot) => (
                    <NotificationSlotRow
                      enabled={settings.slotAlertsEnabled[slot]}
                      key={slot}
                      onEnabledChange={(enabled) =>
                        save({
                          ...settings,
                          slotAlertsEnabled: {
                            ...settings.slotAlertsEnabled,
                            [slot]: enabled,
                          },
                          slotAlertsSnapshot: null,
                        })
                      }
                      onSoundChange={(sound) =>
                        save({
                          ...settings,
                          sounds: { ...settings.sounds, [slot]: sound },
                        })
                      }
                      slot={slot}
                      sound={settings.sounds[slot]}
                    />
                  ))}
                </div>
                <div className="flex justify-center">
                  <Button
                    onClick={() => setShowComingSoon((current) => !current)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {showComingSoon ? <ChevronUp /> : <ChevronDown />}
                    {showComingSoon ? "Show less" : "View all"}
                  </Button>
                </div>
              </>
            ) : null}
          </>
        ) : null}

        <div className="divide-y rounded-md border">
          <ToggleRow
            checked={settings.homeBadgeEnabled}
            description="Show an Inbox badge for mentions and needs-action items in the sidebar."
            label="Inbox badge"
            onChange={(value) => save({ ...settings, homeBadgeEnabled: value })}
          />
        </div>
      </div>
      {permission === "denied" || permission === "unsupported" ? (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {permission === "unsupported"
            ? "Browser notifications are not supported in this environment."
            : "Browser notifications are blocked. Enable them in your browser settings."}
        </p>
      ) : null}
    </section>
  );
}

function NotificationSlotRow({
  enabled,
  onEnabledChange,
  onSoundChange,
  slot,
  sound,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onSoundChange: (sound: SoundName) => void;
  slot: SoundSlot;
  sound: SoundName;
}) {
  const unavailable = COMING_SOON_SLOTS.has(slot);
  return (
    <div
      aria-disabled={unavailable || undefined}
      className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${unavailable ? "opacity-45" : ""}`}
    >
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {SLOT_LABELS[slot]}
          {unavailable ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
              Coming soon
            </span>
          ) : null}
        </p>
        <p className="text-sm text-muted-foreground">
          {SLOT_DESCRIPTIONS[slot]}
        </p>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2">
        <select
          aria-label={`${SLOT_LABELS[slot]} sound`}
          className="h-8 min-w-32 rounded-md border bg-background px-2 text-xs"
          disabled={unavailable || !enabled}
          onChange={(event) => onSoundChange(event.target.value as SoundName)}
          value={sound}
        >
          {[RECOMMENDED_SOUND_BY_SLOT[slot], ...SOUND_NAMES]
            .filter((name, index, values) => values.indexOf(name) === index)
            .map((name) => (
              <option key={name} value={name}>
                {name}
                {name === RECOMMENDED_SOUND_BY_SLOT[slot]
                  ? " (recommended)"
                  : ""}
              </option>
            ))}
        </select>
        <SoundPreviewButton disabled={unavailable || !enabled} sound={sound} />
        <input
          aria-label={`${SLOT_LABELS[slot]} alerts`}
          checked={enabled && !unavailable}
          disabled={unavailable}
          onChange={(event) => onEnabledChange(event.target.checked)}
          type="checkbox"
        />
      </div>
    </div>
  );
}

function SoundPreviewButton({
  disabled,
  sound,
}: {
  disabled: boolean;
  sound: SoundName;
}) {
  const [playing, setPlaying] = useState(false);
  const current = useRef<HTMLAudioElement | null>(null);
  function toggle() {
    if (playing) {
      current.current?.pause();
      setPlaying(false);
      return;
    }
    const audio = playNotificationSound(sound);
    if (!audio) return;
    current.current = audio;
    setPlaying(true);
    const stop = () => setPlaying(false);
    audio.addEventListener("ended", stop, { once: true });
    audio.addEventListener("pause", stop, { once: true });
  }
  return (
    <Button
      aria-label={playing ? `Pause ${sound}` : `Preview ${sound}`}
      disabled={disabled}
      onClick={toggle}
      size="icon"
      type="button"
      variant="ghost"
    >
      {playing ? <Pause /> : <Play />}
    </Button>
  );
}

function ToggleRow({
  checked,
  disabled,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 p-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}
