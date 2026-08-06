import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { nip19 } from "nostr-tools";
import { v2 as nip44 } from "nostr-tools/nip44";
import {
  finalizeEvent,
  getPublicKey,
  verifyEvent,
  type Event,
} from "nostr-tools/pure";

import { randomBytes } from "./encoding";

// Worker-only state: this module handles the owner secret while constructing
// the encrypted mobile payload and must never be imported by page code.

const PAIRING_KIND = 24_134;
const SESSION_TIMEOUT_MS = 120_000;
const HEX_32 = /^[0-9a-f]{64}$/u;
const encoder = new TextEncoder();

type PairingState =
  | "waiting"
  | "confirming"
  | "payload-exchanged"
  | "completed"
  | "aborted";

type PairingMessage = Record<string, unknown> & { type: string };

export type PairingEventResult =
  | { type: "ignored" }
  | { type: "sas"; sas: string }
  | { type: "complete" }
  | { type: "failed" }
  | { type: "aborted"; reason: string };

function bytesToHex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!HEX_32.test(value))
    throw new Error("The pairing public key is invalid.");
  return Uint8Array.from(
    value.match(/.{2}/gu)?.map((pair) => Number.parseInt(pair, 16)) ?? [],
  );
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function hkdf32(
  salt: Uint8Array,
  input: Uint8Array,
  info: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(input),
    "HKDF",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(salt),
        info: encoder.encode(info),
      },
      key,
      256,
    ),
  );
}

function strictPercentEncode(value: string): string {
  let encoded = "";
  for (const byte of encoder.encode(value)) {
    const isAlphaNumeric =
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a);
    encoded += isAlphaNumeric
      ? String.fromCharCode(byte)
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return encoded;
}

function validPairingRelayUrl(value: string): URL {
  if (value.length > 1_024) {
    throw new Error("The pairing relay URL is too long.");
  }
  const url = new URL(value);
  if (!["ws:", "wss:"].includes(url.protocol) || !url.host) {
    throw new Error("The pairing relay URL is invalid.");
  }
  return url;
}

function validRelayHttpUrl(value: string): URL {
  if (value.length > 2_048) throw new Error("The relay URL is too long.");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || !url.host) {
    throw new Error("The relay URL is invalid.");
  }
  return url;
}

function freshSecret(): Uint8Array<ArrayBuffer> {
  for (;;) {
    const candidate = randomBytes(32);
    try {
      schnorr.getPublicKey(candidate);
      return candidate;
    } catch {
      candidate.fill(0);
    }
  }
}

function freshSessionSecret(): Uint8Array<ArrayBuffer> {
  for (;;) {
    const candidate = randomBytes(32);
    if (candidate.some((byte) => byte !== 0)) return candidate;
    candidate.fill(0);
  }
}

function readableAbortReason(value: string): string {
  switch (value) {
    case "sas_mismatch":
      return "Security codes did not match";
    case "user_denied":
      return "Canceled on the mobile device";
    case "timeout":
      return "Session timed out";
    default:
      return "Protocol error";
  }
}

export class SourcePairingSession {
  readonly publicKey: string;
  readonly qrUri: string;

  private readonly createdAt = Date.now();
  private readonly processedIds = new Set<string>();
  private ephemeralSecret: Uint8Array<ArrayBuffer> | null;
  private sessionSecret: Uint8Array<ArrayBuffer> | null;
  private sessionId: Uint8Array<ArrayBuffer> | null;
  private peerPubkey: string | null = null;
  private sasInput: Uint8Array<ArrayBuffer> | null = null;
  private state: PairingState = "waiting";

  private constructor(
    ephemeralSecret: Uint8Array<ArrayBuffer>,
    sessionSecret: Uint8Array<ArrayBuffer>,
    sessionId: Uint8Array<ArrayBuffer>,
    pairingRelayUrl: string,
  ) {
    this.ephemeralSecret = ephemeralSecret;
    this.sessionSecret = sessionSecret;
    this.sessionId = sessionId;
    this.publicKey = getPublicKey(ephemeralSecret);
    this.qrUri = `nostrpair://${this.publicKey}?secret=${bytesToHex(sessionSecret)}&relay=${strictPercentEncode(pairingRelayUrl)}&v=1`;
  }

  static async create(pairingRelayUrl: string): Promise<SourcePairingSession> {
    const relay = validPairingRelayUrl(pairingRelayUrl).toString();
    const ephemeralSecret = freshSecret();
    const sessionSecret = freshSessionSecret();
    const sessionId = await hkdf32(
      new Uint8Array(),
      sessionSecret,
      "nostr-pair-session-id",
    );
    return new SourcePairingSession(
      ephemeralSecret,
      sessionSecret,
      sessionId,
      relay,
    );
  }

  signAuth(challenge: string, relayUrl: string): Event {
    if (!challenge || encoder.encode(challenge).length > 1_024) {
      throw new Error(
        "The pairing relay sent an invalid authentication challenge.",
      );
    }
    return finalizeEvent(
      {
        kind: 22_242,
        created_at: Math.floor(Date.now() / 1_000),
        tags: [
          ["relay", validPairingRelayUrl(relayUrl).toString()],
          ["challenge", challenge],
        ],
        content: "",
      },
      this.requireEphemeralSecret(),
    );
  }

  async handleEvent(event: Event): Promise<PairingEventResult> {
    if (this.isExpired()) throw new Error("Session timed out");
    if (!this.validEventBasics(event)) return { type: "ignored" };
    if (this.peerPubkey && event.pubkey !== this.peerPubkey) {
      return { type: "ignored" };
    }

    const message = await this.decryptMessage(event);
    if (!message) return { type: "ignored" };

    if (
      message.type === "abort" &&
      typeof message.reason === "string" &&
      this.peerPubkey &&
      this.state !== "completed" &&
      this.state !== "aborted"
    ) {
      this.processedIds.add(event.id);
      this.state = "aborted";
      return { type: "aborted", reason: readableAbortReason(message.reason) };
    }

    if (this.state === "waiting" && message.type === "offer") {
      const version = message.version ?? 1;
      if (
        version !== 1 ||
        typeof message.session_id !== "string" ||
        !HEX_32.test(message.session_id) ||
        !constantTimeEqual(
          hexToBytes(message.session_id),
          this.requireSessionId(),
        )
      ) {
        return { type: "ignored" };
      }

      this.peerPubkey = event.pubkey;
      const peerPoint = new Uint8Array(33);
      peerPoint[0] = 0x02;
      peerPoint.set(hexToBytes(event.pubkey), 1);
      const shared = secp256k1
        .getSharedSecret(this.requireEphemeralSecret(), peerPoint, true)
        .slice(1);
      try {
        this.sasInput = await hkdf32(
          this.requireSessionSecret(),
          shared,
          "nostr-pair-sas-v1",
        );
      } finally {
        shared.fill(0);
        peerPoint.fill(0);
      }
      const view = new DataView(
        this.sasInput.buffer,
        this.sasInput.byteOffset,
        this.sasInput.byteLength,
      );
      const sas = (view.getUint32(0, false) % 1_000_000)
        .toString()
        .padStart(6, "0");
      this.processedIds.add(event.id);
      this.state = "confirming";
      return { type: "sas", sas };
    }

    if (
      this.state === "payload-exchanged" &&
      message.type === "complete" &&
      typeof message.success === "boolean"
    ) {
      this.processedIds.add(event.id);
      if (!message.success) {
        this.state = "aborted";
        return { type: "failed" };
      }
      this.state = "completed";
      return { type: "complete" };
    }

    return { type: "ignored" };
  }

  async confirm(
    ownerSecret: Uint8Array<ArrayBuffer>,
    relayHttpUrl: string,
  ): Promise<[Event, Event]> {
    if (this.isExpired()) throw new Error("Session timed out");
    if (this.state !== "confirming" || !this.peerPubkey || !this.sasInput) {
      throw new Error("No pairing code is waiting for confirmation.");
    }

    const transcript = new Uint8Array(128);
    transcript.set(this.requireSessionId(), 0);
    transcript.set(hexToBytes(this.publicKey), 32);
    transcript.set(hexToBytes(this.peerPubkey), 64);
    transcript.set(this.sasInput, 96);
    let transcriptHash: Uint8Array<ArrayBuffer>;
    try {
      transcriptHash = await hkdf32(
        this.requireSessionSecret(),
        transcript,
        "nostr-pair-transcript-v1",
      );
    } finally {
      transcript.fill(0);
    }

    const sasConfirm = this.buildEvent({
      type: "sas-confirm",
      transcript_hash: bytesToHex(transcriptHash),
    });
    transcriptHash.fill(0);

    const relayUrl = validRelayHttpUrl(relayHttpUrl)
      .toString()
      .replace(/\/$/u, "");
    const payload = this.buildEvent({
      type: "payload",
      payload_type: "custom",
      payload: JSON.stringify({
        relayUrl,
        pubkey: getPublicKey(ownerSecret),
        nsec: nip19.nsecEncode(ownerSecret),
      }),
    });
    this.state = "payload-exchanged";
    return [sasConfirm, payload];
  }

  abort(reason = "user_denied"): Event | null {
    let event: Event | null = null;
    if (
      this.peerPubkey &&
      this.state !== "completed" &&
      this.state !== "aborted"
    ) {
      event = this.buildEvent({ type: "abort", reason });
    }
    this.state = "aborted";
    return event;
  }

  destroy(): void {
    this.ephemeralSecret?.fill(0);
    this.sessionSecret?.fill(0);
    this.sessionId?.fill(0);
    this.sasInput?.fill(0);
    this.ephemeralSecret = null;
    this.sessionSecret = null;
    this.sessionId = null;
    this.sasInput = null;
    this.peerPubkey = null;
    this.processedIds.clear();
    if (this.state !== "completed") this.state = "aborted";
  }

  private buildEvent(message: object): Event {
    const peer = this.peerPubkey;
    if (!peer) throw new Error("The mobile pairing peer is not connected.");
    const conversationKey = nip44.utils.getConversationKey(
      this.requireEphemeralSecret(),
      peer,
    );
    let content: string;
    try {
      content = nip44.encrypt(JSON.stringify(message), conversationKey);
    } finally {
      conversationKey.fill(0);
    }
    return finalizeEvent(
      {
        kind: PAIRING_KIND,
        created_at: Math.floor(Date.now() / 1_000) - (randomBytes(1)[0] % 31),
        tags: [["p", peer]],
        content,
      },
      this.requireEphemeralSecret(),
    );
  }

  private async decryptMessage(event: Event): Promise<PairingMessage | null> {
    if (event.content.length < 132 || event.content.length > 87_472)
      return null;
    const conversationKey = nip44.utils.getConversationKey(
      this.requireEphemeralSecret(),
      event.pubkey,
    );
    try {
      const plaintext = nip44.decrypt(event.content, conversationKey);
      if (encoder.encode(plaintext).length > 65_535) return null;
      const parsed = JSON.parse(plaintext) as unknown;
      if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
        return null;
      }
      return parsed as PairingMessage;
    } catch {
      return null;
    } finally {
      conversationKey.fill(0);
    }
  }

  private validEventBasics(event: Event): boolean {
    return (
      verifyEvent(event) &&
      !this.processedIds.has(event.id) &&
      event.kind === PAIRING_KIND &&
      event.tags.some((tag) => tag[0] === "p" && tag[1] === this.publicKey)
    );
  }

  private isExpired(): boolean {
    return Date.now() - this.createdAt > SESSION_TIMEOUT_MS;
  }

  private requireEphemeralSecret(): Uint8Array<ArrayBuffer> {
    if (!this.ephemeralSecret) throw new Error("The pairing session ended.");
    return this.ephemeralSecret;
  }

  private requireSessionSecret(): Uint8Array<ArrayBuffer> {
    if (!this.sessionSecret) throw new Error("The pairing session ended.");
    return this.sessionSecret;
  }

  private requireSessionId(): Uint8Array<ArrayBuffer> {
    if (!this.sessionId) throw new Error("The pairing session ended.");
    return this.sessionId;
  }
}
