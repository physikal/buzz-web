import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { relayWsUrl } from "@/shared/lib/relay-url";

const SAMPLE_RATE = 48_000;
const FRAME_SAMPLES = 960;
const PROTOCOL_VERSION = 2;

type RosterPeer = { pubkey: string; peer_index: number };
type ControlMessage = {
  type?: string;
  challenge?: string;
  message?: string;
  pubkey?: string;
  peer_index?: number;
  peers?: RosterPeer[];
};

export type HuddleAudioUpdate = {
  participants: string[];
  activeSpeakers: string[];
  micLevel: number;
};

function audioSocketUrl(channelId: string): string {
  return `${relayWsUrl().replace(/\/$/, "")}/huddle/${channelId}/audio`;
}

function levelDbov(samples: Float32Array): number {
  let squares = 0;
  for (const sample of samples) squares += sample * sample;
  if (!squares) return -127;
  return Math.max(
    -127,
    Math.min(
      0,
      Math.round(20 * Math.log10(Math.sqrt(squares / samples.length))),
    ),
  );
}

export function browserHuddleSupport(): string | null {
  if (!navigator.mediaDevices?.getUserMedia)
    return "This browser cannot access a microphone.";
  if (!("AudioEncoder" in window) || !("AudioDecoder" in window))
    return "Huddles require a browser with WebCodecs audio support.";
  return null;
}

export class BrowserHuddleAudio {
  private socket: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private encoder: AudioEncoder | null = null;
  private decoders = new Map<number, AudioDecoder>();
  private peerPubkeys = new Map<number, string>();
  private nextPlayAt = new Map<number, number>();
  private activeUntil = new Map<string, number>();
  private pendingSamples: number[] = [];
  private sequence = 0;
  private timestamp = 0;
  private frameNumber = 0;
  private muted = false;
  private stopped = false;
  private micLevel = 0;

  constructor(
    private readonly onUpdate: (update: HuddleAudioUpdate) => void,
    private readonly onFatal: (error: Error) => void,
  ) {}

  async connect(
    ephemeralChannelId: string,
    parentChannelId: string,
  ): Promise<void> {
    const unsupported = browserHuddleSupport();
    if (unsupported) throw new Error(unsupported);
    this.stopped = false;
    await this.startMedia();
    const socket = new WebSocket(audioSocketUrl(ephemeralChannelId));
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("Timed out connecting huddle audio.")),
        8_000,
      );
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        reject(error);
      };
      socket.addEventListener("message", async (message) => {
        if (message.data instanceof ArrayBuffer) {
          this.receiveAudio(message.data);
          return;
        }
        let control: ControlMessage;
        try {
          control = JSON.parse(String(message.data)) as ControlMessage;
        } catch {
          return;
        }
        if (control.type === "challenge" && control.challenge) {
          try {
            const event = await signNostrEvent(
              {
                kind: 22242,
                content: "",
                tags: [
                  ["relay", relayWsUrl()],
                  ["challenge", control.challenge],
                ],
              },
              { requireNip07: true },
            );
            socket.send(
              JSON.stringify({
                type: "auth",
                event,
                parent_channel_id: parentChannelId,
                protocol_version: PROTOCOL_VERSION,
              }),
            );
          } catch (error) {
            fail(
              error instanceof Error
                ? error
                : new Error("Could not authenticate huddle audio."),
            );
          }
          return;
        }
        if (control.type === "error") {
          fail(
            new Error(
              control.message || "The huddle relay rejected the connection.",
            ),
          );
          return;
        }
        this.applyControl(control);
        if (control.type === "joined" && !settled) {
          settled = true;
          window.clearTimeout(timeout);
          resolve();
        }
      });
      socket.addEventListener("error", () =>
        fail(new Error("Could not connect to huddle audio.")),
      );
      socket.addEventListener("close", () => {
        if (this.stopped) return;
        const error = new Error("The huddle audio connection closed.");
        if (!settled) fail(error);
        else this.fatal(error);
      });
    });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const track of this.stream?.getAudioTracks() ?? [])
      track.enabled = !muted;
    if (muted) {
      this.micLevel = 0;
      this.emitUpdate();
    }
  }

  stop(): void {
    this.stopped = true;
    this.processor?.disconnect();
    this.source?.disconnect();
    try {
      this.encoder?.close();
    } catch {
      // The codec may already have closed itself after a fatal error.
    }
    for (const decoder of this.decoders.values()) {
      try {
        decoder.close();
      } catch {
        // The decoder may already be closed.
      }
    }
    this.decoders.clear();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.socket?.close();
    this.socket = null;
    void this.context?.close();
    this.context = null;
  }

  private async startMedia(): Promise<void> {
    const encoderConfig: AudioEncoderConfig = {
      codec: "opus",
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 1,
      bitrate: 32_000,
    };
    const decoderConfig: AudioDecoderConfig = {
      codec: "opus",
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 1,
    };
    const [encoderSupport, decoderSupport] = await Promise.all([
      AudioEncoder.isConfigSupported(encoderConfig),
      AudioDecoder.isConfigSupported(decoderConfig),
    ]);
    if (!encoderSupport.supported || !decoderSupport.supported)
      throw new Error("This browser does not support the Opus huddle codec.");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: SAMPLE_RATE,
      },
    });
    this.context = new AudioContext({ sampleRate: SAMPLE_RATE });
    if (this.context.state === "suspended") {
      await Promise.race([
        this.context.resume(),
        new Promise<never>((_, reject) =>
          window.setTimeout(
            () =>
              reject(new Error("The browser blocked huddle audio playback.")),
            5_000,
          ),
        ),
      ]);
    }
    this.encoder = new AudioEncoder({
      output: (chunk) => this.sendEncoded(chunk),
      error: (error) =>
        this.fatal(new Error(`Huddle audio encoder failed: ${error.message}`)),
    });
    this.encoder.configure(encoderConfig);
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(2048, 1, 1);
    this.processor.onaudioprocess = (event) => {
      if (this.muted || this.stopped) return;
      this.pushSamples(event.inputBuffer.getChannelData(0));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  private pushSamples(input: Float32Array): void {
    this.pendingSamples.push(...input);
    while (this.pendingSamples.length >= FRAME_SAMPLES) {
      const samples = Float32Array.from(
        this.pendingSamples.splice(0, FRAME_SAMPLES),
      );
      const dbov = levelDbov(samples);
      this.micLevel = Math.max(0, Math.min(1, (dbov + 60) / 60));
      this.emitUpdate();
      const audio = new AudioData({
        format: "f32",
        sampleRate: SAMPLE_RATE,
        numberOfFrames: FRAME_SAMPLES,
        numberOfChannels: 1,
        timestamp: this.frameNumber * 20_000,
        data: samples,
      });
      this.frameNumber += 1;
      this.encoder?.encode(audio);
      audio.close();
    }
  }

  private sendEncoded(chunk: EncodedAudioChunk): void {
    if (this.socket?.readyState !== WebSocket.OPEN || this.stopped) return;
    const payload = new Uint8Array(chunk.byteLength);
    chunk.copyTo(payload);
    const frame = new Uint8Array(8 + payload.byteLength);
    const view = new DataView(frame.buffer);
    view.setUint16(0, this.sequence);
    view.setUint32(2, this.timestamp);
    view.setInt8(
      6,
      Math.max(-127, Math.min(0, Math.round((this.micLevel - 1) * 60))),
    );
    view.setUint8(7, payload.byteLength <= 2 ? 1 : 0);
    frame.set(payload, 8);
    this.socket.send(frame);
    this.sequence = (this.sequence + 1) & 0xffff;
    this.timestamp = (this.timestamp + FRAME_SAMPLES) >>> 0;
  }

  private receiveAudio(buffer: ArrayBuffer): void {
    if (buffer.byteLength <= 9 || !this.context) return;
    const bytes = new Uint8Array(buffer);
    const peerIndex = bytes[0];
    const header = new DataView(buffer, 1, 8);
    const level = header.getInt8(6);
    const flags = header.getUint8(7);
    const pubkey = this.peerPubkeys.get(peerIndex);
    if (pubkey && !(flags & 1) && level > -55) {
      this.activeUntil.set(pubkey, performance.now() + 600);
      this.emitUpdate();
    }
    const decoder = this.decoderFor(peerIndex);
    decoder.decode(
      new EncodedAudioChunk({
        type: "key",
        timestamp: Math.round((header.getUint32(2) * 1_000_000) / SAMPLE_RATE),
        data: bytes.slice(9),
      }),
    );
  }

  private decoderFor(peerIndex: number): AudioDecoder {
    const existing = this.decoders.get(peerIndex);
    if (existing) return existing;
    const decoder = new AudioDecoder({
      output: (audio) => this.play(peerIndex, audio),
      error: () => {
        this.decoders.delete(peerIndex);
      },
    });
    decoder.configure({
      codec: "opus",
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 1,
    });
    this.decoders.set(peerIndex, decoder);
    return decoder;
  }

  private play(peerIndex: number, audio: AudioData): void {
    const context = this.context;
    if (!context || this.stopped) {
      audio.close();
      return;
    }
    const samples = new Float32Array(audio.numberOfFrames);
    audio.copyTo(samples, { planeIndex: 0, format: "f32-planar" });
    const buffer = context.createBuffer(1, samples.length, audio.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(
      context.currentTime + 0.04,
      this.nextPlayAt.get(peerIndex) ?? 0,
    );
    source.start(startAt);
    this.nextPlayAt.set(peerIndex, startAt + buffer.duration);
    audio.close();
  }

  private applyControl(control: ControlMessage): void {
    if (control.type === "joined") {
      for (const peer of control.peers ?? [])
        this.peerPubkeys.set(peer.peer_index, peer.pubkey);
    }
    if (control.type === "roster") {
      this.peerPubkeys = new Map(
        (control.peers ?? []).map((peer) => [peer.peer_index, peer.pubkey]),
      );
    }
    if (control.type === "left" && typeof control.peer_index === "number") {
      this.peerPubkeys.delete(control.peer_index);
      this.decoders.get(control.peer_index)?.close();
      this.decoders.delete(control.peer_index);
    }
    this.emitUpdate();
  }

  private emitUpdate(): void {
    const now = performance.now();
    const activeSpeakers = [...this.activeUntil]
      .filter(([, until]) => until > now)
      .map(([pubkey]) => pubkey);
    this.onUpdate({
      participants: [...new Set(this.peerPubkeys.values())],
      activeSpeakers,
      micLevel: this.micLevel,
    });
  }

  private fatal(error: Error): void {
    if (this.stopped) return;
    this.stop();
    this.onFatal(error);
  }
}
