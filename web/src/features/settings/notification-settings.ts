export const SOUND_NAMES = [
  "bong",
  "boo",
  "dng",
  "doo",
  "doodone",
  "doong",
  "doop",
  "flirl",
  "flutter",
  "oh-no",
  "ping",
  "unison",
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

export const SOUND_SLOTS = [
  "dm",
  "mention",
  "thread_reply",
  "needs_action",
  "job_accepted",
  "job_progress",
  "job_result",
  "job_error",
] as const;

export type SoundSlot = (typeof SOUND_SLOTS)[number];

export const COMING_SOON_SLOTS: ReadonlySet<SoundSlot> = new Set([
  "job_accepted",
  "job_progress",
  "job_result",
  "job_error",
]);

export const SLOT_LABELS: Record<SoundSlot, string> = {
  dm: "Direct messages",
  mention: "@Mentions",
  thread_reply: "Thread replies",
  needs_action: "Needs action",
  job_accepted: "Agent: job accepted",
  job_progress: "Agent: progress update",
  job_result: "Agent: job result",
  job_error: "Agent: job error",
};

export const SLOT_DESCRIPTIONS: Record<SoundSlot, string> = {
  dm: "When someone messages you directly.",
  mention: "When someone tags you in a channel.",
  thread_reply: "When someone replies in a thread you follow or posted in.",
  needs_action: "When an approval or reminder is waiting on you.",
  job_accepted: "When an agent picks up a job.",
  job_progress: "While an agent works through a job.",
  job_result: "When an agent finishes a job.",
  job_error: "When an agent job fails.",
};

export const RECOMMENDED_SOUND_BY_SLOT: Record<SoundSlot, SoundName> = {
  dm: "unison",
  mention: "ping",
  thread_reply: "doop",
  needs_action: "doodone",
  job_accepted: "boo",
  job_progress: "dng",
  job_result: "unison",
  job_error: "oh-no",
};

const DEFAULT_SOUNDS: Record<SoundSlot, SoundName> = Object.fromEntries(
  SOUND_SLOTS.map((slot) => [slot, "flutter"]),
) as Record<SoundSlot, SoundName>;

const DEFAULT_SLOT_ALERTS: Record<SoundSlot, boolean> = {
  dm: true,
  mention: true,
  thread_reply: true,
  needs_action: true,
  job_accepted: true,
  job_progress: false,
  job_result: true,
  job_error: true,
};

export type WebNotificationSettings = {
  desktopEnabled: boolean;
  homeBadgeEnabled: boolean;
  notifyWhileViewing: boolean;
  sounds: Record<SoundSlot, SoundName>;
  slotAlertsEnabled: Record<SoundSlot, boolean>;
  slotAlertsSnapshot: Record<SoundSlot, boolean> | null;
};

const STORAGE_PREFIX = "buzz-notification-settings.v2";
const LEGACY_STORAGE_KEY = "buzz-web:notification-settings";
const SOUND_NAMES_SET = new Set<string>(SOUND_NAMES);

function defaults(): WebNotificationSettings {
  return {
    desktopEnabled: false,
    homeBadgeEnabled: true,
    notifyWhileViewing: false,
    sounds: { ...DEFAULT_SOUNDS },
    slotAlertsEnabled: { ...DEFAULT_SLOT_ALERTS },
    slotAlertsSnapshot: null,
  };
}

function sanitizedSounds(value: unknown) {
  const result = { ...DEFAULT_SOUNDS };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return result;
  for (const slot of SOUND_SLOTS) {
    const sound = (value as Record<string, unknown>)[slot];
    if (typeof sound === "string" && SOUND_NAMES_SET.has(sound))
      result[slot] = sound as SoundName;
  }
  return result;
}

function sanitizedSlots(value: unknown) {
  const result = { ...DEFAULT_SLOT_ALERTS };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return result;
  for (const slot of SOUND_SLOTS) {
    const enabled = (value as Record<string, unknown>)[slot];
    if (typeof enabled === "boolean") result[slot] = enabled;
  }
  return result;
}

function sanitizedSettings(value: unknown): WebNotificationSettings {
  const fallback = defaults();
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fallback;
  const candidate = value as Record<string, unknown>;
  return {
    desktopEnabled:
      typeof candidate.desktopEnabled === "boolean"
        ? candidate.desktopEnabled
        : fallback.desktopEnabled,
    homeBadgeEnabled:
      typeof candidate.homeBadgeEnabled === "boolean"
        ? candidate.homeBadgeEnabled
        : fallback.homeBadgeEnabled,
    notifyWhileViewing:
      typeof candidate.notifyWhileViewing === "boolean"
        ? candidate.notifyWhileViewing
        : fallback.notifyWhileViewing,
    sounds: sanitizedSounds(candidate.sounds),
    slotAlertsEnabled: sanitizedSlots(candidate.slotAlertsEnabled),
    slotAlertsSnapshot:
      candidate.slotAlertsSnapshot &&
      typeof candidate.slotAlertsSnapshot === "object" &&
      !Array.isArray(candidate.slotAlertsSnapshot)
        ? sanitizedSlots(candidate.slotAlertsSnapshot)
        : null,
  };
}

function storageKey(ownerPubkey: string) {
  return `${STORAGE_PREFIX}:${ownerPubkey}`;
}

function migrateLegacy(): WebNotificationSettings | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const legacy = JSON.parse(raw) as Record<string, unknown>;
    const migrated = defaults();
    if (typeof legacy.enabled === "boolean")
      migrated.desktopEnabled = legacy.enabled;
    if (typeof legacy.notifyWhileViewing === "boolean")
      migrated.notifyWhileViewing = legacy.notifyWhileViewing;
    if (legacy.sound === false) {
      for (const slot of SOUND_SLOTS) migrated.slotAlertsEnabled[slot] = false;
    }
    if (legacy.reminderAlerts === false)
      migrated.slotAlertsEnabled.needs_action = false;
    return migrated;
  } catch {
    return null;
  }
}

export function readNotificationSettings(
  ownerPubkey: string,
): WebNotificationSettings {
  try {
    const raw = localStorage.getItem(storageKey(ownerPubkey));
    return raw
      ? sanitizedSettings(JSON.parse(raw))
      : (migrateLegacy() ?? defaults());
  } catch {
    return defaults();
  }
}

export function writeNotificationSettings(
  ownerPubkey: string,
  settings: WebNotificationSettings,
) {
  const safe = sanitizedSettings(settings);
  localStorage.setItem(storageKey(ownerPubkey), JSON.stringify(safe));
  window.dispatchEvent(
    new CustomEvent("buzz-web:notification-settings", { detail: safe }),
  );
}

const audioCache = new Map<SoundName, HTMLAudioElement>();

export function playNotificationSound(name: SoundName) {
  try {
    let audio = audioCache.get(name);
    if (!audio) {
      audio = new Audio(`/sounds/${name}.mp3`);
      audioCache.set(name, audio);
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {});
    return audio;
  } catch {
    return null;
  }
}

export function setAllSlotAlerts(
  settings: WebNotificationSettings,
  enabled: boolean,
) {
  const next = { ...settings.slotAlertsEnabled };
  if (!enabled) {
    for (const slot of SOUND_SLOTS) {
      if (!COMING_SOON_SLOTS.has(slot)) next[slot] = false;
    }
    return {
      ...settings,
      slotAlertsEnabled: next,
      slotAlertsSnapshot: { ...settings.slotAlertsEnabled },
    };
  }
  const snapshot = settings.slotAlertsSnapshot;
  const snapshotHasAlerts =
    snapshot !== null &&
    SOUND_SLOTS.some((slot) => !COMING_SOON_SLOTS.has(slot) && snapshot[slot]);
  for (const slot of SOUND_SLOTS) {
    if (!COMING_SOON_SLOTS.has(slot))
      next[slot] = snapshotHasAlerts ? (snapshot?.[slot] ?? true) : true;
  }
  return {
    ...settings,
    slotAlertsEnabled: next,
    slotAlertsSnapshot: null,
  };
}
