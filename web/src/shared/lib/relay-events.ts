import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import type { NostrEvent } from "@/shared/lib/nostr-client";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";

export type RelayReceipt = {
  accepted: boolean;
  event_id?: string;
  message?: string;
};

export async function submitEvent(
  template: Parameters<typeof signNostrEvent>[0],
): Promise<{ event: NostrEvent; receipt: RelayReceipt }> {
  const event = await signNostrEvent(template, { requireNip07: true });
  const body = JSON.stringify(event);
  const url = `${relayHttpBaseUrl()}/events`;
  const authorization = await makeNip98AuthHeader(url, "POST", {
    body,
    requireNip07: true,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body,
  });
  const receipt = (await response.json().catch(() => null)) as
    | RelayReceipt
    | { error?: string }
    | null;
  if (!response.ok) {
    const error = receipt && "error" in receipt ? receipt.error : undefined;
    throw new Error(error ?? `Relay request failed (${response.status})`);
  }
  if (!receipt || !("accepted" in receipt) || !receipt.accepted) {
    const message = receipt && "message" in receipt ? receipt.message : null;
    throw new Error(message || "The relay did not accept the event.");
  }
  return { event, receipt };
}
