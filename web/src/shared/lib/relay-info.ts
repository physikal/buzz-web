import { relayHttpBaseUrl } from "./relay-url";

export type RelayInfo = {
  self?: unknown;
  supported_nips?: unknown;
  pairing_relay_url?: unknown;
};

export async function fetchRelayInfo(): Promise<RelayInfo> {
  const response = await fetch(
    `${relayHttpBaseUrl().replace(/\/+$/, "")}/info`,
    {
      headers: { Accept: "application/nostr+json" },
    },
  );
  if (!response.ok) {
    throw new Error(`Could not load relay information (${response.status}).`);
  }
  const info = (await response.json().catch(() => null)) as RelayInfo | null;
  if (!info || typeof info !== "object") {
    throw new Error("The relay returned invalid information.");
  }
  return info;
}

export async function fetchRelaySelf(): Promise<string> {
  const info = await fetchRelayInfo();
  if (typeof info?.self !== "string" || !/^[0-9a-f]{64}$/iu.test(info.self)) {
    throw new Error("The relay does not advertise a stable signing identity.");
  }
  return info.self.toLowerCase();
}
