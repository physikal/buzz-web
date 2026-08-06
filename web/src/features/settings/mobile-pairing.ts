import {
  abortMobilePairing,
  confirmMobilePairing,
  createMobilePairingSession,
  handleMobilePairingEvent,
  signMobilePairingAuth,
} from "@/features/owner-vault/lib/vault-worker-client";
import { fetchRelayInfo } from "@/shared/lib/relay-info";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";
import type { SignedNostrEvent } from "@/shared/lib/nostr-signer";

const SUBSCRIPTION_ID = "pair";
const CONNECT_TIMEOUT_MS = 10_000;
const SESSION_TIMEOUT_MS = 130_000;

export type MobilePairingCallbacks = {
  onSas: (sas: string) => void;
  onComplete: () => void;
  onAborted: (reason: string) => void;
  onError: (error: Error) => void;
  onExpired: () => void;
};

function appendPairPath(value: string): string {
  const url = new URL(value);
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/pair`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function advertisedPairingRelay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["ws:", "wss:"].includes(url.protocol) && url.host
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

async function resolvePairingRelayUrl(): Promise<string> {
  const mainRelay = relayWsUrl();
  const info = await fetchRelayInfo();
  return (
    advertisedPairingRelay(info.pairing_relay_url) ?? appendPairPath(mainRelay)
  );
}

function signedEvent(value: unknown): value is SignedNostrEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<SignedNostrEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.pubkey === "string" &&
    typeof event.sig === "string" &&
    typeof event.kind === "number" &&
    typeof event.created_at === "number" &&
    typeof event.content === "string" &&
    Array.isArray(event.tags)
  );
}

export class MobilePairingController {
  private socket: WebSocket | null = null;
  private sessionTimer: number | null = null;
  private closed = false;
  private subscribed = false;
  private eventQueue = Promise.resolve();
  private readonly publishWaiters = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: number }
  >();

  constructor(private readonly callbacks: MobilePairingCallbacks) {}

  async start(): Promise<string> {
    const pairingRelayUrl = await resolvePairingRelayUrl();
    const pairing = await createMobilePairingSession(pairingRelayUrl);
    try {
      await this.connect(pairingRelayUrl, pairing.pubkey);
    } catch (cause) {
      await this.resetWorker();
      throw cause;
    }
    this.sessionTimer = window.setTimeout(() => {
      if (this.closed) return;
      this.callbacks.onExpired();
      void this.cancel("timeout");
    }, SESSION_TIMEOUT_MS);
    return pairing.qrUri;
  }

  async confirm(): Promise<void> {
    if (this.closed || !this.socket) {
      throw new Error("The pairing session ended.");
    }
    const [sasConfirm, payload] = await confirmMobilePairing(
      relayHttpBaseUrl(),
    );
    await this.publish(sasConfirm);
    await this.publish(payload);
  }

  async cancel(reason = "user_denied"): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.clearSessionTimer();
    try {
      const event = await abortMobilePairing(reason).catch(() => null);
      if (event && this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify(["EVENT", event]));
      }
    } finally {
      this.closeSocket();
    }
  }

  private async connect(relayUrl: string, pubkey: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let reqTimer: number | null = null;
      let authEventId: string | null = null;
      const timeout = window.setTimeout(() => {
        finish(new Error("Pairing took too long. Try again."));
      }, CONNECT_TIMEOUT_MS);
      const socket = new WebSocket(relayUrl);
      this.socket = socket;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (reqTimer !== null) window.clearTimeout(reqTimer);
        if (error) reject(error);
        else resolve();
      };

      const subscribe = () => {
        if (this.subscribed || socket.readyState !== WebSocket.OPEN) return;
        this.subscribed = true;
        socket.send(
          JSON.stringify([
            "REQ",
            SUBSCRIPTION_ID,
            { kinds: [24_134], "#p": [pubkey] },
          ]),
        );
      };

      socket.addEventListener("open", () => {
        reqTimer = window.setTimeout(subscribe, 100);
      });
      socket.addEventListener("message", (message) => {
        const raw = String(message.data);
        if (raw.length > 100_000) {
          const error = new Error(
            "The pairing relay sent an oversized message.",
          );
          if (settled) this.fail(error);
          else finish(error);
          return;
        }
        let frame: unknown;
        try {
          frame = JSON.parse(raw);
        } catch {
          return;
        }
        if (!Array.isArray(frame)) return;

        if (frame[0] === "AUTH" && typeof frame[1] === "string") {
          if (reqTimer !== null) window.clearTimeout(reqTimer);
          this.subscribed = false;
          void signMobilePairingAuth(frame[1], relayUrl)
            .then((event) => {
              if (socket.readyState === WebSocket.OPEN) {
                authEventId = event.id;
                socket.send(JSON.stringify(["AUTH", event]));
              }
            })
            .catch((cause) =>
              finish(
                cause instanceof Error
                  ? cause
                  : new Error("Pairing relay authentication failed."),
              ),
            );
          return;
        }

        if (frame[0] === "OK" && frame[1] === authEventId) {
          if (frame[2] === true) subscribe();
          else {
            finish(
              new Error(
                typeof frame[3] === "string" && frame[3]
                  ? frame[3]
                  : "Pairing relay authentication failed.",
              ),
            );
          }
          return;
        }

        if (frame[0] === "CLOSED" && frame[1] === SUBSCRIPTION_ID) {
          finish(
            new Error(
              typeof frame[2] === "string" && frame[2]
                ? frame[2]
                : "The pairing relay rejected the subscription.",
            ),
          );
          return;
        }

        if (frame[0] === "EOSE" && frame[1] === SUBSCRIPTION_ID && !settled) {
          finish();
          return;
        }
        this.handleFrame(frame);
      });
      socket.addEventListener("error", () => {
        finish(new Error("Could not connect to the pairing relay."));
      });
      socket.addEventListener("close", () => {
        if (!settled)
          finish(new Error("The pairing relay closed the connection."));
        else if (!this.closed) {
          this.fail(new Error("The pairing relay closed the connection."));
        }
      });
    });
  }

  private handleFrame(frame: unknown[]): void {
    if (frame[0] === "OK" && typeof frame[1] === "string") {
      const waiter = this.publishWaiters.get(frame[1]);
      if (!waiter) return;
      window.clearTimeout(waiter.timer);
      this.publishWaiters.delete(frame[1]);
      if (frame[2] === true) waiter.resolve();
      else {
        waiter.reject(
          new Error(
            typeof frame[3] === "string" && frame[3]
              ? frame[3]
              : "The pairing relay rejected a message.",
          ),
        );
      }
      return;
    }
    if (
      frame[0] !== "EVENT" ||
      frame[1] !== SUBSCRIPTION_ID ||
      !signedEvent(frame[2])
    ) {
      return;
    }

    const event = frame[2];
    this.eventQueue = this.eventQueue
      .then(async () => {
        if (this.closed) return;
        const result = await handleMobilePairingEvent(event);
        switch (result.type) {
          case "sas":
            this.callbacks.onSas(result.sas);
            break;
          case "complete":
            this.closed = true;
            this.clearSessionTimer();
            this.closeSocket();
            this.callbacks.onComplete();
            break;
          case "failed":
            this.fail(
              new Error("Mobile device reported failure importing credentials"),
            );
            break;
          case "aborted":
            this.closed = true;
            this.clearSessionTimer();
            this.closeSocket();
            this.callbacks.onAborted(result.reason);
            break;
          case "ignored":
            break;
        }
      })
      .catch((cause) => {
        this.fail(
          cause instanceof Error ? cause : new Error("Pairing failed."),
        );
      });
  }

  private publish(event: SignedNostrEvent): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("The pairing relay is disconnected."));
    }
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.publishWaiters.delete(event.id);
        reject(new Error("The pairing relay did not acknowledge the message."));
      }, CONNECT_TIMEOUT_MS);
      this.publishWaiters.set(event.id, { resolve, reject, timer });
      this.socket?.send(JSON.stringify(["EVENT", event]));
    });
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.clearSessionTimer();
    this.closeSocket(error);
    void this.resetWorker();
    this.callbacks.onError(error);
  }

  private closeSocket(error = new Error("The pairing session ended.")): void {
    for (const waiter of this.publishWaiters.values()) {
      window.clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.publishWaiters.clear();
    try {
      this.socket?.close();
    } catch {
      // Already closed.
    }
    this.socket = null;
  }

  private clearSessionTimer(): void {
    if (this.sessionTimer !== null) window.clearTimeout(this.sessionTimer);
    this.sessionTimer = null;
  }

  private async resetWorker(): Promise<void> {
    await abortMobilePairing().catch(() => undefined);
  }
}
