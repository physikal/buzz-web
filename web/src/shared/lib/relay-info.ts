import { relayHttpBaseUrl } from "./relay-url";

type RelayInfo = {
  self?: unknown;
};

export async function fetchRelaySelf(): Promise<string> {
  const response = await fetch(
    `${relayHttpBaseUrl().replace(/\/+$/, "")}/info`,
    {
      headers: { Accept: "application/nostr+json" },
    },
  );
  if (!response.ok) {
    throw new Error(`Could not load relay identity (${response.status}).`);
  }
  const info = (await response.json().catch(() => null)) as RelayInfo | null;
  if (typeof info?.self !== "string" || !/^[0-9a-f]{64}$/iu.test(info.self)) {
    throw new Error("The relay does not advertise a stable signing identity.");
  }
  return info.self.toLowerCase();
}
