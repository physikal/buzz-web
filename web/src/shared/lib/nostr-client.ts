/**
 * Minimal Nostr client with NIP-01 queries and NIP-42 AUTH.
 *
 * Uses NIP-07 when a browser extension is available, with an ephemeral
 * page-lifetime identity as the fallback for read-only queries on open relays.
 */

import { makeAuthEvent } from "nostr-tools/nip42";
import { verifyEvent } from "nostr-tools/pure";
import {
  type SignedNostrEvent,
  signNostrEvent,
} from "@/shared/lib/nostr-signer";

export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  search?: string;
  since?: number;
  until?: number;
  limit?: number;
  [tag: `#${string}`]: string[] | undefined;
}

export type NostrEvent = SignedNostrEvent;

const QUERY_TIMEOUT_MS = 10_000;

export function validNostrEvent(value: unknown): value is NostrEvent {
  try {
    return Boolean(
      value && typeof value === "object" && verifyEvent(value as NostrEvent),
    );
  } catch {
    return false;
  }
}

/**
 * Open a WebSocket to `wsUrl`, authenticate via NIP-42 if challenged,
 * send a REQ with the given filter, collect EVENTs until EOSE, then
 * close and return them.
 */
export function queryEvents(
  wsUrl: string,
  filter: NostrFilter | NostrFilter[],
  options?: { requireNip07?: boolean },
): Promise<NostrEvent[]> {
  return new Promise((resolve, reject) => {
    const events: NostrEvent[] = [];
    const subId = `q-${Date.now().toString(36)}`;
    let settled = false;
    let reqSent = false;
    let authEventId: string | null = null;
    let unauthenticatedReqTimer: ReturnType<typeof setTimeout> | null = null;

    const ws = new WebSocket(wsUrl);

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error(`Relay query timed out after ${QUERY_TIMEOUT_MS}ms`));
      }
    }, QUERY_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      if (unauthenticatedReqTimer) {
        clearTimeout(unauthenticatedReqTimer);
      }
      try {
        ws.close();
      } catch {
        // ignore
      }
    };

    const sendReq = () => {
      if (!reqSent) {
        reqSent = true;
        const filters = Array.isArray(filter) ? filter : [filter];
        ws.send(JSON.stringify(["REQ", subId, ...filters]));
      }
    };

    ws.addEventListener("open", () => {
      // Wait briefly for an AUTH challenge before sending REQ.
      // Buzz relays always send AUTH, but other relays may not.
      unauthenticatedReqTimer = setTimeout(() => sendReq(), 100);
    });

    ws.addEventListener("message", async (msg) => {
      let data: unknown;
      try {
        data = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      if (!Array.isArray(data)) return;

      const [type] = data;

      if (type === "AUTH" && typeof data[1] === "string") {
        // NIP-42: relay sent an AUTH challenge — sign and respond.
        if (unauthenticatedReqTimer) {
          clearTimeout(unauthenticatedReqTimer);
          unauthenticatedReqTimer = null;
        }
        const challenge = data[1];
        const template = makeAuthEvent(wsUrl, challenge);
        try {
          const signed = await signNostrEvent(template, {
            requireNip07: options?.requireNip07,
          });
          if (settled) return;
          authEventId = signed.id;
          ws.send(JSON.stringify(["AUTH", signed]));
        } catch (error) {
          if (!settled) {
            settled = true;
            cleanup();
            reject(
              error instanceof Error
                ? error
                : new Error("Failed to sign relay authentication."),
            );
          }
        }
        return;
      }

      if (type === "OK" && data[1] === authEventId) {
        if (data[2] === true) {
          sendReq();
        } else if (!settled) {
          settled = true;
          cleanup();
          reject(
            new Error(
              typeof data[3] === "string"
                ? data[3]
                : "Relay authentication failed.",
            ),
          );
        }
        return;
      }

      if (type === "EVENT" && data[1] === subId && data[2]) {
        if (validNostrEvent(data[2])) events.push(data[2]);
      } else if (type === "EOSE" && data[1] === subId) {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(events);
        }
      } else if (type === "CLOSED" && data[1] === subId) {
        // Subscription was rejected (e.g. auth failed).
        if (!settled) {
          settled = true;
          cleanup();
          const reason =
            typeof data[2] === "string"
              ? data[2]
              : "subscription closed by relay";
          reject(new Error(reason));
        }
      } else if (type === "NOTICE") {
        // Informational notice from relay — ignore for now.
      }
    });

    ws.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("WebSocket connection failed"));
      }
    });

    ws.addEventListener("close", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(events);
      }
    });
  });
}

export type LiveSubscription = {
  close: () => void;
};

/**
 * Keep an authenticated NIP-01 subscription alive and reconnect it when the
 * relay or network drops. Callers own cache reconciliation and deduplication.
 */
export function subscribeEvents(
  wsUrl: string,
  filter: NostrFilter | NostrFilter[],
  onEvent: (event: NostrEvent) => void,
  options?: {
    requireNip07?: boolean;
    onStatus?: (status: "connecting" | "live" | "offline") => void;
  },
): LiveSubscription {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let generation = 0;

  const connect = () => {
    if (stopped) return;
    const currentGeneration = ++generation;
    const subId = `live-${Date.now().toString(36)}-${currentGeneration}`;
    let reqSent = false;
    let authEventId: string | null = null;
    let authTimer: ReturnType<typeof setTimeout> | null = null;
    options?.onStatus?.("connecting");
    ws = new WebSocket(wsUrl);

    const sendReq = () => {
      if (reqSent || ws?.readyState !== WebSocket.OPEN) return;
      reqSent = true;
      const filters = Array.isArray(filter) ? filter : [filter];
      ws.send(JSON.stringify(["REQ", subId, ...filters]));
    };

    ws.addEventListener("open", () => {
      authTimer = setTimeout(sendReq, 100);
    });
    ws.addEventListener("message", async (message) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (!Array.isArray(frame) || stopped || currentGeneration !== generation)
        return;
      if (frame[0] === "AUTH" && typeof frame[1] === "string") {
        if (authTimer) clearTimeout(authTimer);
        try {
          const signed = await signNostrEvent(makeAuthEvent(wsUrl, frame[1]), {
            requireNip07: options?.requireNip07,
          });
          if (stopped || currentGeneration !== generation) return;
          authEventId = signed.id;
          ws?.send(JSON.stringify(["AUTH", signed]));
        } catch {
          ws?.close();
        }
        return;
      }
      if (frame[0] === "OK" && frame[1] === authEventId) {
        if (frame[2] === true) sendReq();
        else ws?.close();
        return;
      }
      if (frame[0] === "EVENT" && frame[1] === subId && frame[2]) {
        if (validNostrEvent(frame[2])) onEvent(frame[2]);
        return;
      }
      if (frame[0] === "EOSE" && frame[1] === subId) {
        reconnectAttempt = 0;
        options?.onStatus?.("live");
      }
      if (frame[0] === "CLOSED" && frame[1] === subId) ws?.close();
    });
    ws.addEventListener("close", () => {
      if (authTimer) clearTimeout(authTimer);
      if (stopped || currentGeneration !== generation) return;
      options?.onStatus?.("offline");
      const delay = Math.min(15_000, 500 * 2 ** reconnectAttempt++);
      reconnectTimer = setTimeout(connect, delay);
    });
    ws.addEventListener("error", () => ws?.close());
  };

  connect();
  return {
    close: () => {
      stopped = true;
      generation += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        // Already closed.
      }
    },
  };
}
