import { listProfiles, uploadMedia } from "@/features/channels/channel-api";
import { submitEvent } from "@/shared/lib/relay-events";

export type ProfileInput = {
  displayName: string;
  about: string;
  avatarUrl: string;
};

export async function getOwnerProfile(pubkey: string): Promise<ProfileInput> {
  const profile = (await listProfiles([pubkey]))[0];
  return {
    displayName: profile?.displayName ?? "",
    about: profile?.about ?? "",
    avatarUrl: profile?.avatarUrl ?? "",
  };
}

export async function updateOwnerProfile(input: ProfileInput): Promise<void> {
  await submitEvent({
    kind: 0,
    tags: [],
    content: JSON.stringify({
      display_name: input.displayName.trim(),
      name: input.displayName.trim(),
      about: input.about.trim(),
      picture: input.avatarUrl.trim(),
    }),
  });
}

export async function uploadAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  return (await uploadMedia(file)).url;
}

export type WebNotificationSettings = {
  enabled: boolean;
  notifyWhileViewing: boolean;
  sound: boolean;
};

const NOTIFICATION_KEY = "buzz-web:notification-settings";

export function readNotificationSettings(): WebNotificationSettings {
  try {
    return {
      enabled: false,
      notifyWhileViewing: false,
      sound: true,
      ...(JSON.parse(
        localStorage.getItem(NOTIFICATION_KEY) ?? "{}",
      ) as Partial<WebNotificationSettings>),
    };
  } catch {
    return { enabled: false, notifyWhileViewing: false, sound: true };
  }
}

export function writeNotificationSettings(settings: WebNotificationSettings) {
  localStorage.setItem(NOTIFICATION_KEY, JSON.stringify(settings));
  window.dispatchEvent(
    new CustomEvent("buzz-web:notification-settings", { detail: settings }),
  );
}
