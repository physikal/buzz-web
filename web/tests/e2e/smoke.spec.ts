import { createHash, createHmac } from "node:crypto";
import {
  expect,
  test,
  type Download as PlaywrightDownload,
} from "@playwright/test";
import { v2 as nip44 } from "nostr-tools/nip44";
import {
  decrypt as decryptNip49,
  encrypt as encryptNip49,
} from "nostr-tools/nip49";
import { finalizeEvent, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { mergeOwnerProfileMetadata } from "../../src/features/profile/profile-metadata";
import { buildCustomEmojiTags } from "../../src/features/channels/custom-emoji-tags";
import { resolveMessageMentions } from "../../src/features/channels/message-mentions";
import {
  channelSuggestions,
  findChannelQuery,
} from "../../src/features/channels/channel-links";
import {
  extractSupportedLinkPreviews,
  parseSupportedLinkPreview,
} from "../../src/features/channels/link-preview";

const testPort = process.env.BUZZ_WEB_TEST_PORT ?? "4173";
const testOrigin = `http://localhost:${testPort}`;

async function downloadedBytes(download: PlaywrightDownload): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test("home page loads with Buzz branding", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("main").getByRole("img", { name: "Buzz" }),
  ).toBeVisible();
});

test("repositories page remains available from its desktop route", async ({
  page,
}) => {
  await page.goto("/repos");
  await expect(page.getByText("Repositories")).toBeVisible();
});

test("profile edits preserve interoperable kind-0 metadata", () => {
  expect(
    mergeOwnerProfileMetadata(
      JSON.stringify({
        name: "stable-alias",
        nip05: "owner@example.com",
        website: "https://example.com",
        lud16: "owner@example.com",
      }),
      {
        displayName: "Updated owner",
        about: "Updated from Buzz Web",
        avatarUrl: "https://example.com/avatar.png",
      },
    ),
  ).toEqual({
    name: "stable-alias",
    display_name: "Updated owner",
    about: "Updated from Buzz Web",
    picture: "https://example.com/avatar.png",
    nip05: "owner@example.com",
    website: "https://example.com",
    lud16: "owner@example.com",
  });
});

test("custom emoji tags are canonical, unique, and self-contained", () => {
  expect(
    buildCustomEmojiTags(":SHIPIT: :unknown: :shipit: :party-parrot:", [
      { shortcode: "party-parrot", url: "https://example.com/party.gif" },
      { shortcode: "shipit", url: "https://example.com/shipit.png" },
    ]),
  ).toEqual([
    ["emoji", "shipit", "https://example.com/shipit.png"],
    ["emoji", "party-parrot", "https://example.com/party.gif"],
  ]);
});

test("message mentions resolve only tagged profile aliases", () => {
  const pubkey = "ab".repeat(32);
  const resolved = resolveMessageMentions(
    { tags: [["p", pubkey]] },
    new Map([
      [
        pubkey,
        {
          pubkey,
          displayName: "Relay agent",
          name: "relay-alias",
          avatarUrl: null,
          about: null,
          nip05Handle: "relay-agent@example.com",
        },
      ],
    ]),
    new Map([[pubkey, "Relay agent"]]),
  );
  expect(resolved.names).toEqual(["Relay agent", "relay-alias", "relay-agent"]);
  expect(resolved.pubkeysByName.get("relay-alias")).toBe(pubkey);
  expect(resolved.pubkeysByName.has("unknown")).toBe(false);
  expect(resolved.agentPubkeysByName.get("relay agent")).toBe(pubkey);
});

test("channel links autocomplete only non-DM channels at prefix boundaries", () => {
  const channels = [
    { id: "general", name: "general", channelType: "stream" as const },
    {
      id: "release",
      name: "release planning",
      channelType: "forum" as const,
    },
    { id: "dm", name: "private", channelType: "dm" as const },
  ];
  expect(findChannelQuery("See (#rel", 9, channels)).toEqual({
    query: "rel",
    start: 5,
  });
  expect(findChannelQuery("See email#rel", 13, channels)).toBeNull();
  expect(channelSuggestions(channels, "rel")).toEqual([channels[1]]);
  expect(channelSuggestions(channels, "private")).toEqual([]);
});

test("link previews use the desktop allowlist and ignore hidden content", () => {
  expect(
    parseSupportedLinkPreview("javascript:github.com/block/buzz"),
  ).toBeNull();
  expect(
    [
      "https://github.com/block/buzz",
      "https://github.com/block/buzz/issues/4",
      "https://linear.app/buzz/issue/WEB-7/card",
      "https://drive.google.com/file/d/file-id/view",
      "https://drive.google.com/drive/folders/folder-id",
      "https://docs.google.com/document/d/doc-id/edit",
      "https://docs.google.com/spreadsheets/d/sheet-id/edit",
      "https://docs.google.com/presentation/d/slides-id/edit",
    ].map((href) => parseSupportedLinkPreview(href)?.kind),
  ).toEqual([
    "github-repository",
    "github-issue",
    "linear-issue",
    "google-drive-file",
    "google-drive-folder",
    "google-docs-document",
    "google-sheets-spreadsheet",
    "google-slides-presentation",
  ]);
  const previews = extractSupportedLinkPreviews(
    [
      "`https://github.com/block/hidden/pull/1`",
      "```",
      "https://github.com/block/hidden/pull/2",
      "```",
      "    https://github.com/block/hidden/pull/3",
      "||https://linear.app/acme/issue/SEC-9/hidden||",
      "||",
      "https://github.com/block/hidden/pull/4",
      "||",
      "![sheet](https://docs.google.com/spreadsheets/d/hidden/edit)",
      "[Launch plan](https://docs.google.com/document/d/document-id/edit)",
      "https://github.com/block/buzz/pull/42",
      "https://github.com/block/buzz/pull/42",
      "https://gitlab.com/block/buzz",
    ].join("\n"),
  );
  expect(previews).toEqual([
    {
      kind: "google-docs-document",
      href: "https://docs.google.com/document/d/document-id/edit",
      provider: "Google Docs",
      title: "Launch plan",
      typeLabel: "document",
    },
    {
      kind: "github-pull-request",
      href: "https://github.com/block/buzz/pull/42",
      provider: "GitHub",
      title: "block/buzz #42",
      typeLabel: "PR",
    },
  ]);
  expect(
    extractSupportedLinkPreviews(
      Array.from(
        { length: 10 },
        (_, index) => `https://github.com/block/buzz/pull/${index + 1}`,
      ).join(" "),
    ),
  ).toHaveLength(8);
});

test("owner setup creates a passkey-wrapped signer and enters Channels", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: testOrigin,
  });
  await page.addInitScript(() => {
    class TestNotification {
      static permission: NotificationPermission = "granted";
      static requestPermission = async () => "granted" as const;
      onclick: (() => void) | null = null;
      constructor(title: string, options?: NotificationOptions) {
        const testWindow = window as typeof window & {
          __buzzTestLastNotification?: TestNotification;
          __buzzTestNotifications?: Array<{
            body?: string;
            tag?: string;
            title: string;
          }>;
        };
        testWindow.__buzzTestLastNotification = this;
        testWindow.__buzzTestNotifications ??= [];
        testWindow.__buzzTestNotifications.push({
          body: options?.body,
          tag: options?.tag,
          title,
        });
      }
      close() {}
    }
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: TestNotification,
    });
    const voices = [
      {
        default: true,
        lang: "en-US",
        localService: true,
        name: "Test local voice",
        voiceURI: "test-local",
      },
      {
        default: false,
        lang: "en-US",
        localService: false,
        name: "Test remote voice",
        voiceURI: "test-remote",
      },
    ] as SpeechSynthesisVoice[];
    class TestSpeechSynthesisUtterance {
      voice: SpeechSynthesisVoice | null = null;
      constructor(readonly text: string) {}
      addEventListener() {}
    }
    const spoken: string[] = [];
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: TestSpeechSynthesisUtterance,
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        addEventListener() {},
        cancel() {},
        getVoices: () => voices,
        removeEventListener() {},
        speak: (utterance: TestSpeechSynthesisUtterance) =>
          spoken.push(utterance.text),
      },
    });
    Object.defineProperty(window, "__buzzTestSpoken", {
      configurable: true,
      value: spoken,
    });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
        hasPrf: true,
      },
    },
  );

  const token = "42".repeat(32);
  const agentSecret = new Uint8Array(32);
  agentSecret[31] = 3;
  const agentPubkey = getPublicKey(agentSecret);
  const catalogSecret = new Uint8Array(32);
  catalogSecret[31] = 1;
  const catalogPubkey = getPublicKey(catalogSecret);
  const projectPullRequestCreatedAt = Math.floor(Date.now() / 1000) - 120;
  const welcomeMessageEvent = finalizeEvent(
    {
      kind: 9,
      created_at: Math.floor(Date.now() / 1000) - 60,
      content: "Welcome to Buzz Web.",
      tags: [["h", "44444444-4444-4444-8444-444444444444"]],
    },
    catalogSecret,
  );
  let catalogImageRequests = 0;
  let externalGitRequests = 0;
  let ownerPubkey = "";
  const managedAgents: Array<Record<string, unknown>> = [];
  const createdAgentInputs: Array<Record<string, unknown>> = [];
  const restoredMemory: Array<{ slug: string; body: string }> = [];
  const uploadedMedia = new Map<
    string,
    { bytes: Buffer; contentType: string }
  >();
  const submittedEvents: Array<{
    id: string;
    pubkey: string;
    sig: string;
    kind: number;
    created_at: number;
    content: string;
    tags: string[][];
  }> = [];
  let sendLiveChannelEvent:
    | ((event: (typeof submittedEvents)[number]) => void)
    | null = null;
  let capturedSearchFilter: Record<string, unknown> | null = null;
  let addedCredentialCount = 0;
  let claimedCredential: {
    credential_id: string;
    prf_input: string;
    kdf_salt: string;
    nonce: string;
    ciphertext: string;
  } | null = null;
  let addedCredential: typeof claimedCredential = null;
  await page.route("https://tracker.invalid/**", async (route) => {
    catalogImageRequests += 1;
    await route.abort();
  });
  await page.route(
    "https://example.com/relay-project.git/**",
    async (route) => {
      externalGitRequests += 1;
      await route.abort();
    },
  );
  await page.route("**/info", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/nostr+json",
      body: JSON.stringify({ self: catalogPubkey }),
    });
  });
  await page.route("**/api/owner/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        claimed: claimedCredential !== null,
        vault_ready: claimedCredential !== null,
        owner_pubkey: ownerPubkey || null,
        claim_enabled: true,
      }),
    });
  });
  await page.route("**/api/owner/claim", async (route) => {
    const request = route.request();
    const body = request.postData() ?? "";
    const payload = JSON.parse(body) as {
      token: string;
      credential: {
        credential_id: string;
        prf_input: string;
        kdf_salt: string;
        nonce: string;
        ciphertext: string;
      };
      recovery: { ciphertext: string };
    };
    expect(payload.token).toBe(token);
    expect(
      Buffer.from(payload.credential.ciphertext, "base64url"),
    ).toHaveLength(48);
    expect(Buffer.from(payload.recovery.ciphertext, "base64url")).toHaveLength(
      48,
    );
    expect(
      Buffer.from(payload.credential.credential_id, "base64url").length,
    ).toBeGreaterThanOrEqual(16);

    const authorization = request.headers().authorization ?? "";
    expect(authorization).toMatch(/^Nostr /);
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event.tags).toContainEqual([
      "payload",
      createHash("sha256").update(body).digest("hex"),
    ]);
    ownerPubkey = event.pubkey;
    claimedCredential = payload.credential;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ owner_pubkey: ownerPubkey }),
    });
  });
  await page.route("**/api/owner/vault/unlock", async (route) => {
    expect(claimedCredential).not.toBeNull();
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      credential_id?: string;
    };
    const credential = [claimedCredential, addedCredential].find(
      (candidate) => candidate?.credential_id === body.credential_id,
    );
    expect(credential).toBeTruthy();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        owner_pubkey: ownerPubkey,
        prf_input: credential?.prf_input,
        kdf_salt: credential?.kdf_salt,
        nonce: credential?.nonce,
        ciphertext: credential?.ciphertext,
      }),
    });
  });
  await page.route("**/api/owner/credentials", async (route) => {
    const request = route.request();
    const body = request.postData() ?? "";
    const payload = JSON.parse(body) as {
      credential: {
        credential_id: string;
        label: string;
        prf_input: string;
        kdf_salt: string;
        nonce: string;
        ciphertext: string;
      };
    };
    expect(payload.credential.label).toBe("Bitwarden passkey");
    expect(
      Buffer.from(payload.credential.credential_id, "base64url").length,
    ).toBeGreaterThanOrEqual(16);
    expect(Buffer.from(payload.credential.prf_input, "base64url")).toHaveLength(
      32,
    );
    expect(Buffer.from(payload.credential.kdf_salt, "base64url")).toHaveLength(
      32,
    );
    expect(Buffer.from(payload.credential.nonce, "base64url")).toHaveLength(12);
    expect(
      Buffer.from(payload.credential.ciphertext, "base64url"),
    ).toHaveLength(48);
    const authorization = request.headers().authorization ?? "";
    expect(authorization).toMatch(/^Nostr /);
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64url").toString(
        "utf8",
      ),
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(ownerPubkey);
    expect(event.kind).toBe(27235);
    expect(event.tags).toContainEqual([
      "payload",
      createHash("sha256").update(body).digest("hex"),
    ]);
    addedCredential = payload.credential;
    addedCredentialCount += 1;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ registered: true }),
    });
  });
  await page.route("**/upload", async (route) => {
    const request = route.request();
    const bytes = request.postDataBuffer() ?? Buffer.alloc(0);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const authorization = request.headers().authorization ?? "";
    expect(authorization).toMatch(/^Nostr /);
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64url").toString(
        "utf8",
      ),
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(ownerPubkey);
    expect(event.kind).toBe(24242);
    expect(event.tags).toContainEqual(["x", sha256]);
    const contentType =
      request.headers()["content-type"] ?? "application/octet-stream";
    const isAnnotatedImage =
      contentType === "image/png" &&
      [...uploadedMedia.values()].some(
        (media) => media.contentType === "image/png",
      );
    uploadedMedia.set(sha256, { bytes, contentType });
    if (isAnnotatedImage)
      await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: `${testOrigin}/media/${sha256}`,
        sha256,
        size: bytes.length,
        type: contentType,
      }),
    });
  });
  await page.route("**/media/*", async (route) => {
    const hash = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const media = uploadedMedia.get(hash);
    if (!media) {
      await route.fulfill({ status: 404, body: "Not found" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: media.contentType,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Length": String(media.bytes.length),
      },
      body: media.bytes,
    });
  });
  await page.route("**/query", async (route) => {
    const request = route.request();
    const body = request.postData() ?? "";
    const authorization = request.headers().authorization ?? "";
    expect(authorization).toMatch(/^Nostr /);
    const authEvent = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    );
    expect(verifyEvent(authEvent)).toBe(true);
    expect(authEvent.pubkey).toBe(ownerPubkey);
    expect(authEvent.tags).toContainEqual([
      "payload",
      createHash("sha256").update(body).digest("hex"),
    ]);
    const filters = JSON.parse(body) as Array<{
      kinds?: number[];
      search?: string;
      [key: string]: unknown;
    }>;
    const kinds = filters.flatMap((filter) => filter.kinds ?? []);
    const events = [];
    const searchFilter = filters.find(
      (filter) => typeof filter.search === "string",
    );
    if (searchFilter) {
      capturedSearchFilter = searchFilter;
      events.push(
        finalizeEvent(
          {
            kind: 9,
            created_at: Math.floor(Date.parse("2026-01-15T12:00:00Z") / 1_000),
            content: "Welcome search result",
            tags: [["h", "44444444-4444-4444-8444-444444444444"]],
          },
          catalogSecret,
        ),
      );
    }
    if (
      filters.some(
        (filter) => filter.kinds?.includes(9) && Array.isArray(filter["#p"]),
      )
    )
      events.push(
        finalizeEvent(
          {
            kind: 9,
            created_at: Math.floor(Date.now() / 1000),
            content: "Owner mention from inbox",
            tags: [
              ["h", "44444444-4444-4444-8444-444444444444"],
              ["p", ownerPubkey],
              ["e", "12".repeat(32), "", "root"],
            ],
          },
          catalogSecret,
        ),
      );
    if (
      filters.some(
        (filter) => filter.kinds?.includes(1621) && Array.isArray(filter["#p"]),
      )
    )
      events.push(
        finalizeEvent(
          {
            kind: 1621,
            created_at: Math.floor(Date.now() / 1000) - 1,
            content: "Review the signed project issue",
            tags: [
              ["a", `30617:${catalogPubkey}:buzz-web`],
              ["p", ownerPubkey],
              ["subject", "Project inbox parity"],
            ],
          },
          catalogSecret,
        ),
      );
    if (kinds.includes(20001))
      events.push(
        finalizeEvent(
          {
            kind: 20001,
            created_at: Math.floor(Date.now() / 1000),
            content: "online",
            tags: [["p", catalogPubkey]],
          },
          agentSecret,
        ),
      );
    if (kinds.includes(30315))
      events.push(
        finalizeEvent(
          {
            kind: 30315,
            created_at: Math.floor(Date.now() / 1000),
            content: "Reviewing builds",
            tags: [
              ["d", "general"],
              ["emoji", "🔎"],
            ],
          },
          catalogSecret,
        ),
      );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(events),
    });
  });
  await page.route("**/api/agents/runtimes", async (route) => {
    const request = route.request();
    const authorization = request.headers().authorization ?? "";
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(ownerPubkey);
    expect(event.tags).toContainEqual(["method", "GET"]);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runtimes: [
          {
            id: "buzz-agent",
            label: "Buzz Agent",
            source: "built-in",
            supports_model: true,
            model_required: true,
            supports_subscription: false,
            supports_arguments: true,
            secret_fields: [],
          },
          {
            id: "codex",
            label: "Codex",
            source: "built-in",
            supports_model: true,
            model_required: false,
            supports_subscription: true,
            supports_arguments: true,
            secret_fields: [],
          },
          {
            id: "claude",
            label: "Claude Code",
            source: "built-in",
            supports_model: true,
            model_required: false,
            supports_subscription: true,
            supports_arguments: true,
            secret_fields: [],
          },
          {
            id: "gemini",
            label: "Gemini ACP",
            source: "operator",
            supports_model: true,
            model_required: true,
            supports_subscription: false,
            supports_arguments: false,
            secret_fields: [
              {
                env: "GEMINI_API_KEY",
                label: "Gemini API key",
                required: true,
              },
            ],
          },
        ],
      }),
    });
  });
  await page.route("**/api/agents", async (route) => {
    const request = route.request();
    const authorization = request.headers().authorization ?? "";
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(ownerPubkey);
    if (request.method() === "POST") {
      const input = JSON.parse(request.postData() ?? "{}") as Record<
        string,
        unknown
      >;
      createdAgentInputs.push(input);
      expect(event.tags).toContainEqual([
        "payload",
        createHash("sha256")
          .update(request.postData() ?? "")
          .digest("hex"),
      ]);
      const agent = {
        id: [
          "55555555-5555-4555-8555-555555555555",
          "66666666-6666-4666-8666-666666666666",
          "77777777-7777-4777-8777-777777777777",
          "88888888-8888-4888-8888-888888888888",
          "99999999-9999-4999-8999-999999999999",
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        ][managedAgents.length],
        owner_pubkey: ownerPubkey,
        agent_pubkey: agentPubkey,
        persona_id: input.persona_id ?? null,
        name: input.name,
        system_prompt: input.system_prompt,
        runtime: input.runtime,
        model: input.model,
        provider: input.provider ?? null,
        agent_args: input.agent_args ?? [],
        parallelism: input.parallelism ?? 1,
        idle_timeout_seconds: input.idle_timeout_seconds ?? null,
        max_turn_duration_seconds: input.max_turn_duration_seconds ?? null,
        runtime_config: input.runtime_config ?? {},
        credential_mode: input.credential_mode,
        respond_to: input.respond_to,
        respond_to_allowlist: input.respond_to_allowlist,
        desired_state:
          input.start_immediately === false ? "stopped" : "running",
        observed_state:
          input.start_immediately === false ? "stopped" : "pending",
        last_error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      managedAgents.push(agent);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ agent }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ agents: managedAgents }),
    });
  });
  await page.route(/\/api\/agents\/[0-9a-f-]+$/u, async (route) => {
    const request = route.request();
    const authorization = request.headers().authorization ?? "";
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(ownerPubkey);
    expect(request.method()).toBe("DELETE");
    const id = new URL(request.url()).pathname.split("/").at(-1);
    const index = managedAgents.findIndex((agent) => agent.id === id);
    const agent = managedAgents[index];
    if (
      agent?.desired_state !== "stopped" ||
      !["stopped", "error"].includes(agent?.observed_state ?? "")
    ) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "agent must be fully stopped before deletion",
        }),
      });
      return;
    }
    managedAgents.splice(index, 1);
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/agents/*/memory", async (route) => {
    const request = route.request();
    const body = request.postData() ?? "";
    const authorization = request.headers().authorization ?? "";
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(ownerPubkey);
    expect(event.tags).toContainEqual([
      "payload",
      createHash("sha256").update(body).digest("hex"),
    ]);
    restoredMemory.push(JSON.parse(body) as { slug: string; body: string });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ event_id: "ab".repeat(32) }),
    });
  });
  await page.route("**/api/agents/*/start", async (route) => {
    const request = route.request();
    const authorization = request.headers().authorization ?? "";
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(ownerPubkey);
    const id = new URL(request.url()).pathname.split("/").at(-2);
    const agent = managedAgents.find((candidate) => candidate.id === id);
    expect(agent).toBeTruthy();
    if (agent) {
      agent.desired_state = "running";
      agent.observed_state = "pending";
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ agent }),
    });
  });
  await page.route("**/api/agents/*/stop", async (route) => {
    const request = route.request();
    const authorization = request.headers().authorization ?? "";
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(ownerPubkey);
    const id = new URL(request.url()).pathname.split("/").at(-2);
    const agent = managedAgents.find((candidate) => candidate.id === id);
    expect(agent).toBeTruthy();
    if (agent) {
      agent.desired_state = "stopped";
      agent.observed_state = "stopped";
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ agent }),
    });
  });
  await page.route("**/api/agents/*/logs", async (route) => {
    const request = route.request();
    const authorization = request.headers().authorization ?? "";
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(ownerPubkey);
    expect(event.tags).toContainEqual(["u", request.url()]);
    expect(event.tags).toContainEqual(["method", "GET"]);
    expect(event.tags.some((tag: string[]) => tag[0] === "payload")).toBe(
      false,
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        output: "[stdout] ACP session ready\n[stderr] [REDACTED]",
        truncated: true,
      }),
    });
  });
  await page.route("**/api/agents/*/activity", async (route) => {
    const request = route.request();
    const authorization = request.headers().authorization ?? "";
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(ownerPubkey);
    expect(event.tags).toContainEqual(["u", request.url()]);
    expect(event.tags).toContainEqual(["method", "GET"]);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({ events: [] }),
    });
  });
  await page.route("**/api/invites", async (route) => {
    const request = route.request();
    const body = request.postData() ?? "";
    expect(JSON.parse(body)).toEqual({ ttl_secs: 259200 });
    const authorization = request.headers().authorization ?? "";
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(ownerPubkey);
    expect(event.tags).toContainEqual([
      "payload",
      createHash("sha256").update(body).digest("hex"),
    ]);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        code: "owner-invite",
        expires_at: Math.floor(Date.now() / 1000) + 259200,
        url: `${testOrigin}/invite/owner-invite`,
        max_uses: null,
        uses_remaining: null,
      }),
    });
  });
  await page.route(
    "**/moderation/reports?status=open&limit=200",
    async (route) => {
      const authorization = route.request().headers().authorization ?? "";
      const event = JSON.parse(
        Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
          "utf8",
        ),
      );
      expect(verifyEvent(event)).toBe(true);
      expect(event.pubkey).toBe(ownerPubkey);
      expect(event.tags).toContainEqual(["u", route.request().url()]);
      expect(
        event.tags.some(
          (tag: string[]) => tag[0] === "nonce" && tag[1]?.length > 20,
        ),
      ).toBe(true);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "report-row-1",
            report_event_id: "77".repeat(32),
            reporter_pubkey: "88".repeat(32),
            target_kind: "event",
            target: "99".repeat(32),
            channel_id: "44444444-4444-4444-8444-444444444444",
            report_type: "spam",
            note: "Repeated unsolicited promotion",
            status: "open",
            created_at: new Date().toISOString(),
          },
        ]),
      });
    },
  );
  await page.route("**/moderation/audit?limit=200", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });
  await page.route("**/events", async (route) => {
    const request = route.request();
    const body = request.postData() ?? "";
    const event = JSON.parse(body) as (typeof submittedEvents)[number];
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(ownerPubkey);
    const authorization = request.headers().authorization ?? "";
    expect(authorization).toMatch(/^Nostr /);
    const authEvent = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    );
    expect(verifyEvent(authEvent)).toBe(true);
    expect(authEvent.pubkey).toBe(ownerPubkey);
    expect(authEvent.tags).toContainEqual(["u", request.url()]);
    expect(authEvent.tags).toContainEqual(["method", "POST"]);
    expect(authEvent.tags).toContainEqual([
      "payload",
      createHash("sha256").update(body).digest("hex"),
    ]);
    expect(
      authEvent.tags.some(
        (tag: string[]) => tag[0] === "nonce" && tag[1]?.length > 20,
      ),
    ).toBe(true);
    submittedEvents.push(event);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accepted: true,
        message:
          event.kind === 30620
            ? `response:${JSON.stringify({
                workflow_id: event.tags.find((tag) => tag[0] === "d")?.[1],
                webhook_secret: "webhook-test-secret",
              })}`
            : undefined,
      }),
    });
  });
  await page.routeWebSocket(
    new RegExp(`ws:\\/\\/(?:127\\.0\\.0\\.1|localhost):${testPort}\\/?$`),
    (socket) => {
      socket.send(JSON.stringify(["AUTH", "web-smoke-challenge"]));
      socket.onMessage((message) => {
        const frame = JSON.parse(String(message)) as unknown[];
        if (frame[0] === "AUTH" && frame[1]) {
          const event = frame[1] as (typeof submittedEvents)[number];
          expect(verifyEvent(event)).toBe(true);
          expect(event.pubkey).toBe(ownerPubkey);
          expect(event.tags).toContainEqual([
            "challenge",
            "web-smoke-challenge",
          ]);
          socket.send(JSON.stringify(["OK", event.id, true, ""]));
          return;
        }
        if (frame[0] === "EVENT" && frame[1]) {
          const event = frame[1] as (typeof submittedEvents)[number];
          expect(verifyEvent(event)).toBe(true);
          expect(event.pubkey).toBe(ownerPubkey);
          submittedEvents.push(event);
          socket.send(JSON.stringify(["OK", event.id, true, ""]));
          return;
        }
        if (frame[0] === "REQ" && typeof frame[1] === "string") {
          const subscriptionId = frame[1];
          const requestFilters = frame.slice(2) as Array<{
            kinds?: number[];
            authors?: string[];
            "#h"?: string[];
            limit?: number;
            since?: number;
          }>;
          const filters = JSON.stringify(requestFilters);
          if (
            requestFilters.some(
              (filter) =>
                typeof filter.since === "number" &&
                filter.limit === undefined &&
                filter.kinds?.length === 6 &&
                filter.kinds.includes(9),
            )
          ) {
            sendLiveChannelEvent = (event) =>
              socket.send(JSON.stringify(["EVENT", subscriptionId, event]));
          }
          const signer = catalogSecret;
          const createdAt = Math.floor(Date.now() / 1000) - 60;
          if (filters.includes("39000")) {
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 39000,
                    created_at: createdAt,
                    content: "",
                    tags: [
                      ["d", "44444444-4444-4444-8444-444444444444"],
                      ["name", "general"],
                      ["about", "General conversation and community updates."],
                      ["t", "stream"],
                    ],
                  },
                  signer,
                ),
              ]),
            );
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 39000,
                    created_at: createdAt,
                    content: "",
                    tags: [
                      ["d", "55555555-5555-4555-8555-555555555555"],
                      ["name", "web-forum"],
                      ["about", "Focused design discussions."],
                      ["t", "forum"],
                    ],
                  },
                  signer,
                ),
              ]),
            );
          }
          if (filters.includes("39002")) {
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 39002,
                    created_at: createdAt,
                    content: "",
                    tags: [
                      ["d", "44444444-4444-4444-8444-444444444444"],
                      ["p", ownerPubkey, "", "owner"],
                    ],
                  },
                  signer,
                ),
              ]),
            );
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 39002,
                    created_at: createdAt,
                    content: "",
                    tags: [
                      ["d", "55555555-5555-4555-8555-555555555555"],
                      ["p", ownerPubkey, "", "owner"],
                    ],
                  },
                  signer,
                ),
              ]),
            );
          }
          if (filters.includes("40008")) {
            socket.send(
              JSON.stringify(["EVENT", subscriptionId, welcomeMessageEvent]),
            );
            const channelIds = new Set(
              requestFilters.flatMap((filter) => filter["#h"] ?? []),
            );
            for (const event of submittedEvents.filter(
              (event) =>
                [9, 45001, 45003].includes(event.kind) &&
                event.tags.some(
                  (tag) => tag[0] === "h" && channelIds.has(tag[1]),
                ),
            ))
              socket.send(JSON.stringify(["EVENT", subscriptionId, event]));
          }
          if (filters.includes("40003")) {
            const channelIds = new Set(
              requestFilters.flatMap((filter) => filter["#h"] ?? []),
            );
            const targetIds = new Set(
              requestFilters.flatMap((filter) => filter["#e"] ?? []),
            );
            for (const event of submittedEvents.filter(
              (candidate) =>
                [5, 7, 9005, 40003].includes(candidate.kind) &&
                candidate.tags.some(
                  (tag) =>
                    (tag[0] === "h" && channelIds.has(tag[1])) ||
                    (tag[0] === "e" && targetIds.has(tag[1])),
                ),
            ))
              socket.send(JSON.stringify(["EVENT", subscriptionId, event]));
          }
          if (filters.includes("13534")) {
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 13534,
                    created_at: createdAt,
                    content: "",
                    tags: [
                      ["member", ownerPubkey, "owner"],
                      ["member", agentPubkey, "member"],
                    ],
                  },
                  signer,
                ),
              ]),
            );
          }
          if (filters.includes("30030")) {
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 30030,
                    created_at: createdAt,
                    content: "",
                    tags: [
                      ["d", "buzz:custom-emoji"],
                      ["emoji", "shipit", "https://example.com/shipit.png"],
                    ],
                  },
                  signer,
                ),
              ]),
            );
          }
          if (filters.includes("20002")) {
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 20002,
                    created_at: Math.floor(Date.now() / 1000),
                    content: "",
                    tags: [["h", "44444444-4444-4444-8444-444444444444"]],
                  },
                  signer,
                ),
              ]),
            );
          }
          if (filters.includes("30617")) {
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 30617,
                    created_at: createdAt,
                    content: "A relay-native project",
                    tags: [
                      ["d", "relay-project"],
                      ["name", "Relay project"],
                      ["description", "A relay-native project"],
                      ["web", "https://example.com/relay-project"],
                      ["h", "44444444-4444-4444-8444-444444444444"],
                    ],
                  },
                  signer,
                ),
              ]),
            );
            for (const project of submittedEvents.filter(
              (event) => event.kind === 30617,
            ))
              socket.send(JSON.stringify(["EVENT", subscriptionId, project]));
          }
          if (filters.includes("30618")) {
            const createdPullRequestExists = submittedEvents.some(
              (event) =>
                event.kind === 1618 &&
                event.tags.some(
                  (tag) =>
                    tag[0] === "subject" && tag[1] === "Create PR from web",
                ),
            );
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 30618,
                    created_at: createdAt,
                    content: "",
                    tags: [
                      ["d", "relay-project"],
                      ["refs/heads/main", "aa".repeat(20)],
                      [
                        "refs/heads/feature/create-pr",
                        (createdPullRequestExists ? "bd" : "bc").repeat(20),
                      ],
                      ["refs/heads/feature/web-parity", "ab".repeat(20)],
                      ["refs/heads/../escape", "de".repeat(20)],
                      ["refs/tags/v0.1.0", "aa".repeat(20)],
                      ["HEAD", "ref: refs/heads/main"],
                      ["p", catalogPubkey],
                    ],
                  },
                  signer,
                ),
              ]),
            );
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 30618,
                    created_at: createdAt + 30,
                    content: "",
                    tags: [
                      ["d", "relay-project"],
                      ["refs/heads/attacker-branch", "cd".repeat(20)],
                      ["HEAD", "ref: refs/heads/attacker-branch"],
                    ],
                  },
                  agentSecret,
                ),
              ]),
            );
          }
          if (filters.includes("30620")) {
            for (const workflow of submittedEvents.filter(
              (event) => event.kind === 30620,
            ))
              socket.send(JSON.stringify(["EVENT", subscriptionId, workflow]));
          }
          if (filters.includes("1621")) {
            for (const event of submittedEvents.filter((candidate) =>
              [1621, 1630, 1631, 1632, 1633].includes(candidate.kind),
            ))
              socket.send(JSON.stringify(["EVENT", subscriptionId, event]));
          }
          if (filters.includes("1618")) {
            const pullRequest = finalizeEvent(
              {
                kind: 1618,
                created_at: projectPullRequestCreatedAt,
                content: "Bring the browser project view to parity.",
                tags: [
                  ["a", `30617:${catalogPubkey}:relay-project`],
                  ["p", catalogPubkey],
                  ["p", ownerPubkey],
                  ["subject", "Browser parity pull request"],
                  ["c", "ab".repeat(20)],
                  ["clone", "https://example.com/relay-project.git"],
                  ["branch-name", "feature/web-parity"],
                  ["target-branch", "main"],
                  ["h", "44444444-4444-4444-8444-444444444444"],
                ],
              },
              signer,
            );
            socket.send(JSON.stringify(["EVENT", subscriptionId, pullRequest]));
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 1618,
                    created_at: projectPullRequestCreatedAt + 1,
                    content: "This item belongs to another repository.",
                    tags: [
                      ["a", `30617:${catalogPubkey}:other-project`],
                      ["subject", "Cross-project injection"],
                      ["c", "ef".repeat(20)],
                    ],
                  },
                  signer,
                ),
              ]),
            );
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 1,
                    created_at: projectPullRequestCreatedAt + 20,
                    content: "Forged approval claim",
                    tags: [
                      ["e", pullRequest.id, "", "root"],
                      ["a", `30617:${catalogPubkey}:relay-project`],
                      ["t", "approval"],
                      ["c", "ab".repeat(20)],
                    ],
                  },
                  agentSecret,
                ),
              ]),
            );
            for (const inlineComment of [
              finalizeEvent(
                {
                  kind: 1,
                  created_at: projectPullRequestCreatedAt + 21,
                  content: "Use the shared browser helper here.",
                  tags: [
                    ["e", pullRequest.id, "", "root"],
                    ["a", `30617:${catalogPubkey}:relay-project`],
                    ["t", "inline-comment"],
                    ["c", "ab".repeat(20)],
                    ["file", "src/browser.ts"],
                    ["side", "new"],
                    ["line", "12"],
                  ],
                },
                signer,
              ),
              finalizeEvent(
                {
                  kind: 1,
                  created_at: projectPullRequestCreatedAt + 22,
                  content: "Malicious inline location",
                  tags: [
                    ["e", pullRequest.id, "", "root"],
                    ["a", `30617:${catalogPubkey}:relay-project`],
                    ["t", "inline-comment"],
                    ["c", "ab".repeat(20)],
                    ["file", "../secrets.txt"],
                    ["side", "new"],
                    ["line", "1"],
                  ],
                },
                agentSecret,
              ),
            ])
              socket.send(
                JSON.stringify(["EVENT", subscriptionId, inlineComment]),
              );
            for (const unauthorizedEvent of [
              finalizeEvent(
                {
                  kind: 1619,
                  created_at: createdAt + 30,
                  content: "",
                  tags: [
                    ["a", `30617:${catalogPubkey}:relay-project`],
                    ["E", pullRequest.id],
                    ["c", "cd".repeat(20)],
                    ["clone", "https://attacker.invalid/repo.git"],
                  ],
                },
                agentSecret,
              ),
              finalizeEvent(
                {
                  kind: 1632,
                  created_at: createdAt + 30,
                  content: "",
                  tags: [
                    ["a", `30617:${catalogPubkey}:relay-project`],
                    ["e", pullRequest.id, "", "root"],
                  ],
                },
                agentSecret,
              ),
            ])
              socket.send(
                JSON.stringify(["EVENT", subscriptionId, unauthorizedEvent]),
              );
            for (const event of submittedEvents.filter((candidate) =>
              [1618, 1619, 1630, 1631, 1632, 1633].includes(candidate.kind),
            ))
              socket.send(JSON.stringify(["EVENT", subscriptionId, event]));
          }
          if (filters.includes('"kinds":[1]')) {
            const pulseNote = finalizeEvent(
              {
                kind: 1,
                created_at: createdAt,
                content: "Relay-native Pulse update",
                tags: [],
              },
              signer,
            );
            socket.send(JSON.stringify(["EVENT", subscriptionId, pulseNote]));
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                {
                  ...pulseNote,
                  id: "71".repeat(32),
                  content: "Forged relay frame",
                },
              ]),
            );
            for (const event of submittedEvents.filter(
              (candidate) => candidate.kind === 1,
            ))
              socket.send(JSON.stringify(["EVENT", subscriptionId, event]));
          }
          if (filters.includes("10100")) {
            const relayAgentProfile = finalizeEvent(
              {
                kind: 10100,
                created_at: createdAt,
                content: JSON.stringify({ name: "Relay agent" }),
                tags: [],
              },
              signer,
            );
            socket.send(
              JSON.stringify(["EVENT", subscriptionId, relayAgentProfile]),
            );
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                {
                  ...relayAgentProfile,
                  id: "72".repeat(32),
                  content: JSON.stringify({ name: "Forged relay agent" }),
                },
              ]),
            );
          }
          if (filters.includes("30300")) {
            for (const reminder of submittedEvents.filter(
              (event) => event.kind === 30300,
            ))
              socket.send(JSON.stringify(["EVENT", subscriptionId, reminder]));
          }
          if (filters.includes("30175")) {
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 30175,
                    created_at: createdAt,
                    content: JSON.stringify({
                      display_name: "Community reviewer",
                      system_prompt:
                        "Audit changes from the community catalog.\n\n[Documentation](https://tracker.invalid/docs)\n\n![Tracking pixel](https://tracker.invalid/pixel.png)",
                      runtime: "codex",
                      model: "gpt-5.4",
                      respond_to: "allowlist",
                      respond_to_allowlist: ["ff".repeat(32)],
                    }),
                    tags: [
                      ["d", "community-reviewer"],
                      ["shared", "true"],
                    ],
                  },
                  signer,
                ),
              ]),
            );
            for (const persona of submittedEvents.filter(
              (event) => event.kind === 30175,
            ))
              socket.send(JSON.stringify(["EVENT", subscriptionId, persona]));
          }
          if (filters.includes("30176")) {
            for (const team of submittedEvents.filter(
              (event) => event.kind === 30176,
            ))
              socket.send(JSON.stringify(["EVENT", subscriptionId, team]));
          }
          if (filters.includes("30078")) {
            for (const template of submittedEvents.filter(
              (event) => event.kind === 30078,
            ))
              socket.send(JSON.stringify(["EVENT", subscriptionId, template]));
          }
          if (filters.includes("40100")) {
            for (const canvas of submittedEvents.filter(
              (event) => event.kind === 40100,
            ))
              socket.send(JSON.stringify(["EVENT", subscriptionId, canvas]));
          }
          if (filters.includes("30315")) {
            for (const status of submittedEvents.filter(
              (event) => event.kind === 30315,
            ))
              socket.send(JSON.stringify(["EVENT", subscriptionId, status]));
          }
          if (filters.includes("30174") && ownerPubkey) {
            const conversationKey = nip44.utils.getConversationKey(
              agentSecret,
              ownerPubkey,
            );
            const slug = "core";
            const address = createHmac("sha256", conversationKey)
              .update(`agent-memory/v1/d-tag\0${slug}`)
              .digest("hex");
            const content = nip44.encrypt(
              JSON.stringify({
                slug,
                profile: "Review carefully and preserve user intent.",
              }),
              conversationKey,
            );
            conversationKey.fill(0);
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 30174,
                    created_at: createdAt,
                    content,
                    tags: [
                      ["d", address],
                      ["p", ownerPubkey],
                    ],
                  },
                  agentSecret,
                ),
              ]),
            );
          }
          if (filters.includes("24200") && ownerPubkey) {
            const conversationKey = nip44.utils.getConversationKey(
              agentSecret,
              ownerPubkey,
            );
            const observerFrames = [
              {
                seq: 1,
                timestamp: new Date().toISOString(),
                kind: "acp_write",
                agentIndex: 0,
                channelId: "44444444-4444-4444-8444-444444444444",
                sessionId: "session-1",
                turnId: "turn-1",
                payload: {
                  jsonrpc: "2.0",
                  method: "tools/call",
                  params: { name: "shell" },
                },
              },
              {
                seq: 2,
                timestamp: new Date().toISOString(),
                kind: "acp_read",
                agentIndex: 0,
                channelId: "44444444-4444-4444-8444-444444444444",
                sessionId: "session-1",
                turnId: "turn-1",
                payload: {
                  jsonrpc: "2.0",
                  method: "session/update",
                  params: {
                    update: {
                      sessionUpdate: "agent_message_chunk",
                      messageId: "assistant-message-1",
                      content: { type: "text", text: "Review in progress." },
                    },
                  },
                },
              },
              {
                seq: 3,
                timestamp: new Date().toISOString(),
                kind: "acp_read",
                agentIndex: 0,
                channelId: "44444444-4444-4444-8444-444444444444",
                sessionId: "session-1",
                turnId: "turn-1",
                payload: {
                  jsonrpc: "2.0",
                  method: "session/update",
                  params: {
                    update: {
                      sessionUpdate: "plan",
                      entries: [
                        {
                          status: "in_progress",
                          content: "Inspect repository",
                        },
                      ],
                    },
                  },
                },
              },
              {
                seq: 4,
                timestamp: new Date().toISOString(),
                kind: "acp_read",
                agentIndex: 0,
                channelId: "44444444-4444-4444-8444-444444444444",
                sessionId: "session-1",
                turnId: "turn-1",
                payload: {
                  jsonrpc: "2.0",
                  method: "session/update",
                  params: {
                    update: {
                      sessionUpdate: "tool_call",
                      toolCallId: "tool-1",
                      title: "shell",
                      status: "executing",
                      args: { command: "pwd" },
                    },
                  },
                },
              },
              {
                seq: 5,
                timestamp: new Date().toISOString(),
                kind: "acp_read",
                agentIndex: 0,
                channelId: "44444444-4444-4444-8444-444444444444",
                sessionId: "session-1",
                turnId: "turn-1",
                payload: {
                  jsonrpc: "2.0",
                  method: "session/update",
                  params: {
                    update: {
                      sessionUpdate: "tool_call_update",
                      toolCallId: "tool-1",
                      title: "shell",
                      status: "completed",
                      args: { command: "pwd" },
                      result: {
                        content: [{ type: "text", text: "/workspace" }],
                      },
                    },
                  },
                },
              },
            ];
            for (const observerFrame of observerFrames) {
              const content = nip44.encrypt(
                JSON.stringify(observerFrame),
                conversationKey,
              );
              socket.send(
                JSON.stringify([
                  "EVENT",
                  subscriptionId,
                  finalizeEvent(
                    {
                      kind: 24200,
                      created_at: Math.floor(Date.now() / 1000),
                      content,
                      tags: [
                        ["p", ownerPubkey],
                        ["agent", agentPubkey],
                        ["frame", "telemetry"],
                      ],
                    },
                    agentSecret,
                  ),
                ]),
              );
            }
            conversationKey.fill(0);
          }
          if (filters.includes('"kinds":[0]')) {
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 0,
                    created_at: createdAt,
                    content: JSON.stringify({
                      display_name: "Relay agent",
                      about: "Posts build updates",
                      nip05: "relay-agent@example.com",
                    }),
                    tags: [],
                  },
                  signer,
                ),
              ]),
            );
            for (const event of submittedEvents.filter(
              (candidate) => candidate.kind === 0,
            )) {
              socket.send(JSON.stringify(["EVENT", subscriptionId, event]));
            }
          }
          if (filters.includes('"kinds":[3]')) {
            const latestContactList = submittedEvents
              .filter(
                (event) =>
                  event.kind === 3 &&
                  event.pubkey.toLowerCase() === ownerPubkey,
              )
              .at(-1);
            if (latestContactList)
              socket.send(
                JSON.stringify(["EVENT", subscriptionId, latestContactList]),
              );
          }
          socket.send(JSON.stringify(["EOSE", subscriptionId]));
        }
      });
    },
  );

  await page.goto(`${testOrigin}/agents/setup#${token}`);
  await expect(page).toHaveURL(/\/agents\/setup$/);
  await page.getByRole("button", { name: "Create owner passkey" }).click();
  await expect(
    page.getByRole("heading", { name: "Owner passkey created" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Vault unlock code", { exact: true }),
  ).toHaveValue(/^buzz-recovery-v1_/);
  await page
    .getByLabel("I saved this vault unlock code somewhere secure.")
    .check();
  await page.getByRole("button", { name: "Open Buzz" }).click();
  await expect(page).toHaveURL(/\/channels$/);
  await page.getByRole("button", { name: /^general(?: \d+)?$/u }).click();
  await expect(page.getByRole("complementary", { name: "Thread" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("heading", { name: "general" })).toBeVisible();
  await expect(page.getByText("Welcome to Buzz Web.")).toBeVisible();
  await expect(page.getByText("Forged relay agent")).toHaveCount(0);
  await expect(page.getByLabel("Message #general")).toBeVisible();
  const unownedAgentArticle = page.locator(
    `article[id="message-${welcomeMessageEvent.id}"]`,
  );
  await unownedAgentArticle.hover();
  await expect(
    unownedAgentArticle.getByRole("button", { name: "Edit message" }),
  ).toHaveCount(0);
  await expect(
    unownedAgentArticle.getByRole("button", { name: "Report message" }),
  ).toBeVisible();
  const emojiComposer = page.getByLabel("Message #general");
  await page.getByRole("button", { name: "Insert emoji" }).click();
  await page.getByRole("button", { name: "Insert :shipit:" }).click();
  await emojiComposer.press("Enter");
  await expect
    .poll(() =>
      submittedEvents.find(
        (event) => event.kind === 9 && event.content === ":shipit:",
      ),
    )
    .toMatchObject({
      tags: expect.arrayContaining([
        ["emoji", "shipit", "https://example.com/shipit.png"],
      ]),
    });
  const emojiMessage = submittedEvents.find(
    (event) => event.kind === 9 && event.content === ":shipit:",
  );
  const emojiArticle = page.locator(
    `article[id="message-${emojiMessage?.id}"]`,
  );
  await expect(emojiArticle).toBeVisible();
  await emojiArticle.hover();
  await emojiArticle.getByRole("button", { name: "Edit message" }).click();
  const emojiEditComposer = page.getByRole("textbox", {
    name: "Edit message",
    exact: true,
  });
  await emojiEditComposer.fill(":SHIPIT: :shipit: :unknown:");
  await page.getByRole("button", { name: "Save edit" }).click();
  await expect
    .poll(() =>
      submittedEvents
        .filter(
          (event) =>
            event.kind === 40003 &&
            event.tags.some(
              (tag) => tag[0] === "e" && tag[1] === emojiMessage?.id,
            ),
        )
        .at(-1),
    )
    .toMatchObject({
      content: ":SHIPIT: :shipit: :unknown:",
      tags: expect.arrayContaining([
        ["emoji", "shipit", "https://example.com/shipit.png"],
      ]),
    });
  const emojiEdit = submittedEvents
    .filter(
      (event) =>
        event.kind === 40003 &&
        event.tags.some((tag) => tag[0] === "e" && tag[1] === emojiMessage?.id),
    )
    .at(-1);
  expect(emojiEdit?.tags.filter((tag) => tag[0] === "emoji")).toEqual([
    ["emoji", "shipit", "https://example.com/shipit.png"],
  ]);
  const mentionComposer = page.getByLabel("Message #general");
  await page.getByRole("button", { name: "Mention someone" }).click();
  await page.getByRole("button", { name: "Mention Relay agent" }).click();
  const mentionContent =
    "@Relay agent review `@Relay agent` [@Relay agent](https://example.com)";
  await expect(mentionComposer).toHaveValue("@Relay agent ");
  await mentionComposer.fill(mentionContent);
  await expect(mentionComposer).toHaveValue(mentionContent);
  await mentionComposer.press("Enter");
  await expect
    .poll(() =>
      submittedEvents.find(
        (event) => event.kind === 9 && event.content === mentionContent,
      ),
    )
    .toMatchObject({ tags: expect.arrayContaining([["p", catalogPubkey]]) });
  const mentionMessage = submittedEvents.find(
    (event) => event.kind === 9 && event.content === mentionContent,
  );
  const mentionArticle = page.locator(
    `article[id="message-${mentionMessage?.id}"]`,
  );
  await expect(mentionArticle.locator("[data-mention]")).toHaveCount(1);
  await mentionArticle.screenshot({
    path: "/tmp/buzz-web-message-mention.png",
  });
  await mentionArticle.locator("[data-mention]").click();
  const mentionProfile = page.getByRole("dialog", {
    name: "Relay agent profile",
  });
  await expect(mentionProfile).toBeVisible();
  await mentionProfile.getByRole("button", { name: "Close" }).click();
  const previewUrl = "https://github.com/block/sprout/pull/1334";
  const previewComposer = page.getByLabel("Message #general");
  await previewComposer.fill(previewUrl);
  await previewComposer.press("Enter");
  await expect
    .poll(() =>
      submittedEvents.find(
        (event) => event.kind === 9 && event.content === previewUrl,
      ),
    )
    .toBeTruthy();
  const previewMessage = submittedEvents.find(
    (event) => event.kind === 9 && event.content === previewUrl,
  );
  const previewArticle = page.locator(
    `article[id="message-${previewMessage?.id}"]`,
  );
  await expect(
    previewArticle.getByRole("link", { exact: true, name: previewUrl }),
  ).toBeVisible();
  const previewCard = previewArticle.locator(
    '[data-link-preview="github-pull-request"]',
  );
  await expect(previewCard).toHaveAttribute("href", previewUrl);
  await expect(previewCard).toHaveAttribute("target", "_blank");
  await expect(previewCard).toHaveAttribute("rel", "noreferrer");
  await previewArticle.screenshot({ path: "/tmp/buzz-web-link-preview.png" });
  const channelLinkComposer = page.getByLabel("Message #general");
  await channelLinkComposer.fill("See #web");
  const channelSuggestionsList = page.getByRole("listbox", {
    name: "Channel suggestions",
  });
  await expect(channelSuggestionsList).toBeVisible();
  await expect(
    channelSuggestionsList.getByRole("option", {
      name: "Insert #web-forum",
    }),
  ).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  const channelSuggestionsBox = await channelSuggestionsList.boundingBox();
  expect(channelSuggestionsBox).not.toBeNull();
  expect(channelSuggestionsBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(
    (channelSuggestionsBox?.x ?? 0) + (channelSuggestionsBox?.width ?? 0),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "/tmp/buzz-web-channel-autocomplete-mobile.png",
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await channelLinkComposer.press("Shift+Enter");
  await expect(channelLinkComposer).toHaveValue("See #web\n");
  await channelLinkComposer.fill("See #web");
  await expect(channelSuggestionsList).toBeVisible();
  await channelLinkComposer.press("Enter");
  await expect(channelLinkComposer).toHaveValue("See #web-forum ");
  const channelLinkContent =
    "See #web-forum and `#web-forum` [#web-forum](https://example.com)";
  await channelLinkComposer.fill(channelLinkContent);
  await channelLinkComposer.press("Enter");
  await expect
    .poll(() =>
      submittedEvents.find(
        (event) => event.kind === 9 && event.content === channelLinkContent,
      ),
    )
    .toBeTruthy();
  const channelLinkMessage = submittedEvents.find(
    (event) => event.kind === 9 && event.content === channelLinkContent,
  );
  const channelLinkArticle = page.locator(
    `article[id="message-${channelLinkMessage?.id}"]`,
  );
  await expect(channelLinkArticle.locator("[data-channel-link]")).toHaveCount(
    1,
  );
  await channelLinkArticle.screenshot({
    path: "/tmp/buzz-web-channel-link.png",
  });
  await channelLinkArticle
    .getByRole("button", { name: "Open channel web-forum" })
    .click();
  await expect(page.getByRole("heading", { name: "web-forum" })).toBeVisible();
  expect(ownerPubkey).toMatch(/^[0-9a-f]{64}$/);
  await expect(
    page.getByRole("button", { name: "Start a new post..." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start a new post..." }).click();
  const forumComposer = page.getByLabel("Create a new post");
  await forumComposer.fill("A focused web forum post");
  await forumComposer
    .locator("xpath=ancestor::form")
    .getByRole("button", { name: "Send message" })
    .click();
  await expect(page.getByText("A focused web forum post")).toBeVisible();
  await page.getByRole("button", { name: "View post" }).click();
  await expect(
    page.getByRole("complementary", { name: "Forum thread" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Back to posts" }),
  ).toBeVisible();
  const forumReply = page.getByLabel("Reply in thread");
  await forumReply.fill("A focused forum reply");
  await forumReply.press("Enter");
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 45003 &&
          event.tags.some(
            (tag) =>
              tag[0] === "h" &&
              tag[1] === "55555555-5555-4555-8555-555555555555",
          ),
      ),
    )
    .toBe(true);
  const forumReplyArticle = page
    .locator("article")
    .filter({ hasText: "A focused forum reply" });
  await expect(forumReplyArticle).toBeVisible();
  await expect(forumReply).toBeFocused();
  await forumReply.press("ArrowUp");
  const forumThread = page.getByRole("complementary", {
    name: "Forum thread",
  });
  const forumEditComposer = forumThread.getByRole("textbox", {
    name: "Edit message",
    exact: true,
  });
  await expect(forumEditComposer).toHaveValue("A focused forum reply");
  await forumEditComposer.press("Escape");
  await expect(forumReply).toHaveValue("");
  await page.screenshot({ path: "/tmp/buzz-web-forum-thread.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/buzz-web-forum-thread-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Back to posts" }).click();
  await expect(page.getByRole("button", { name: "1 reply" })).toBeVisible();
  await page.getByRole("button", { name: /^general(?: \d+)?$/u }).click();
  await expect(page.getByRole("complementary", { name: "Thread" })).toHaveCount(
    0,
  );
  await expect(page).not.toHaveURL(/message=/u);
  await expect(page.getByText(/is typing…$/)).toBeVisible();
  await page.getByLabel("Message #general").fill("Typing interoperability");
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 20002 &&
          event.tags.some(
            (tag) =>
              tag[0] === "h" &&
              tag[1] === "44444444-4444-4444-8444-444444444444",
          ),
      ),
    )
    .toBe(true);
  await page.getByLabel("Message #general").fill("");
  expect(submittedEvents.some((event) => event.kind === 20001)).toBe(true);
  const composer = page.getByLabel("Message #general");
  await composer.fill("format me");
  await composer.selectText();
  await page.getByRole("button", { name: "Toggle formatting" }).click();
  await page.getByRole("button", { name: "Bold" }).click();
  await expect(composer).toHaveValue("**format me**");
  const shortcutModifier = await page.evaluate(() =>
    /Mac|iPhone|iPad|iPod/u.test(navigator.platform) ? "Meta" : "Control",
  );
  await page.keyboard.press(`${shortcutModifier}+F`);
  const channelFind = page.getByLabel("Find in channel");
  await expect(channelFind).toBeVisible();
  await channelFind.fill("Welcome to Buzz");
  await expect(page.getByText("1 of 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next match" })).toBeEnabled();
  await expect(page).not.toHaveURL(/message=/u);
  await expect(page.getByRole("complementary", { name: "Thread" })).toHaveCount(
    0,
  );
  await channelFind.press("Escape");
  await expect(channelFind).toBeHidden();
  await composer.fill("keyboard bold");
  await composer.selectText();
  await composer.press(`${shortcutModifier}+B`);
  await expect(composer).toHaveValue("**keyboard bold**");
  await page.getByRole("button", { name: "Insert emoji" }).click();
  await page.getByRole("button", { name: "Insert 🚀" }).click();
  await expect(composer).toHaveValue(/🚀/u);
  await page.getByRole("button", { name: "Mention someone" }).click();
  await page.getByLabel("Find someone to mention").fill("Relay agent");
  await page.getByRole("button", { name: "Mention Relay agent" }).click();
  await expect(composer).toHaveValue(/@Relay agent/u);
  await composer
    .locator("xpath=ancestor::form")
    .locator('input[type="file"]')
    .setInputFiles({
      name: "draft-note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Persisted draft attachment"),
    });
  await expect(page.getByText("draft-note.txt")).toBeVisible();
  const composerForm = composer.locator("xpath=ancestor::form");
  await composerForm.evaluate((form) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(["Dropped draft attachment"], "dropped-note.txt", {
        type: "text/plain",
      }),
    );
    form.dispatchEvent(
      new DragEvent("dragenter", { bubbles: true, dataTransfer }),
    );
  });
  await expect(page.getByText("Drop files to upload")).toBeVisible();
  await composerForm.evaluate((form) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(["Dropped draft attachment"], "dropped-note.txt", {
        type: "text/plain",
      }),
    );
    form.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer }));
  });
  await expect(page.getByText("dropped-note.txt")).toBeVisible();
  await composer.evaluate((textarea) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File(["Pasted draft attachment"], "pasted-note.txt", {
        type: "text/plain",
      }),
    );
    textarea.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData }),
    );
  });
  await expect(page.getByText("pasted-note.txt")).toBeVisible();
  const imageBase64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 140;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable in the test browser.");
    context.fillStyle = "#f8fafc";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#0f766e";
    context.fillRect(20, 20, 200, 100);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await composer
    .locator("xpath=ancestor::form")
    .locator('input[type="file"]')
    .setInputFiles({
      name: "diagram.png",
      mimeType: "image/png",
      buffer: Buffer.from(imageBase64, "base64"),
    });
  await page.getByRole("button", { name: "Preview diagram.png" }).click();
  const imagePreview = page.getByRole("dialog", {
    name: "diagram.png preview",
  });
  await expect(imagePreview).toBeVisible();
  await imagePreview.getByRole("button", { name: "Mark as spoiler" }).click();
  await expect(
    imagePreview.getByRole("button", { name: "Remove spoiler" }),
  ).toHaveAttribute("aria-pressed", "true");
  await imagePreview.getByRole("button", { name: "Draw on image" }).click();
  const drawingCanvas = page.getByLabel("Drawing canvas");
  await expect(drawingCanvas).toBeVisible();
  const drawingBounds = await drawingCanvas.boundingBox();
  expect(drawingBounds).not.toBeNull();
  if (drawingBounds) {
    await page.mouse.move(
      drawingBounds.x + drawingBounds.width * 0.25,
      drawingBounds.y + drawingBounds.height * 0.25,
    );
    await page.mouse.down();
    await page.mouse.move(
      drawingBounds.x + drawingBounds.width * 0.75,
      drawingBounds.y + drawingBounds.height * 0.75,
      { steps: 8 },
    );
    await page.mouse.up();
  }
  await expect(
    page.getByRole("button", { name: "Undo drawing" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Undo drawing" }).click();
  await expect(
    page.getByRole("button", { name: "Redo drawing" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Redo drawing" }).click();
  await page.screenshot({ path: "/tmp/buzz-web-image-editor.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(drawingCanvas).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/buzz-web-image-editor-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saving..." })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Draw on image", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preview diagram-annotated.png" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Preview diagram-annotated.png" })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove spoiler" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Revert" }).click();
  await expect(
    page.getByRole("button", { name: "Preview diagram.png" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview diagram.png" }).click();
  await expect(
    page.getByRole("button", { name: "Remove spoiler" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "web-forum", exact: true }).click();
  await page.getByRole("button", { name: /^general(?: \d+)?$/u }).click();
  await page.getByRole("button", { name: "Preview diagram.png" }).click();
  await expect(
    page.getByRole("button", { name: "Remove spoiler" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add direct messages" }).click();
  const newMessageDialog = page.getByRole("dialog", { name: "New message" });
  await expect(
    newMessageDialog.getByRole("button", { name: "Add Relay agent" }),
  ).toBeVisible();
  await newMessageDialog
    .getByLabel("Find people and agents")
    .fill("Relay agent");
  await newMessageDialog
    .getByRole("button", { name: "Add Relay agent" })
    .click();
  await expect(
    newMessageDialog.getByRole("button", { name: "Open conversation" }),
  ).toBeEnabled();
  await expect(
    newMessageDialog.getByRole("button", { name: "Remove Relay agent" }),
  ).toBeVisible();
  await newMessageDialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Create section" }).click();
  const createSectionDialog = page.getByRole("dialog", {
    name: "Create section",
  });
  await createSectionDialog.getByLabel("Name").fill("Launch");
  await createSectionDialog.getByLabel("Icon (optional)").fill("🚀");
  await createSectionDialog
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await expect(page.getByText("🚀 Launch", { exact: true })).toBeVisible();
  await page
    .getByLabel("Move #general to section")
    .selectOption({ label: "Launch" });
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 30078 &&
          event.tags.some(
            (tag) => tag[0] === "d" && tag[1] === "channel-sections",
          ) &&
          event.tags.some(
            (tag) => tag[0] === "t" && tag[1] === "channel-sections",
          ) &&
          !event.content.includes("Launch") &&
          !event.content.includes("general"),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Rename 🚀 Launch" }).click();
  const renameSectionDialog = page.getByRole("dialog", {
    name: "Rename section",
  });
  await renameSectionDialog.getByLabel("Name").fill("Release");
  await renameSectionDialog
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.getByText("🚀 Release", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete 🚀 Release" }).click();
  const deleteSectionDialog = page.getByRole("dialog", {
    name: "Delete section",
  });
  await expect(deleteSectionDialog).toContainText(
    'Delete section "Release"? Its 1 channel will move back to the default Channels group.',
  );
  await page.keyboard.press("Escape");
  await expect(deleteSectionDialog).toBeHidden();
  await page.getByRole("button", { name: "Star #general" }).click();
  await expect(page.getByText("Starred", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Unstar #general" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 30078 &&
          event.tags.some(
            (tag) => tag[0] === "d" && tag[1] === "channel-stars",
          ) &&
          event.tags.some(
            (tag) => tag[0] === "t" && tag[1] === "channel-stars",
          ) &&
          !event.content.includes("44444444-4444-4444-8444-444444444444"),
      ),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Sort Starred by recent activity" })
    .click();
  await expect(
    page.getByRole("button", { name: "Sort Starred alphabetically" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 30078 &&
          event.tags.some(
            (tag) => tag[0] === "d" && tag[1] === "channel-sort",
          ) &&
          event.tags.some(
            (tag) => tag[0] === "t" && tag[1] === "channel-sort",
          ) &&
          !event.content.includes("recent"),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Mark unread #general" }).click();
  await expect(
    page.getByRole("button", { name: "Mark read #general" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Mark unread #general" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark unread #general" }).click();
  await page.keyboard.press("Shift+Escape");
  await expect(
    page.getByRole("button", { name: "Mark unread #general" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Search messages" }).click();
  await page
    .getByLabel("Search query")
    .fill(
      `Wel in:general from:${catalogPubkey} after:2026-01-02 before:2026-02-03`,
    );
  await expect(page.getByText("Welcome search result")).toBeVisible();
  expect(capturedSearchFilter).toMatchObject({
    search: "Wel",
    search_mode: "prefix",
    authors: [catalogPubkey],
    "#h": ["44444444-4444-4444-8444-444444444444"],
  });
  expect(capturedSearchFilter?.since).toEqual(expect.any(Number));
  expect(capturedSearchFilter?.until).toEqual(expect.any(Number));
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Open Relay agent profile" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("profile"))
    .toBe(catalogPubkey);
  await expect(
    page.getByRole("dialog", { name: "Relay agent profile" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "Relay agent profile" })
      .getByText("relay-agent@example.com")
      .first(),
  ).toBeVisible();
  await expect(page.getByText("Posts build updates")).toBeVisible();
  await expect(page.getByText("Reviewing builds")).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "Relay agent profile" })
      .getByRole("img", { name: "online" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "Relay agent profile" })
      .getByRole("button", { name: "Message", exact: true }),
  ).toBeVisible();
  const channelProfile = page.getByRole("dialog", {
    name: "Relay agent profile",
  });
  await expect(
    channelProfile.getByRole("tab", { name: "Runtime" }),
  ).toHaveCount(0);
  await expect(
    channelProfile.getByRole("tab", { name: "Memories" }),
  ).toHaveCount(0);
  await channelProfile.getByRole("button", { name: "Follow" }).click();
  await expect
    .poll(() => submittedEvents.filter((event) => event.kind === 3).length)
    .toBe(1);
  expect(
    submittedEvents.filter((event) => event.kind === 3).at(-1)?.tags,
  ).toContainEqual(["p", catalogPubkey]);
  await expect(
    channelProfile.getByRole("button", { name: "Unfollow" }),
  ).toBeVisible();
  await channelProfile.getByRole("button", { name: "Unfollow" }).click();
  await expect
    .poll(() => submittedEvents.filter((event) => event.kind === 3).length)
    .toBe(2);
  expect(
    submittedEvents
      .filter((event) => event.kind === 3)
      .at(-1)
      ?.tags.some((tag) => tag[0] === "p" && tag[1] === catalogPubkey),
  ).toBe(false);
  await channelProfile.getByRole("button", { name: "Close" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.has("profile"))
    .toBe(false);
  await page.goBack();
  await expect(channelProfile).toBeVisible();
  await page.goForward();
  await expect(channelProfile).toBeHidden();
  const welcomeMessage = page
    .getByLabel("Messages", { exact: true })
    .locator("article")
    .filter({ hasText: "Welcome to Buzz Web." });
  await welcomeMessage.hover();
  await welcomeMessage.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "Copy message" }).click();
  await expect(page.getByRole("menu")).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("Welcome to Buzz Web.");
  await welcomeMessage.hover();
  await welcomeMessage.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "Copy link" }).click();
  await expect(page.getByRole("menu")).toBeHidden();
  const copiedMessageUrl = new URL(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
  expect(copiedMessageUrl.pathname).toBe("/channels");
  expect(copiedMessageUrl.searchParams.get("channel")).toBe(
    "44444444-4444-4444-8444-444444444444",
  );
  expect(copiedMessageUrl.searchParams.get("message")).toMatch(
    /^[0-9a-f]{64}$/u,
  );
  await welcomeMessage.hover();
  await welcomeMessage.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  const initialMarkRead = page.getByRole("menuitem", { name: "Mark read" });
  if (await initialMarkRead.isVisible()) {
    await initialMarkRead.click();
    await welcomeMessage.hover();
    await welcomeMessage.getByRole("button", { name: "More actions" }).click();
  }
  await page.getByRole("menuitem", { name: "Mark unread" }).click();
  await expect(
    page.getByRole("button", { name: "Mark read #general" }),
  ).toBeVisible();
  await welcomeMessage.hover();
  await welcomeMessage.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Mark read" }).click();
  await expect(
    page.getByRole("button", { name: "Mark unread #general" }),
  ).toBeVisible();
  await welcomeMessage.hover();
  await welcomeMessage.getByRole("button", { name: "Reply" }).click();
  await expect(page.getByRole("heading", { name: "Thread" })).toBeVisible();
  await page.getByRole("button", { name: "Follow thread" }).click();
  await expect(
    page.getByRole("button", { name: "Unfollow thread" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        (pubkey) =>
          JSON.parse(
            localStorage.getItem(`buzz-thread-follows.v1:${pubkey}`) ?? "[]",
          ).length,
        ownerPubkey,
      ),
    )
    .toBe(1);
  await page.getByRole("button", { name: "Unfollow thread" }).click();
  await expect(
    page.getByRole("button", { name: "Follow thread" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        (pubkey) =>
          JSON.parse(
            localStorage.getItem(`buzz-thread-muted.v1:${pubkey}`) ?? "[]",
          ).length,
        ownerPubkey,
      ),
    )
    .toBe(1);
  await page.getByRole("button", { name: "Follow thread" }).click();
  const closeThread = page.getByRole("button", { name: "Close thread" });
  if (await closeThread.isVisible())
    await closeThread.click({ timeout: 1_000 }).catch(() => {});
  await welcomeMessage.hover();
  await welcomeMessage.getByRole("button", { name: "Add reaction" }).click();
  await page.getByRole("button", { name: "React with :shipit:" }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 7 &&
          event.content === ":shipit:" &&
          event.tags.some(
            (tag) =>
              tag[0] === "emoji" &&
              tag[1] === "shipit" &&
              tag[2] === "https://example.com/shipit.png",
          ),
      ),
    )
    .toBe(true);
  await welcomeMessage.hover();
  await welcomeMessage.getByRole("button", { name: "Report message" }).click();
  await page.getByLabel("Details (optional)").fill("Automated promotion");
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 1984 &&
          event.content === "Automated promotion" &&
          event.tags.some((tag) => tag[0] === "e" && tag[2] === "spam"),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Channel settings" }).click();
  const channelSettingsDialog = page.getByRole("dialog", {
    name: "Channel settings",
  });
  await expect(page.getByText("Members 1")).toBeVisible();
  await page.getByLabel("New channel member").fill("aa".repeat(32));
  await page.getByLabel("New member role").selectOption("admin");
  await page.getByRole("button", { name: "Add channel member" }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 9000 &&
          event.tags.some(
            (tag) => tag[0] === "p" && tag[1] === "aa".repeat(32),
          ) &&
          event.tags.some((tag) => tag[0] === "role" && tag[1] === "admin"),
      ),
    )
    .toBe(true);
  await expect(page.getByText("No canvas set for this channel.")).toBeVisible();
  await page.getByRole("button", { name: "Create canvas" }).click();
  await page
    .getByLabel("Canvas content")
    .fill("# General canvas\n\nShared **Markdown** notes.");
  await page.getByRole("button", { name: "Save canvas" }).click();
  await expect(page.getByText("General canvas")).toBeVisible();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 40100 &&
          event.content === "# General canvas\n\nShared **Markdown** notes." &&
          event.tags.some(
            (tag) =>
              tag[0] === "h" &&
              tag[1] === "44444444-4444-4444-8444-444444444444",
          ),
      ),
    )
    .toBe(true);
  await page.getByLabel("Mute channel").check();
  await channelSettingsDialog
    .getByRole("button", { name: "Leave", exact: true })
    .click();
  const leaveChannelDialog = page.getByRole("dialog", {
    name: "Leave channel",
  });
  await expect(leaveChannelDialog).toContainText(
    'Leave "general"? You\'ll stop receiving its messages and can rejoin later.',
  );
  await page.keyboard.press("Escape");
  await expect(leaveChannelDialog).toBeHidden();
  await channelSettingsDialog
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  const deleteChannelDialog = page.getByRole("dialog", {
    name: "Delete channel?",
  });
  await expect(deleteChannelDialog).toContainText(
    "Delete general from the community list. This action cannot be undone.",
  );
  await deleteChannelDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(deleteChannelDialog).toBeHidden();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("img", { name: "Muted" })).toBeVisible();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 30078 &&
          event.content.length > 0 &&
          event.tags.some(
            (tag) => tag[0] === "d" && tag[1] === "channel-mutes",
          ) &&
          event.tags.some(
            (tag) => tag[0] === "t" && tag[1] === "channel-mutes",
          ),
      ),
    )
    .toBe(true);
  await welcomeMessage.hover();
  await welcomeMessage.getByRole("button", { name: "Remind me later" }).click();
  await page.getByLabel("Private note (optional)").fill("Follow up privately");
  await page.getByRole("button", { name: "In 30 minutes" }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 30300 &&
          /^[0-9a-f]{32}$/.test(
            event.tags.find((tag) => tag[0] === "d")?.[1] ?? "",
          ) &&
          Number(event.tags.find((tag) => tag[0] === "not_before")?.[1]) >
            Math.floor(Date.now() / 1000) &&
          event.tags.some(
            (tag) => tag[0] === "alt" && tag[1] === "Encrypted reminder",
          ) &&
          !event.content.includes("Follow up privately") &&
          !event.content.includes("Welcome to Buzz Web"),
      ),
    )
    .toBe(true);

  await page.getByRole("link", { name: "Inbox" }).click();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await page.getByLabel("Inbox filter").selectOption("project");
  await expect(
    page.getByText("Review the signed project issue").first(),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open project" })).toBeVisible();
  await page.getByLabel("Inbox filter").selectOption("thread");
  await expect(
    page.getByText("Owner mention from inbox").first(),
  ).toBeVisible();
  await page
    .getByRole("button")
    .filter({ hasText: "Owner mention from inbox" })
    .first()
    .click();
  await page.getByRole("button", { name: "Open Relay agent profile" }).click();
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return {
        item: url.searchParams.get("item"),
        profile: url.searchParams.get("profile"),
      };
    })
    .toEqual({ item: expect.any(String), profile: catalogPubkey });
  const inboxProfile = page.getByRole("dialog", {
    name: "Relay agent profile",
  });
  await expect(inboxProfile).toBeVisible();
  await inboxProfile.getByRole("button", { name: "Close" }).click();
  await page.goBack();
  await expect(inboxProfile).toBeVisible();
  await page.goForward();
  await expect(inboxProfile).toBeHidden();
  await expect(
    page.getByText("Owner mention from inbox").first(),
  ).toBeVisible();
  await page.getByLabel("Inbox filter").selectOption("agent_activity");
  await expect(page.getByText("No agent updates found")).toBeVisible();
  await page.getByLabel("Inbox filter").selectOption("drafts");
  await expect(page.getByText(/@Relay agent/u).first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "draft-note.txt" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "dropped-note.txt" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "pasted-note.txt" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete draft" }).click();
  await expect(page.getByText("No drafts")).toBeVisible();
  await page.getByRole("link", { name: "Channels" }).click();
  await page.getByLabel("Message #general").fill("Saved browser draft");
  await page.getByRole("link", { name: "Inbox" }).click();
  await page.getByLabel("Inbox filter").selectOption("drafts");
  await expect(page.getByText("Saved browser draft").first()).toBeVisible();
  await page.getByRole("link", { name: "Open draft" }).click();
  await expect(page).toHaveURL(/\/channels/);
  await expect(page.getByLabel("Message #general")).toHaveValue(
    "Saved browser draft",
  );
  await page.getByLabel("Message #general").fill("");
  await page.getByRole("link", { name: "Inbox" }).click();
  await page.getByLabel("Inbox filter").selectOption("drafts");
  await expect(page.getByText("No drafts")).toBeVisible();
  await page.getByRole("link", { name: "Channels" }).click();
  const spoilerMessage = "Spoiler attachment from web";
  const spoilerComposer = page.getByLabel("Message #general");
  await spoilerComposer.fill(spoilerMessage);
  await spoilerComposer
    .locator("xpath=ancestor::form")
    .locator('input[type="file"]')
    .setInputFiles({
      name: "spoiler-diagram.png",
      mimeType: "image/png",
      buffer: Buffer.from(imageBase64, "base64"),
    });
  await page
    .getByRole("button", { name: "Preview spoiler-diagram.png" })
    .click();
  await page.getByRole("button", { name: "Mark as spoiler" }).click();
  await page.screenshot({ path: "/tmp/buzz-web-composer-spoiler.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Remove spoiler", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/buzz-web-composer-spoiler-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.keyboard.press("Escape");
  await spoilerComposer.press("Enter");
  await expect
    .poll(
      () =>
        submittedEvents.find(
          (event) =>
            event.kind === 9 && event.content.startsWith(spoilerMessage),
        )?.content,
    )
    .toMatch(
      /^Spoiler attachment from web\n\|\|!\[image\]\(http:\/\/localhost:\d+\/media\/[0-9a-f]{64}\)\|\|$/u,
    );
  const spoilerEvent = submittedEvents.find(
    (event) => event.kind === 9 && event.content.startsWith(spoilerMessage),
  );
  const spoilerMediaUrl = spoilerEvent?.content.match(
    /\((https?:\/\/[^)]+)\)/u,
  )?.[1];
  expect(spoilerEvent?.tags).toContainEqual(
    expect.arrayContaining(["imeta", `url ${spoilerMediaUrl}`]),
  );
  expect(spoilerEvent?.tags).toContainEqual(
    expect.arrayContaining(["imeta", "filename spoiler-diagram.png"]),
  );
  const spoilerArticle = page.locator(
    `article[id="message-${spoilerEvent?.id}"]`,
  );
  await expect(spoilerArticle).toBeVisible();
  await expect(
    spoilerArticle.getByRole("button", { name: "Reveal spoilered image" }),
  ).toBeVisible();
  await expect(spoilerArticle.locator("img")).toHaveCount(1);
  await spoilerArticle
    .getByRole("button", { name: "Reveal spoilered image" })
    .click();
  await expect(
    spoilerArticle.getByRole("button", { name: "Reveal spoilered image" }),
  ).toBeHidden();
  await page
    .getByLabel("Message #general")
    .fill("Send from the web inbox to @Relay");
  await expect(
    page
      .getByRole("listbox", { name: "Mention suggestions" })
      .getByRole("option", { name: "Mention Relay agent" }),
  ).toBeVisible();
  await page.getByLabel("Message #general").press("Enter");
  await expect(page.getByLabel("Message #general")).toHaveValue(
    "Send from the web inbox to @Relay agent ",
  );
  await page.getByRole("link", { name: "Inbox" }).click();
  await page.getByLabel("Inbox filter").selectOption("drafts");
  await page.getByRole("button", { name: "Send draft" }).click();
  const sendDraftDialog = page.getByRole("dialog", { name: "Send draft" });
  await sendDraftDialog.getByRole("button", { name: "Send" }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 9 &&
          event.content === "Send from the web inbox to @Relay agent",
      ),
    )
    .toBe(true);
  const sentDraft = submittedEvents.find(
    (event) =>
      event.kind === 9 &&
      event.content === "Send from the web inbox to @Relay agent",
  );
  expect(sentDraft?.id).toMatch(/^[0-9a-f]{64}$/u);
  expect(sentDraft?.tags).toContainEqual(["p", catalogPubkey]);
  await expect(page.getByText("No drafts")).toBeVisible();
  await page.getByLabel("Inbox filter").selectOption("reminders");
  await expect(page.getByText("Follow up privately")).toBeVisible();
  await expect(page.getByLabel("Snooze reminder")).toBeVisible();
  await page.getByLabel("Snooze reminder").selectOption({
    label: "In 1 hour",
  });
  await expect
    .poll(() => submittedEvents.filter((event) => event.kind === 30300).length)
    .toBeGreaterThanOrEqual(2);

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await expect(page.getByLabel("Display name")).toHaveValue("");
  await expect(page.getByText("Not set", { exact: true })).toBeVisible();
  await page.getByLabel("Display name").fill("Web owner");
  await page.getByLabel("About").fill("Owner profile from the browser");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect
    .poll(() => {
      const profileEvent = submittedEvents.find(
        (event) => event.kind === 0 && event.pubkey === ownerPubkey,
      );
      const metadata = profileEvent
        ? (JSON.parse(profileEvent.content) as Record<string, unknown>)
        : null;
      return metadata;
    })
    .toMatchObject({
      display_name: "Web owner",
      name: "Web owner",
      about: "Owner profile from the browser",
    });
  await page.getByLabel("Passkey label").fill("Bitwarden passkey");
  await page.getByRole("button", { name: "Add passkey" }).click();
  await expect(page.getByText("Passkey added")).toBeVisible();
  expect(addedCredentialCount).toBe(1);
  await page.getByRole("button", { name: "Create backup" }).click();
  await page
    .getByLabel("Backup password", { exact: true })
    .fill("correct horse battery staple");
  await page
    .getByLabel("Confirm password")
    .fill("correct horse battery staple");
  const ownerBackupDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup" }).click();
  const ownerBackup = await ownerBackupDownload;
  expect(ownerBackup.suggestedFilename()).toBe(
    `buzz-owner-${ownerPubkey}.ncryptsec`,
  );
  const encryptedOwnerKey = (await downloadedBytes(ownerBackup))
    .toString("utf8")
    .trim();
  expect(encryptedOwnerKey).toMatch(/^ncryptsec1/u);
  const restoredOwnerKey = decryptNip49(
    encryptedOwnerKey,
    "correct horse battery staple",
  );
  expect(getPublicKey(restoredOwnerKey)).toBe(ownerPubkey);
  restoredOwnerKey.fill(0);
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page).toHaveURL(/\/settings\?section=notifications$/u);
  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /Browser alerts/u }).check();
  await page.getByLabel("@Mentions sound").selectOption("ping");
  await page.getByRole("checkbox", { name: "Thread replies alerts" }).uncheck();
  await page.getByRole("button", { name: "View all" }).click();
  await expect(page.getByText("Agent: job accepted")).toBeVisible();
  const appNavigation = page.getByRole("complementary", {
    name: "App navigation",
  });
  await expect(
    appNavigation.getByRole("status", { name: /unread Inbox items/u }),
  ).toBeVisible();
  const inboxBadgeSetting = page.getByRole("checkbox", {
    name: "Inbox badge",
  });
  await inboxBadgeSetting.uncheck();
  await expect(
    appNavigation.getByRole("status", { name: /unread Inbox items/u }),
  ).toHaveCount(0);
  await inboxBadgeSetting.check();
  await expect(
    appNavigation.getByRole("status", { name: /unread Inbox items/u }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate((pubkey) => {
        const raw = localStorage.getItem(
          `buzz-notification-settings.v2:${pubkey}`,
        );
        return raw ? JSON.parse(raw) : null;
      }, ownerPubkey),
    )
    .toMatchObject({
      desktopEnabled: true,
      homeBadgeEnabled: true,
      sounds: { mention: "ping" },
      slotAlertsEnabled: { thread_reply: false },
    });
  await expect.poll(() => sendLiveChannelEvent !== null).toBe(true);
  const liveMention = finalizeEvent(
    {
      kind: 9,
      created_at: Math.floor(Date.now() / 1_000),
      content: "A live mention while viewing Settings",
      tags: [
        ["h", "44444444-4444-4444-8444-444444444444"],
        ["p", ownerPubkey],
      ],
    },
    catalogSecret,
  );
  sendLiveChannelEvent?.(liveMention);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __buzzTestNotifications?: Array<{ body?: string }>;
            }
          ).__buzzTestNotifications?.some(
            (notification) =>
              notification.body === "A live mention while viewing Settings",
          ) ?? false,
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    (
      window as typeof window & {
        __buzzTestLastNotification?: { onclick: (() => void) | null };
      }
    ).__buzzTestLastNotification?.onclick?.();
  });
  await expect(page).toHaveURL(
    new RegExp(`/channels\\?channel=.*&message=${liveMention.id}`),
  );
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Voice" }).click();
  await expect(page).toHaveURL(/\/settings\?section=voice$/u);
  await expect(page.getByRole("heading", { name: "Voice" })).toBeVisible();
  await expect(page.getByLabel("System voice")).toHaveValue("test-local");
  await expect(
    page.getByLabel("System voice").getByRole("option", {
      name: /Test remote voice/u,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Preview voice" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __buzzTestSpoken?: string[] })
            .__buzzTestSpoken,
      ),
    )
    .toContain("Hello! This is how I'll read agent responses.");
  await page.getByRole("checkbox", { name: "Agent text to speech" }).uncheck();
  await expect
    .poll(() =>
      page.evaluate((pubkey) => {
        const raw = localStorage.getItem(`buzz-web:tts-settings:${pubkey}`);
        return raw ? JSON.parse(raw) : null;
      }, ownerPubkey),
    )
    .toMatchObject({ enabled: false });
  await page.getByRole("checkbox", { name: "Agent text to speech" }).check();
  await page.getByRole("button", { name: "Appearance" }).click();
  await expect(page).toHaveURL(/\/settings\?section=appearance$/u);
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(page.getByTestId("theme-pair-buzz")).toBeVisible();
  await page.getByRole("button", { name: "Dark" }).click();
  await page.getByTestId("theme-option-github-dark").click();
  await expect(page.locator("html")).toHaveClass(/dark/u);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        theme: localStorage.getItem("buzz-theme"),
        followSystem: localStorage.getItem("buzz-follow-system"),
      })),
    )
    .toEqual({ theme: "github-dark", followSystem: "false" });
  await page.getByRole("button", { name: "Green accent" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-accent-color")))
    .toBe("#22c55e");
  await page.getByLabel("Thread layout").selectOption("focus");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("buzz.channels.threadViewMode")),
    )
    .toBe("focus");
  await page.getByRole("link", { name: "Channels" }).click();
  const focusThreadMessage = page.locator("article").filter({
    hasText: "Welcome to Buzz Web.",
  });
  await focusThreadMessage.hover();
  await focusThreadMessage.getByRole("button", { name: "Reply" }).click();
  await expect(page).toHaveURL(new RegExp(`message=${welcomeMessageEvent.id}`));
  await expect(
    page.getByRole("button", { name: "Back to channel" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Thread" })).toBeVisible();
  await page.getByRole("button", { name: "Close thread" }).click();
  await expect(page).not.toHaveURL(/message=/u);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Thread" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Thread" })).toHaveCount(0);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByLabel("Thread layout").selectOption("split");
  await page.getByRole("button", { name: "System" }).click();
  await page.getByTestId("theme-pair-buzz").click();
  await page.screenshot({
    path: "/tmp/buzz-web-settings-appearance.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Settings section")).toHaveValue("appearance");
  await expect(page.getByRole("link", { name: "Back to Buzz" })).toBeVisible();
  await page.screenshot({
    path: "/tmp/buzz-web-settings-appearance-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Shortcuts" }).click();
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  await expect(page.getByText("Quick search", { exact: true })).toBeVisible();
  await page.keyboard.press(`${shortcutModifier}+K`);
  const shortcutSearch = page.getByRole("dialog", {
    name: "Search messages",
  });
  await expect(shortcutSearch).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(shortcutSearch).toBeHidden();
  await page.getByRole("link", { name: "Channels" }).click();
  await expect(page.getByRole("heading", { name: "general" })).toBeVisible();
  const restoredComposer = page.getByLabel("Message #general");
  const arrowEditMessage = `Edit last with ArrowUp ${Date.now()}`;
  await restoredComposer.fill(arrowEditMessage);
  await restoredComposer.press("Enter");
  await expect(page.getByText(arrowEditMessage, { exact: true })).toBeVisible();
  await expect(restoredComposer).toBeFocused();
  await restoredComposer.press("ArrowUp");
  const arrowEditComposer = page.getByRole("textbox", {
    name: "Edit message",
    exact: true,
  });
  await expect(arrowEditComposer).toHaveValue(arrowEditMessage);
  await arrowEditComposer.press("Escape");
  await restoredComposer.fill("ArrowUp preserves a nonempty draft");
  await restoredComposer.press("ArrowUp");
  await expect(page.getByText("Editing message", { exact: true })).toHaveCount(
    0,
  );
  await expect(restoredComposer).toHaveValue(
    "ArrowUp preserves a nonempty draft",
  );
  await restoredComposer.fill("Draft survives message editing");
  await spoilerArticle.hover();
  await spoilerArticle.getByRole("button", { name: "Edit message" }).click();
  const editComposer = page.getByRole("textbox", {
    name: "Edit message",
    exact: true,
  });
  await expect(
    page.getByText("Editing message", { exact: true }),
  ).toBeVisible();
  await expect(editComposer).toHaveValue(spoilerMessage);
  await expect(
    page.getByRole("button", { name: "Preview spoiler-diagram.png" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel edit" }).click();
  await expect(restoredComposer).toHaveValue("Draft survives message editing");
  await spoilerArticle.hover();
  await spoilerArticle.getByRole("button", { name: "Edit message" }).click();
  await page
    .getByRole("button", { name: "Remove spoiler-diagram.png" })
    .click();
  await editComposer
    .locator("xpath=ancestor::form")
    .locator('input[type="file"]')
    .setInputFiles({
      name: "edit-replacement.png",
      mimeType: "image/png",
      buffer: Buffer.from(imageBase64, "base64"),
    });
  await page
    .getByRole("button", { name: "Preview edit-replacement.png" })
    .click();
  await page.getByRole("button", { name: "Mark as spoiler" }).click();
  await page.getByRole("button", { name: "Draw on image" }).click();
  const editDrawingCanvas = page.getByLabel("Drawing canvas");
  const editDrawingBounds = await editDrawingCanvas.boundingBox();
  expect(editDrawingBounds).not.toBeNull();
  if (editDrawingBounds) {
    await page.mouse.move(
      editDrawingBounds.x + editDrawingBounds.width * 0.2,
      editDrawingBounds.y + editDrawingBounds.height * 0.5,
    );
    await page.mouse.down();
    await page.mouse.move(
      editDrawingBounds.x + editDrawingBounds.width * 0.8,
      editDrawingBounds.y + editDrawingBounds.height * 0.5,
      { steps: 6 },
    );
    await page.mouse.up();
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Preview edit-replacement-annotated.png",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Preview edit-replacement-annotated.png" })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove spoiler", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Revert" }).click();
  await expect(
    page.getByRole("button", { name: "Preview edit-replacement.png" }),
  ).toBeVisible();
  await editComposer.fill("Edited attachment @Relay agent");
  await page.screenshot({ path: "/tmp/buzz-web-message-edit.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByText("Editing message", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/buzz-web-message-edit-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Save edit" }).click();
  await expect
    .poll(() =>
      submittedEvents
        .filter(
          (event) =>
            event.kind === 40003 &&
            event.tags.some(
              (tag) => tag[0] === "e" && tag[1] === spoilerEvent?.id,
            ),
        )
        .at(-1),
    )
    .toMatchObject({
      content: expect.stringMatching(
        /^Edited attachment @Relay agent\n\|\|!\[image\]\(http:\/\/localhost:\d+\/media\/[0-9a-f]{64}\)\|\|$/u,
      ),
      tags: expect.arrayContaining([
        ["h", "44444444-4444-4444-8444-444444444444"],
        ["e", spoilerEvent?.id],
        ["p", catalogPubkey],
        expect.arrayContaining(["imeta", "filename edit-replacement.png"]),
      ]),
    });
  await expect(restoredComposer).toHaveValue("Draft survives message editing");
  await expect(spoilerArticle).toContainText("Edited attachment @Relay agent");
  await expect(spoilerArticle.locator("img")).toHaveCount(1);
  await expect(
    spoilerArticle.getByRole("button", { name: "Reveal spoilered image" }),
  ).toBeVisible();
  await spoilerArticle.hover();
  await spoilerArticle.getByRole("button", { name: "Edit message" }).click();
  await page
    .getByRole("button", { name: "Remove edit-replacement.png" })
    .click();
  await editComposer.fill("Edited without attachment");
  await page.getByRole("button", { name: "Save edit" }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 40003 &&
          event.content === "Edited without attachment" &&
          event.tags.some(
            (tag) => tag[0] === "e" && tag[1] === spoilerEvent?.id,
          ),
      ),
    )
    .toBe(true);
  const attachmentWipeEdit = submittedEvents
    .filter(
      (event) =>
        event.kind === 40003 &&
        event.tags.some((tag) => tag[0] === "e" && tag[1] === spoilerEvent?.id),
    )
    .at(-1);
  expect(attachmentWipeEdit?.content).toBe("Edited without attachment");
  expect(attachmentWipeEdit?.tags.some((tag) => tag[0] === "imeta")).toBe(
    false,
  );
  await expect(spoilerArticle).toContainText("Edited without attachment");
  await expect(spoilerArticle.locator("img")).toHaveCount(0);
  await expect(restoredComposer).toHaveValue("Draft survives message editing");
  await restoredComposer.fill("");
  const emptyEditDeleteContent = "Delete through an empty edit";
  await restoredComposer.fill(emptyEditDeleteContent);
  await restoredComposer.press("Enter");
  await expect
    .poll(
      () =>
        submittedEvents.find(
          (event) =>
            event.kind === 9 && event.content === emptyEditDeleteContent,
        )?.id,
    )
    .toMatch(/^[0-9a-f]{64}$/u);
  const emptyEditDeleteEvent = submittedEvents.find(
    (event) => event.kind === 9 && event.content === emptyEditDeleteContent,
  );
  const emptyEditDeleteArticle = page.locator(
    `article[id="message-${emptyEditDeleteEvent?.id}"]`,
  );
  await expect(emptyEditDeleteArticle).toBeVisible();
  await emptyEditDeleteArticle.hover();
  await emptyEditDeleteArticle
    .getByRole("button", { name: "Edit message" })
    .click();
  const emptyEditDeleteComposer = page.getByRole("textbox", {
    name: "Edit message",
    exact: true,
  });
  await expect(emptyEditDeleteComposer).toHaveValue(emptyEditDeleteContent);
  await emptyEditDeleteComposer.fill("");
  await page.getByRole("button", { name: "Save edit" }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 9005 &&
          event.tags.some(
            (tag) => tag[0] === "e" && tag[1] === emptyEditDeleteEvent?.id,
          ),
      ),
    )
    .toBe(true);
  await expect(emptyEditDeleteArticle).toContainText(
    "This message was deleted.",
  );
  const sentDraftMessage = page.locator(
    `article[id="message-${sentDraft?.id}"]`,
  );
  await expect(sentDraftMessage).toBeVisible();
  await sentDraftMessage.hover();
  await sentDraftMessage.getByRole("button", { name: "Edit message" }).click();
  const messageEditor = page.getByRole("textbox", {
    name: "Edit message",
    exact: true,
  });
  await messageEditor.fill("");
  await page.keyboard.press("Escape");
  await expect(messageEditor).toBeHidden();
  await sentDraftMessage.hover();
  await sentDraftMessage
    .getByRole("button", { name: "Delete message" })
    .click();
  const deleteMessageDialog = page.getByRole("dialog", {
    name: "Delete message",
  });
  await expect(deleteMessageDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(deleteMessageDialog).toBeHidden();
  await sentDraftMessage.hover();
  await sentDraftMessage
    .getByRole("button", { name: "Delete message" })
    .click();
  await deleteMessageDialog.getByRole("button", { name: "Delete" }).click();
  await expect(deleteMessageDialog).toBeHidden();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 9005 &&
          event.tags.some(
            (tag) =>
              tag[0] === "h" &&
              tag[1] === "44444444-4444-4444-8444-444444444444",
          ) &&
          event.tags.some((tag) => tag[0] === "e" && tag[1].length === 64),
      ),
    )
    .toBe(true);
  await page.keyboard.press(`${shortcutModifier}+Shift+K`);
  const shortcutDm = page.getByRole("dialog", { name: "New message" });
  await expect(shortcutDm).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(shortcutDm).toBeHidden();
  await page.keyboard.press(`${shortcutModifier}+Shift+O`);
  const shortcutBrowser = page.getByRole("dialog", {
    name: "Browse channels",
  });
  await expect(shortcutBrowser).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(shortcutBrowser).toBeHidden();
  await page.keyboard.press(`${shortcutModifier}+Shift+N`);
  const shortcutCreate = page.getByRole("dialog", { name: "Create channel" });
  await expect(shortcutCreate).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(shortcutCreate).toBeHidden();
  const sidebarToggle = page.getByRole("button", { name: "Toggle Sidebar" });
  await sidebarToggle.click();
  await expect(page.getByRole("link", { name: "Inbox" })).toBeHidden();
  await page.keyboard.press(`${shortcutModifier}+S`);
  await expect(page.getByRole("link", { name: "Inbox" })).toBeVisible();
  await page.keyboard.press(`${shortcutModifier}+,`);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/channels/u);
  await page.keyboard.press(`${shortcutModifier}+,`);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.keyboard.press(`${shortcutModifier}+Shift+A`);
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await page.keyboard.press(`${shortcutModifier}+,`);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByLabel("Status emoji").fill("focus");
  await page.getByLabel("Status text").fill("Reviewing the web client");
  await page.getByRole("button", { name: "Set status" }).click();
  await expect
    .poll(() => {
      const status = submittedEvents.find((event) => event.kind === 30315);
      return (
        status?.content === "Reviewing the web client" &&
        status.tags.some((tag) => tag[0] === "d" && tag[1] === "general") &&
        status.tags.some((tag) => tag[0] === "emoji" && tag[1] === "focus")
      );
    })
    .toBe(true);
  await page.getByRole("button", { name: "Agents" }).click();
  const persistentAudienceSetting = page.getByRole("checkbox", {
    name: "Keep addressed agents active",
  });
  await persistentAudienceSetting.check();
  await expect
    .poll(() =>
      page.evaluate((pubkey) => {
        const key = Object.keys(localStorage).find(
          (candidate) =>
            candidate.startsWith("buzz-web:persistent-agent-audience.v1:") &&
            candidate.endsWith(`:${pubkey}`),
        );
        return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
      }, ownerPubkey),
    )
    .toMatchObject({ enabled: true });
  await page.getByRole("link", { name: "Channels" }).click();
  const persistentRootContent = "@Relay agent Persistent audience root";
  const channelComposer = page.getByLabel("Message #general");
  await channelComposer.fill(persistentRootContent);
  await channelComposer.press("Enter");
  await expect(channelComposer).toHaveValue("");
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 9 &&
          event.content === persistentRootContent &&
          event.tags.some((tag) => tag[0] === "p" && tag[1] === catalogPubkey),
      ),
    )
    .toBe(true);
  const persistentRootEvent = submittedEvents.find(
    (event) => event.kind === 9 && event.content === persistentRootContent,
  );
  expect(persistentRootEvent?.id).toMatch(/^[0-9a-f]{64}$/u);
  const persistentRootMessage = page.locator(
    `article[id="message-${persistentRootEvent?.id}"]`,
  );
  await expect(persistentRootMessage).toBeVisible();
  await persistentRootMessage.hover();
  await persistentRootMessage.getByRole("button", { name: "Reply" }).click();
  const persistentReplyComposer = page.getByLabel("Reply in thread");
  await expect(persistentReplyComposer).toHaveValue("@Relay agent ");
  await persistentReplyComposer.fill("@Relay agent First persistent reply");
  await persistentReplyComposer.press("Enter");
  await expect(persistentReplyComposer).toHaveValue("@Relay agent ");
  await persistentReplyComposer.fill("@Relay agent Second persistent reply");
  await persistentReplyComposer.press("Enter");
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 45003 &&
          event.content === "@Relay agent Second persistent reply" &&
          event.tags.some((tag) => tag[0] === "p" && tag[1] === catalogPubkey),
      ),
    )
    .toBe(true);
  await persistentReplyComposer.fill("Audience removed");
  await expect
    .poll(() =>
      page.evaluate(
        ({ pubkey, agentPubkey: expectedAgentPubkey }) => {
          const key = Object.keys(localStorage).find(
            (candidate) =>
              candidate.startsWith("buzz-web:persistent-agent-audience.v1:") &&
              candidate.endsWith(`:${pubkey}`),
          );
          if (!key) return false;
          const stored = JSON.parse(localStorage.getItem(key) ?? "null") as {
            audiences?: Record<string, Array<{ pubkey?: string }>>;
          } | null;
          return Object.values(stored?.audiences ?? {}).every((refs) =>
            refs.every((ref) => ref.pubkey !== expectedAgentPubkey),
          );
        },
        { pubkey: ownerPubkey, agentPubkey: catalogPubkey },
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Close thread" }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Agents" }).click();
  await persistentAudienceSetting.uncheck();
  await expect
    .poll(() =>
      page.evaluate((pubkey) => {
        const key = Object.keys(localStorage).find(
          (candidate) =>
            candidate.startsWith("buzz-web:persistent-agent-audience.v1:") &&
            candidate.endsWith(`:${pubkey}`),
        );
        if (!key) return null;
        const stored = JSON.parse(localStorage.getItem(key) ?? "null") as {
          enabled?: boolean;
          audiences?: Record<string, unknown>;
        } | null;
        return {
          enabled: stored?.enabled,
          audienceCount: Object.keys(stored?.audiences ?? {}).length,
        };
      }, ownerPubkey),
    )
    .toEqual({ enabled: false, audienceCount: 0 });
  const runtimePanel = page.getByRole("region", { name: "Agent runtimes" });
  await expect(runtimePanel).toBeVisible();
  await expect(
    runtimePanel.getByText("Buzz Agent", { exact: true }),
  ).toBeVisible();
  await expect(runtimePanel.getByText("Codex", { exact: true })).toBeVisible();
  await expect(
    runtimePanel.getByText("Claude Code", { exact: true }),
  ).toBeVisible();
  await expect(
    runtimePanel.getByText("Gemini ACP", { exact: true }),
  ).toBeVisible();
  await runtimePanel.getByRole("button", { name: "Check again" }).click();
  await expect(
    page.getByRole("heading", { name: "Agent defaults" }),
  ).toBeVisible();
  await page.getByLabel("Default model").fill("claude-sonnet-4-6");
  await page
    .getByLabel("Default Anthropic API key", { exact: true })
    .fill("encrypted-default-key");
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect
    .poll(() => {
      const defaults = submittedEvents.find(
        (event) =>
          event.kind === 30078 &&
          event.tags.some(
            (tag) => tag[0] === "d" && tag[1] === "buzz-web:agent-defaults:v1",
          ),
      );
      return (
        defaults?.tags.some(
          (tag) => tag[0] === "alt" && tag[1] === "encrypted agent defaults",
        ) === true &&
        !defaults.content.includes("encrypted-default-key") &&
        !defaults.content.includes("claude-sonnet-4-6")
      );
    })
    .toBe(true);
  await page.getByRole("button", { name: "Invites" }).click();
  await expect(
    page.getByRole("button", { name: "Invite to community" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Invite to community" }).click();
  await expect(
    page.getByRole("heading", { name: "Invite to community" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Custom emoji" }).click();
  await expect(
    page.getByRole("heading", { name: "Custom emoji" }),
  ).toBeVisible();
  await expect(page.getByText(":shipit:")).toBeVisible();
  await page.getByRole("button", { name: "Reminders" }).click();
  await expect(page.getByRole("heading", { name: "Reminders" })).toBeVisible();
  await expect(page.getByText("Follow up privately")).toBeVisible();
  await page.getByRole("button", { name: "Complete reminder" }).click();
  await expect
    .poll(() => {
      const reminders = submittedEvents.filter((event) => event.kind === 30300);
      return (
        reminders.length >= 2 &&
        reminders[0].tags.find((tag) => tag[0] === "d")?.[1] ===
          reminders.at(-1)?.tags.find((tag) => tag[0] === "d")?.[1] &&
        !reminders.at(-1)?.tags.some((tag) => tag[0] === "not_before") &&
        reminders.at(-1)?.tags.some((tag) => tag[0] === "expiration") ===
          true &&
        !reminders.at(-1)?.content.includes("Follow up privately")
      );
    })
    .toBe(true);
  await page.getByRole("button", { name: "Moderation" }).click();
  await expect(page.getByText("Repeated unsolicited promotion")).toBeVisible();
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 9044 &&
          event.tags.some(
            (tag) => tag[0] === "report" && tag[1] === "77".repeat(32),
          ) &&
          event.tags.some(
            (tag) => tag[0] === "status" && tag[1] === "dismissed",
          ),
      ),
    )
    .toBe(true);
  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText("Activity", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Contribution Activity" }),
  ).toBeVisible();
  await expect(page.getByTestId("projects-contribution-graph")).toBeVisible();
  await expect(page.getByText("Cross-project injection")).toHaveCount(0);
  await page.screenshot({ path: "/tmp/buzz-web-projects-overview.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/buzz-web-projects-overview-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByTestId("projects-create-menu").click();
  await expect(
    page.getByRole("menuitem", { name: "Repository" }),
  ).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Issue" })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Pull Request" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Issue" }).click();
  const globalIssueDialog = page.getByRole("dialog", { name: "New issue" });
  await expect(globalIssueDialog.getByLabel("Repository")).toHaveValue(
    `${catalogPubkey}:relay-project`,
  );
  await globalIssueDialog.getByLabel("Title").fill("Global project issue");
  await globalIssueDialog
    .getByLabel("Description")
    .fill("Created from the desktop-style project menu.");
  await globalIssueDialog.getByRole("button", { name: "Create issue" }).click();
  await expect(
    page.getByRole("heading", { name: "Global project issue" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByTestId("projects-create-menu").click();
  await page.getByRole("menuitem", { name: "Pull Request" }).click();
  const globalPullRequestDialog = page.getByRole("dialog", {
    name: "Open a pull request",
  });
  await expect(globalPullRequestDialog.getByLabel("Repository")).toHaveValue(
    `${catalogPubkey}:relay-project`,
  );
  await page.keyboard.press("Escape");
  await expect(globalPullRequestDialog).toBeHidden();
  await page.getByRole("button", { name: /^Pull Request/u }).click();
  await expect(
    page.getByRole("heading", { name: "Browser parity pull request" }),
  ).toBeVisible();
  await expect(page.getByText("Cross-project injection")).toHaveCount(0);
  await page.getByRole("button", { name: "Repositories" }).click();
  await expect(
    page.getByRole("heading", { name: "Relay project" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "1 commit, 1 pull request, 1 issue",
    }),
  ).toBeVisible();
  await page.getByTestId("projects-create-menu").click();
  await page.getByRole("menuitem", { name: "Repository" }).click();
  await page.getByLabel("Name").fill("Web parity");
  await page.getByLabel("Description").fill("Created from the browser");
  await page
    .getByLabel("Web URL (optional)")
    .fill("https://example.com/web-parity");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 30617 &&
          event.tags.some((tag) => tag[0] === "d" && tag[1] === "web-parity") &&
          event.tags.some(
            (tag) =>
              tag[0] === "web" && tag[1] === "https://example.com/web-parity",
          ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Delete Web parity" }).click();
  const deleteProjectDialog = page.getByRole("dialog", {
    name: "Delete project?",
  });
  await expect(deleteProjectDialog).toContainText(
    "Delete Web parity from Projects for everyone. This can only be done for projects you own and cannot be undone.",
  );
  await page.keyboard.press("Escape");
  await expect(deleteProjectDialog).toBeHidden();
  await page.getByRole("link", { name: "Relay project" }).click();
  await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open project web page" }),
  ).toHaveAttribute("href", "https://example.com/relay-project");
  await expect(
    page.getByRole("link", { name: "Open Discussion" }),
  ).toHaveAttribute(
    "href",
    "/channels?channel=44444444-4444-4444-8444-444444444444",
  );
  await expect(
    page.getByRole("button", { name: "Copy clone URL" }),
  ).toBeVisible();
  const projectOverviewRail = page.getByRole("complementary", {
    name: "Repository overview",
  });
  await expect(
    projectOverviewRail.getByRole("heading", { name: "People" }),
  ).toBeVisible();
  await expect(
    projectOverviewRail.getByRole("heading", { name: "Top Languages" }),
  ).toBeVisible();
  await expect(
    projectOverviewRail.getByRole("heading", { name: "Repository" }),
  ).toBeVisible();
  await expect(
    projectOverviewRail.getByText("Branch", { exact: true }).locator(".."),
  ).toContainText("main");
  await expect(
    projectOverviewRail.getByRole("button", { name: "View all" }),
  ).toBeVisible();
  await expect(page.getByText("Project created")).toBeHidden({
    timeout: 6_000,
  });
  await page.screenshot({ path: "/tmp/buzz-web-project-overview.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(projectOverviewRail).toBeVisible();
  await page.screenshot({ path: "/tmp/buzz-web-project-overview-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(
    page.getByRole("button", { name: "Files", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Commits", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Contributors", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("attacker-branch")).toHaveCount(0);
  const repositoryRef = page.getByLabel("Repository branch or tag");
  await expect(repositoryRef).toHaveValue("branch:main");
  await expect(repositoryRef.locator('option[value^="branch:"]')).toHaveCount(
    3,
  );
  await expect(
    repositoryRef.locator('option[value="branch:../escape"]'),
  ).toHaveCount(0);
  await expect(repositoryRef.locator('option[value="tag:v0.1.0"]')).toHaveCount(
    1,
  );
  await repositoryRef.selectOption("branch:feature/web-parity");
  await expect(
    page.getByRole("button", { name: "Delete branch" }),
  ).toBeDisabled();
  await repositoryRef.selectOption("branch:feature/create-pr");
  await page.getByRole("button", { name: "Delete branch" }).click();
  const deleteBranchDialog = page.getByRole("dialog", {
    name: "Delete branch?",
  });
  await expect(deleteBranchDialog).toContainText("feature/create-pr");
  await page.keyboard.press("Escape");
  await expect(deleteBranchDialog).toBeHidden();
  await repositoryRef.selectOption("tag:v0.1.0");
  await expect(page.getByRole("button", { name: "Create branch" })).toHaveCount(
    0,
  );
  await repositoryRef.selectOption("branch:main");
  await expect(
    page.getByRole("button", { name: "Delete branch" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Create branch" }).click();
  const createBranchDialog = page.getByRole("dialog", {
    name: "Create branch",
  });
  await createBranchDialog.getByLabel("Branch name").fill("../escape");
  await expect(
    createBranchDialog.getByText("Enter a valid Git branch name."),
  ).toBeVisible();
  await expect(
    createBranchDialog.getByRole("button", { name: "Create branch" }),
  ).toBeDisabled();
  await createBranchDialog.getByLabel("Branch name").fill("feature/safe");
  await createBranchDialog
    .getByRole("button", { name: "Create branch" })
    .click();
  await expect(
    createBranchDialog.getByText(
      'Remote did not reply using the "smart" HTTP protocol.',
      { exact: false },
    ),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(createBranchDialog).toBeHidden();
  await projectOverviewRail.getByRole("button", { name: "View all" }).click();
  await expect(
    page.getByText("Could not load git contributors."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Issues", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
  await page.getByRole("button", { name: "New issue" }).click();
  await page.getByLabel("Title").fill("Browser issue");
  await page
    .getByLabel("Description")
    .fill(
      "Track this from Buzz Web\n\n- [x] Render **Markdown** safely\n\n[Unsafe link](javascript:alert(1))",
    );
  await page.getByLabel("Labels").fill("browser");
  await page.getByRole("button", { name: "Create issue" }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 1621 &&
          event.tags.some(
            (tag) => tag[0] === "subject" && tag[1] === "Browser issue",
          ) &&
          event.tags.some((tag) => tag[0] === "t" && tag[1] === "browser"),
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Browser issue" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Browser issue" }).click();
  await expect(
    page.getByRole("button", { name: "Back to issues" }),
  ).toBeVisible();
  await expect(page.getByText("Track this from Buzz Web")).toBeVisible();
  await expect(
    page.locator("strong").filter({ hasText: "Markdown" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Unsafe link" })).toHaveCount(0);
  const issueMetaRail = page.getByRole("complementary", {
    name: "Issue metadata",
  });
  await expect(
    issueMetaRail.getByRole("heading", { name: "Status" }),
  ).toBeVisible();
  await expect(
    issueMetaRail.getByRole("heading", { name: "Author" }),
  ).toBeVisible();
  await expect(
    issueMetaRail.getByRole("heading", { name: "Labels" }),
  ).toBeVisible();
  await expect(
    issueMetaRail.getByRole("heading", { name: "Activity" }),
  ).toBeVisible();
  await expect(issueMetaRail.getByText("browser")).toBeVisible();
  await expect(
    issueMetaRail
      .getByLabel("Status for Browser issue")
      .locator("option:checked"),
  ).toHaveText("Backlog");
  await page
    .getByLabel("Add a comment...")
    .fill("Reviewed from the web issue view");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 1 &&
          event.content === "Reviewed from the web issue view" &&
          event.tags.some((tag) => tag[0] === "e" && tag[3] === "root") &&
          event.tags.some(
            (tag) =>
              tag[0] === "a" &&
              tag[1] === `30617:${catalogPubkey}:relay-project`,
          ),
      ),
    )
    .toBe(true);
  await expect(
    page
      .locator("article")
      .filter({ hasText: "Reviewed from the web issue view" }),
  ).toBeVisible();
  await expect(page.getByText("Comment posted")).toBeHidden({ timeout: 6_000 });
  await expect(page.getByText("Issue created")).toBeHidden({ timeout: 6_000 });
  await page.screenshot({ path: "/tmp/buzz-web-project-issue.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(issueMetaRail).toBeVisible();
  await page.screenshot({ path: "/tmp/buzz-web-project-issue-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Back to issues" }).click();
  await expect(page.getByText("1 comment", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Pull Request" }).click();
  await expect(
    page.getByRole("button", { name: "Browser parity pull request" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Browser parity pull request" })
      .locator("xpath=ancestor::article[1]"),
  ).toContainText("open");
  await page
    .getByRole("button", { name: "Browser parity pull request" })
    .click();
  await expect(
    page.getByRole("button", { name: "Back to pull requests" }),
  ).toBeVisible();
  const pullRequestMetaRail = page.getByRole("complementary", {
    name: "Pull request metadata",
  });
  await expect(
    pullRequestMetaRail.getByRole("heading", { name: "Status" }),
  ).toBeVisible();
  await expect(
    pullRequestMetaRail.getByRole("heading", { name: "Reviewers" }),
  ).toBeVisible();
  await expect(
    pullRequestMetaRail.getByRole("heading", { name: "Author" }),
  ).toBeVisible();
  await expect(
    pullRequestMetaRail.getByRole("heading", { name: "Branches" }),
  ).toBeVisible();
  await expect(
    pullRequestMetaRail.getByRole("heading", { name: "Activity" }),
  ).toBeVisible();
  await expect(
    pullRequestMetaRail.getByRole("button", { name: "Add reviewer" }),
  ).toHaveCount(0);
  await pullRequestMetaRail
    .getByRole("button", { name: "Open Relay agent profile" })
    .click();
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return {
        profile: url.searchParams.get("profile"),
        pullRequest: url.searchParams.get("pullRequest"),
      };
    })
    .toEqual({ profile: catalogPubkey, pullRequest: expect.any(String) });
  const projectProfile = page.getByRole("dialog", {
    name: "Relay agent profile",
  });
  await expect(projectProfile).toBeVisible();
  await expect(
    projectProfile.getByRole("button", { name: "Follow", exact: true }),
  ).toBeVisible();
  await expect(
    projectProfile.getByRole("button", { name: "Message", exact: true }),
  ).toBeVisible();
  await projectProfile.getByRole("button", { name: "Close" }).click();
  await page.goBack();
  await expect(projectProfile).toBeVisible();
  await page.goForward();
  await expect(projectProfile).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Back to pull requests" }),
  ).toBeVisible();
  await expect(page.getByText("feature/web-parity → main")).toBeVisible();
  const sourceChannelLink = page.getByRole("button", {
    name: "Open author-claimed source channel #general",
  });
  await expect(sourceChannelLink).toBeVisible();
  await expect(page.getByText("(author-claimed)")).toBeVisible();
  await expect(page.getByText("abababa", { exact: false })).toBeVisible();
  await expect(page.getByText("cdcdcdc", { exact: false })).toHaveCount(0);
  await expect(
    page.getByText("Review requested - no approvals yet."),
  ).toBeVisible();
  await expect(page.getByText("Forged approval claim")).toBeVisible();
  await expect(
    page.getByText("Use the shared browser helper here."),
  ).toBeVisible();
  await expect(page.getByText("Commented on src/browser.ts +12")).toBeVisible();
  await expect(page.getByText("Malicious inline location")).toBeVisible();
  await expect(page.getByText("Commented on ../secrets.txt")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Merge", exact: true }),
  ).toHaveCount(0);
  await page.getByText("Commented on src/browser.ts +12").click();
  await expect(
    page.getByText("Clone URL must use the active workspace relay."),
  ).toBeVisible();
  expect(externalGitRequests).toBe(0);
  await page.getByRole("button", { name: "Conversation" }).click();
  await expect(page.getByText("1 approval.")).toHaveCount(0);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  const approvePullRequestDialog = page.getByRole("dialog", {
    name: "Approve pull request",
  });
  await approvePullRequestDialog
    .getByLabel("Approval summary")
    .fill("Looks good from the web reviewer");
  await approvePullRequestDialog
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect(page.getByText("1 approval.")).toBeVisible();
  const trustedApproval = submittedEvents.find(
    (event) =>
      event.kind === 1 && event.content === "Looks good from the web reviewer",
  );
  expect(trustedApproval?.tags).toContainEqual(["t", "approval"]);
  expect(trustedApproval?.tags).toContainEqual(["c", "ab".repeat(20)]);
  await page
    .getByRole("button", { name: "Request changes", exact: true })
    .click();
  const requestChangesDialog = page.getByRole("dialog", {
    name: "Request changes",
  });
  await requestChangesDialog
    .getByLabel("Change request summary")
    .fill("Please add the missing browser coverage");
  await requestChangesDialog
    .getByRole("button", { name: "Request changes", exact: true })
    .click();
  await expect(page.getByText("1 reviewer requested changes.")).toBeVisible();
  const trustedChangeRequest = submittedEvents.find(
    (event) =>
      event.kind === 1 &&
      event.content === "Please add the missing browser coverage",
  );
  expect(trustedChangeRequest?.tags).toContainEqual(["t", "changes-requested"]);
  expect(trustedChangeRequest?.created_at).toBeGreaterThan(
    trustedApproval?.created_at ?? 0,
  );
  await page
    .getByLabel("Add a comment...")
    .fill("Reviewed the pull request from web");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 1 &&
          event.content === "Reviewed the pull request from web" &&
          event.tags.some((tag) => tag[0] === "e" && tag[3] === "root") &&
          event.tags.some(
            (tag) =>
              tag[0] === "a" &&
              tag[1] === `30617:${catalogPubkey}:relay-project`,
          ),
      ),
    )
    .toBe(true);
  await expect(
    page
      .locator("article")
      .filter({ hasText: "Reviewed the pull request from web" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show 3 earlier activities" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Commits 1" }).click();
  await expect(
    page
      .locator("article")
      .getByText("Browser parity pull request", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("abababa", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Checks" }).click();
  await expect(
    page.getByText("No checks have been reported for this pull request yet."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Conversation" }).click();
  await expect(page.getByText("Comment posted")).toBeHidden({ timeout: 6_000 });
  await page.screenshot({ path: "/tmp/buzz-web-project-pr.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Browser parity pull request" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(pullRequestMetaRail).toBeVisible();
  await page.screenshot({ path: "/tmp/buzz-web-project-pr-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Back to pull requests" }).click();
  await expect(
    page
      .getByRole("button", { name: "Browser parity pull request" })
      .locator("xpath=ancestor::article[1]"),
  ).toContainText("6");
  await page.getByRole("button", { name: "Open pull request" }).click();
  const createPullRequestDialog = page.getByRole("dialog", {
    name: "Open a pull request",
  });
  await expect(createPullRequestDialog).toBeVisible();
  await expect(createPullRequestDialog.getByLabel("Base")).toHaveValue("main");
  await expect(createPullRequestDialog.getByLabel("Compare")).toHaveValue(
    "feature/create-pr",
  );
  await expect(
    createPullRequestDialog.getByRole("option", { name: "attacker-branch" }),
  ).toHaveCount(0);
  await createPullRequestDialog.getByLabel("Title").fill("Create PR from web");
  await createPullRequestDialog
    .getByLabel("Description")
    .fill("Uses relay-verified branch state.");
  await page.screenshot({ path: "/tmp/buzz-web-create-pr.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/buzz-web-create-pr-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await createPullRequestDialog
    .getByRole("button", { name: "Open pull request" })
    .click();
  await expect
    .poll(() => {
      const pullRequest = submittedEvents.find(
        (event) =>
          event.kind === 1618 &&
          event.tags.some(
            (tag) => tag[0] === "subject" && tag[1] === "Create PR from web",
          ),
      );
      return (
        pullRequest?.content === "Uses relay-verified branch state." &&
        pullRequest.tags.some(
          (tag) =>
            tag[0] === "a" && tag[1] === `30617:${catalogPubkey}:relay-project`,
        ) &&
        pullRequest.tags.some(
          (tag) => tag[0] === "p" && tag[1] === catalogPubkey,
        ) &&
        pullRequest.tags.some(
          (tag) => tag[0] === "branch-name" && tag[1] === "feature/create-pr",
        ) &&
        pullRequest.tags.some(
          (tag) => tag[0] === "target-branch" && tag[1] === "main",
        ) &&
        pullRequest.tags.some(
          (tag) => tag[0] === "c" && tag[1] === "bc".repeat(20),
        ) &&
        pullRequest.tags.some((tag) => tag[0] === "clone" && tag.length > 1)
      );
    })
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "Create PR from web" }),
  ).toBeVisible();
  await expect(page.getByText("feature/create-pr → main")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Merge", exact: true }),
  ).toHaveCount(0);
  const createdPullRequest = submittedEvents.find(
    (event) =>
      event.kind === 1618 &&
      event.tags.some(
        (tag) => tag[0] === "subject" && tag[1] === "Create PR from web",
      ),
  );
  expect(createdPullRequest).toBeDefined();
  await expect(page.getByRole("button", { name: "Update PR" })).toBeVisible();
  await page.getByRole("button", { name: "Update PR" }).click();
  await expect
    .poll(() => {
      const update = submittedEvents.find(
        (event) =>
          event.kind === 1619 &&
          event.tags.some(
            (tag) => tag[0] === "E" && tag[1] === createdPullRequest?.id,
          ),
      );
      return Boolean(
        update?.tags.some((tag) => tag[0] === "P" && tag[1] === ownerPubkey) &&
          update.tags.some(
            (tag) => tag[0] === "c" && tag[1] === "bd".repeat(20),
          ) &&
          update.tags.some((tag) => tag[0] === "clone" && tag.length > 1),
      );
    })
    .toBe(true);
  await expect(
    page.getByText("feature/create-pr → main · bdbdbdb", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Commits 2" }).click();
  await expect(page.getByText("bcbcbcb", { exact: true })).toBeVisible();
  await expect(page.getByText("bdbdbdb", { exact: true })).toBeVisible();
  await expect(page.getByText("Updated pull request branch")).toBeVisible();
  await page.getByRole("button", { name: "Conversation" }).click();
  await expect(page.getByRole("heading", { name: "Updates" })).toBeVisible();
  await expect(page.getByText("Updated pull request branch")).toBeVisible();
  const createdStatus = page.getByLabel("Status for Create PR from web");
  await createdStatus.selectOption("draft");
  await expect(createdStatus).toHaveValue("draft");
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 1633 &&
          event.tags.some(
            (tag) => tag[0] === "e" && tag[1] === createdPullRequest?.id,
          ),
      ),
    )
    .toBe(true);
  const draftStatus = submittedEvents.find(
    (event) =>
      event.kind === 1633 &&
      event.tags.some(
        (tag) => tag[0] === "e" && tag[1] === createdPullRequest?.id,
      ),
  );
  await createdStatus.selectOption("open");
  await expect(createdStatus).toHaveValue("open");
  await expect
    .poll(() => {
      const openStatus = submittedEvents.find(
        (event) =>
          event.kind === 1630 &&
          event.tags.some(
            (tag) => tag[0] === "e" && tag[1] === createdPullRequest?.id,
          ),
      );
      return Boolean(
        openStatus &&
          draftStatus &&
          openStatus.created_at > draftStatus.created_at,
      );
    })
    .toBe(true);
  await page.getByRole("button", { name: "Add reviewer" }).click();
  const addReviewerDialog = page.getByRole("dialog", { name: "Add reviewer" });
  const agentReviewerLabel = `${agentPubkey.slice(0, 8)}…${agentPubkey.slice(-4)}`;
  await addReviewerDialog
    .getByText(agentReviewerLabel, { exact: true })
    .first()
    .locator("xpath=ancestor::button[1]")
    .click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 1 &&
          event.tags.some(
            (tag) => tag[0] === "e" && tag[1] === createdPullRequest?.id,
          ) &&
          event.tags.some((tag) => tag[0] === "p" && tag[1] === agentPubkey) &&
          event.tags.some(
            (tag) => tag[0] === "t" && tag[1] === "review-request",
          ),
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", {
      name: `Open ${agentReviewerLabel} profile`,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to pull requests" }).click();
  await page.getByRole("link", { name: "Workflows" }).click();
  await expect(page.getByRole("heading", { name: "Workflows" })).toBeVisible();
  await page.getByRole("button", { name: "Create workflow" }).click();
  await page.getByLabel("Workflow name").fill("Incoming webhook");
  await page.getByLabel("Workflow trigger").selectOption("webhook");
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByRole("button", { name: "Save workflow" }).click();
  await expect(
    page.getByRole("heading", { name: "Webhook ready" }),
  ).toBeVisible();
  await expect(page.getByText("webhook-test-secret")).toBeVisible();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 30620 &&
          event.content.includes("name: Incoming webhook") &&
          event.content.includes("on: webhook") &&
          event.tags.some(
            (tag) =>
              tag[0] === "h" &&
              tag[1] === "44444444-4444-4444-8444-444444444444",
          ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(
    page.getByRole("heading", { name: "Incoming webhook" }).first(),
  ).toBeVisible();
  const createdWorkflowId = submittedEvents
    .find((event) => event.kind === 30620)
    ?.tags.find((tag) => tag[0] === "d")?.[1];
  expect(createdWorkflowId).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`/workflows/${createdWorkflowId}$`));
  await page.getByRole("button", { name: "Close workflow details" }).click();
  await expect(page).toHaveURL(/\/workflows$/u);
  await page
    .getByRole("button", { name: /Incoming webhook/u })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/workflows/${createdWorkflowId}$`));
  const workflowDetail = page.getByTestId("workflow-detail-panel");
  await expect(workflowDetail).toContainText("active");
  await expect(workflowDetail).toContainText("Webhook");
  await expect(workflowDetail).toContainText("No runs yet.");
  await expect(workflowDetail).not.toContainText(
    "Run traces are not currently exposed by the relay.",
  );
  await page.screenshot({ path: "/tmp/buzz-web-workflow-detail.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(workflowDetail).toBeVisible();
  await page.screenshot({ path: "/tmp/buzz-web-workflow-detail-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Trigger workflow" }).first().click();
  await expect
    .poll(() => {
      const workflowId = submittedEvents
        .find((event) => event.kind === 30620)
        ?.tags.find((tag) => tag[0] === "d")?.[1];
      return submittedEvents.some(
        (event) =>
          event.kind === 46020 &&
          event.tags.some((tag) => tag[0] === "d" && tag[1] === workflowId),
      );
    })
    .toBe(true);
  await page.getByRole("button", { name: "Delete workflow" }).click();
  const deleteWorkflowDialog = page.getByRole("dialog", {
    name: "Delete workflow?",
  });
  await expect(deleteWorkflowDialog).toContainText(
    'Delete "Incoming webhook". This will stop all future triggers and remove the workflow permanently.',
  );
  await deleteWorkflowDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(deleteWorkflowDialog).toBeHidden();
  await page.getByRole("link", { name: "Pulse" }).click();
  await expect(page.getByRole("heading", { name: "Pulse" })).toBeVisible();
  await expect(page.getByText("Relay-native Pulse update")).toBeVisible();
  await expect(page.getByText("Forged relay frame")).toHaveCount(0);
  await page.getByLabel("Create Pulse note").fill("Published from Buzz Web");
  await page.getByLabel("Create Pulse note").press(`${shortcutModifier}+Enter`);
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 1 &&
          event.content === "Published from Buzz Web" &&
          !event.tags.some((tag) => tag[0] === "h"),
      ),
    )
    .toBe(true);
  const pulseNote = page
    .getByText("Relay-native Pulse update", { exact: true })
    .locator("xpath=ancestor::article[1]");
  await pulseNote
    .getByRole("button", { name: "Open profile for Relay agent" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/pulse\\?profile=${catalogPubkey}$`),
  );
  const pulseProfile = page.getByRole("dialog", {
    name: "Relay agent profile",
  });
  await expect(pulseProfile).toBeVisible();
  await pulseProfile.getByRole("button", { name: "Follow" }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 3 &&
          event.tags.some((tag) => tag[0] === "p" && tag[1] === catalogPubkey),
      ),
    )
    .toBe(true);
  await pulseProfile.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/\/pulse$/u);
  await page.goBack();
  await expect(pulseProfile).toBeVisible();
  await page.goForward();
  await expect(pulseProfile).toBeHidden();
  await pulseNote.getByRole("button", { name: "Like" }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 7 &&
          event.content === "+" &&
          event.tags.some(
            (tag) => tag[0] === "e" && /^[0-9a-f]{64}$/.test(tag[1] ?? ""),
          ),
      ),
    )
    .toBe(true);
  await pulseNote.getByRole("button", { name: "Reply" }).click();
  await pulseNote.getByLabel("Reply to Relay agent").fill("Web reply");
  await pulseNote.getByRole("button", { name: "Post reply" }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 1 &&
          event.content === "Web reply" &&
          event.tags.some(
            (tag) => tag[0] === "e" && /^[0-9a-f]{64}$/.test(tag[1] ?? ""),
          ) &&
          event.tags.some((tag) => tag[0] === "p"),
      ),
    )
    .toBe(true);
  await pulseNote.getByRole("button", { name: "Share" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^nostr:nevent/);
  await page.getByRole("tab", { name: "Following" }).click();
  await expect(page.getByText("Relay-native Pulse update")).toBeVisible();
  await page.getByRole("tab", { name: /Agents/ }).click();
  await expect(page.getByText("Relay-native Pulse update")).toBeVisible();
  await page.getByRole("link", { name: "Agents" }).click();
  await expect(
    page.getByRole("heading", { name: "Agents", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create persona" }).click();
  await page.getByRole("textbox", { name: "Persona name" }).fill("Review lead");
  await page
    .getByPlaceholder(
      "Describe the role, behavior, and boundaries for this persona.",
    )
    .fill("Review changes carefully and report risks.");
  await page.getByLabel("Harness", { exact: true }).selectOption("buzz-agent");
  await page.getByLabel("Model", { exact: true }).fill("claude-sonnet-4-6");
  await page.getByRole("button", { name: "Save persona" }).click();
  await expect
    .poll(() => {
      const persona = submittedEvents.find((event) => event.kind === 30175);
      return (
        persona?.tags.some(
          (tag) => tag[0] === "d" && /^[0-9a-f]{32}$/.test(tag[1] ?? ""),
        ) === true &&
        persona.tags.some(
          (tag) => tag[0] === "alt" && tag[1] === "agent persona definition",
        ) &&
        !persona.tags.some((tag) => tag[0] === "shared") &&
        persona.content.includes("Review changes carefully") &&
        !persona.content.includes("API_KEY")
      );
    })
    .toBe(true);
  await expect(page.getByText("Review lead")).toBeVisible();
  await page.getByRole("button", { name: "Export Review lead" }).click();
  const snapshotDownload = page.waitForEvent("download");
  await page
    .getByRole("dialog", { name: "Export Review lead" })
    .getByRole("button", { name: "Export" })
    .click();
  const downloadedSnapshot = await snapshotDownload;
  const snapshotBytes = await downloadedBytes(downloadedSnapshot);
  expect(snapshotBytes.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(snapshotBytes.includes(Buffer.from("test-persona-api-key"))).toBe(
    false,
  );
  await page.getByLabel("Import agent snapshot file").setInputFiles({
    name: "review-lead.agent.png",
    mimeType: "image/png",
    buffer: snapshotBytes,
  });
  await expect(
    page.getByRole("dialog", { name: "Import agent snapshot" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "Import agent snapshot" })
      .getByText("Review lead"),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Import agent snapshot" })
    .getByRole("button", { name: "Close" })
    .click();

  const craftedSnapshot = Buffer.from(
    JSON.stringify({
      format: "buzz-agent-snapshot",
      version: 1,
      definition: {
        name: "Snapshot auditor",
        systemPrompt: "Inspect imported changes.",
        runtime: "buzz-agent",
        model: "claude-sonnet-4-6",
        provider: "anthropic",
        respondTo: "allowlist",
        respondToAllowlist: ["aa".repeat(32)],
        envVars: { OPENAI_API_KEY: "snapshot-secret" },
        privateKeyNsec: "nsec1snapshot-secret",
      },
      profile: { displayName: "Snapshot auditor" },
      memory: {
        level: "core",
        entries: [{ slug: "core", body: "Remember imported reviews." }],
      },
    }),
  );
  await page.getByLabel("Import agent snapshot file").setInputFiles({
    name: "snapshot-auditor.agent.json",
    mimeType: "application/json",
    buffer: craftedSnapshot,
  });
  await page
    .getByRole("dialog", { name: "Import agent snapshot" })
    .getByRole("button", { name: "Import" })
    .click();
  await expect
    .poll(() => {
      const imported = submittedEvents.find(
        (event) =>
          event.kind === 30175 &&
          event.content.includes('"display_name":"Snapshot auditor"'),
      );
      return (
        imported?.content.includes('"respond_to":"owner-only"') === true &&
        !imported.content.includes("respond_to_allowlist") &&
        !imported.content.includes("snapshot-secret") &&
        !imported.content.includes("privateKeyNsec")
      );
    })
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "Deploy persona" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Anthropic API key", { exact: true }),
  ).toHaveValue("encrypted-default-key");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect.poll(() => managedAgents.length).toBe(1);
  await expect
    .poll(() => restoredMemory)
    .toEqual([{ slug: "core", body: "Remember imported reviews." }]);
  expect(createdAgentInputs[0]?.start_immediately).toBe(false);
  const stoppedAgentCard = page.locator("article").filter({
    hasText: "Snapshot auditor",
  });
  await stoppedAgentCard
    .getByRole("button", { name: "Snapshot auditor actions" })
    .click();
  await stoppedAgentCard.getByRole("button", { name: "Stop agent" }).click();
  await stoppedAgentCard
    .getByRole("button", { name: "Snapshot auditor actions" })
    .click();
  await stoppedAgentCard.getByRole("button", { name: "Delete agent" }).click();
  const deleteAgentDialog = page.getByRole("dialog", {
    name: "Delete this agent?",
  });
  await expect(deleteAgentDialog).toContainText(
    "Deleting this agent removes the hosted agent from this community.",
  );
  await expect(deleteAgentDialog).toContainText(
    "Removes its management record and encrypted credentials",
  );
  await page.keyboard.press("Escape");
  await expect(deleteAgentDialog).toBeHidden();
  await stoppedAgentCard
    .getByRole("button", { name: "Snapshot auditor agent profile" })
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("profile"))
    .toBe(agentPubkey);
  const agentProfile = page.getByRole("dialog", {
    name: "Snapshot auditor profile",
  });
  await expect(agentProfile).toBeVisible();
  for (const action of ["Follow", "Message", "Edit", "Start"]) {
    await expect(
      agentProfile.getByRole("button", { name: action, exact: true }),
    ).toBeVisible();
  }
  await expect(agentProfile.getByRole("tab", { name: "Info" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await agentProfile.getByRole("tab", { name: "Runtime" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("profileTab"))
    .toBe("runtime");
  await expect(
    agentProfile.getByRole("tab", { name: "Runtime" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(agentProfile.getByText("Buzz Agent")).toBeVisible();
  await expect(agentProfile.getByText("Only the owner")).toBeVisible();
  await page.screenshot({ path: "/tmp/buzz-web-agent-profile-runtime.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/buzz-web-agent-profile-runtime-mobile.png",
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goBack();
  await expect(agentProfile.getByRole("tab", { name: "Info" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.goForward();
  await expect(
    agentProfile.getByRole("tab", { name: "Runtime" }),
  ).toHaveAttribute("aria-selected", "true");
  await agentProfile.getByRole("button", { name: "Instructions" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("profileView"))
    .toBe("instructions");
  await expect(
    agentProfile.getByText("Inspect imported changes."),
  ).toBeVisible();
  await agentProfile.getByRole("button", { name: "Back to profile" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.has("profileView"))
    .toBe(false);
  await expect(
    agentProfile.getByRole("tab", { name: "Runtime" }),
  ).toHaveAttribute("aria-selected", "true");
  await agentProfile.getByRole("button", { name: "Harness Log" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("profileView"))
    .toBe("diagnostics");
  await expect(agentProfile.getByText("ACP session ready")).toBeVisible();
  await expect(
    agentProfile.getByText("Older output was discarded"),
  ).toBeVisible();
  await agentProfile.getByRole("button", { name: "Back to profile" }).click();
  await agentProfile.getByRole("tab", { name: "Channels" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("profileTab"))
    .toBe("channels");
  await expect(
    agentProfile.getByRole("button", { name: "Add to channel" }),
  ).toBeVisible();
  await agentProfile.getByRole("tab", { name: "Memories" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("profileTab"))
    .toBe("memories");
  await expect(
    agentProfile.getByText("Review carefully and preserve user intent."),
  ).toBeVisible();
  await agentProfile.getByRole("tab", { name: "Info" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.has("profileTab"))
    .toBe(false);
  await agentProfile.getByRole("button", { name: "Close" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.has("profile"))
    .toBe(false);
  await page.goBack();
  await expect(agentProfile).toBeVisible();
  await page.goForward();
  await expect(agentProfile).toBeHidden();
  await page.getByRole("link", { name: "Projects" }).click({ timeout: 10_000 });
  await page
    .getByRole("link", { name: "Relay project" })
    .click({ timeout: 10_000 });
  await page
    .getByRole("button", { name: /^Pull Request/u })
    .click({ timeout: 10_000 });
  await page
    .getByRole("button", { name: "Create PR from web" })
    .click({ timeout: 10_000 });
  await page
    .getByRole("button", { name: `Open ${agentReviewerLabel} profile` })
    .click();
  const projectManagedProfile = page.getByRole("dialog", {
    name: "Snapshot auditor profile",
  });
  await expect(
    projectManagedProfile.getByRole("tab", { name: "Memories" }),
  ).toBeVisible();
  await projectManagedProfile.getByRole("tab", { name: "Runtime" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("profileTab"))
    .toBe("runtime");
  expect(new URL(page.url()).searchParams.get("pullRequest")).toBe(
    createdPullRequest?.id,
  );
  await expect(
    projectManagedProfile.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  await projectManagedProfile
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  const projectAgentEdit = page.getByRole("dialog", { name: "Edit agent" });
  await expect(projectAgentEdit.locator("textarea")).toHaveValue(
    "Inspect imported changes.",
  );
  await projectAgentEdit.getByRole("button", { name: "Close" }).click();
  await projectManagedProfile.getByRole("button", { name: "Close" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.has("profileTab"))
    .toBe(false);
  await page.getByRole("link", { name: "Agents" }).click();
  await page.getByRole("button", { name: "Agent catalog" }).click();
  await expect(
    page.getByRole("heading", { name: "Agent catalog" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Community reviewer" }),
  ).toBeVisible();
  await expect(
    page.getByText("Audit changes from the community catalog."),
  ).toBeVisible();
  await expect(page.getByText("Tracking pixel")).toBeVisible();
  await expect(page.getByRole("link", { name: "Documentation" })).toHaveCount(
    0,
  );
  expect(catalogImageRequests).toBe(0);
  await page.getByRole("button", { name: "Add to My Agents" }).click();
  await expect
    .poll(() => {
      const imported = submittedEvents.find(
        (event) =>
          event.kind === 30175 &&
          event.pubkey === ownerPubkey &&
          event.content.includes('"display_name":"Community reviewer"'),
      );
      return (
        imported?.tags.some(
          (tag) =>
            tag[0] === "a" &&
            tag[1] === `30175:${catalogPubkey}:community-reviewer`,
        ) === true &&
        imported.content.includes('"respond_to":"owner-only"') &&
        !imported.content.includes("respond_to_allowlist") &&
        !imported.tags.some((tag) => tag[0] === "shared")
      );
    })
    .toBe(true);
  await expect(page.getByRole("button", { name: "Added" })).toBeDisabled();
  await page
    .getByRole("dialog", { name: "Agent catalog" })
    .getByRole("button", { name: "Close" })
    .click();
  await page.getByRole("button", { name: "Deploy Review lead" }).click();
  await expect(
    page.getByRole("heading", { name: "Deploy persona" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Anthropic API key", { exact: true }),
  ).toHaveValue("encrypted-default-key");
  await page
    .getByLabel("Anthropic API key", { exact: true })
    .fill("test-persona-api-key");
  await page.getByRole("button", { name: "Advanced" }).click();
  await page.getByLabel("Agent runtime args").fill("serve, --quiet");
  await page.getByLabel("Parallelism").fill("3");
  await page.getByLabel("Idle timeout seconds").fill("900");
  await page.getByLabel("Maximum turn duration seconds").fill("7200");
  await page.getByLabel("Thinking effort").selectOption("high");
  await page.getByLabel("Max rounds").fill("8");
  await page.getByLabel("Max output tokens").fill("8192");
  await page.getByLabel("Context limit").fill("200000");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect.poll(() => managedAgents.length).toBe(2);
  expect(createdAgentInputs[1]).toMatchObject({
    provider: "anthropic",
    agent_args: ["serve", "--quiet"],
    parallelism: 3,
    idle_timeout_seconds: 900,
    max_turn_duration_seconds: 7200,
    runtime_config: {
      thinking_effort: "high",
      max_rounds: "8",
      max_output_tokens: "8192",
      max_context_tokens: "200000",
    },
  });
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("textbox", { name: "Team name" }).fill("Review crew");
  await page.getByRole("checkbox", { name: /Review lead/ }).check();
  await page.getByRole("button", { name: "Save team" }).click();
  await expect
    .poll(() => {
      const team = submittedEvents.find((event) => event.kind === 30176);
      return (
        team?.tags.some(
          (tag) => tag[0] === "alt" && tag[1] === "agent team definition",
        ) === true &&
        team.content.includes('"name":"Review crew"') &&
        team.content.includes('"persona_ids"') &&
        !team.content.includes("test-persona-api-key")
      );
    })
    .toBe(true);
  await expect(page.getByText("Review crew")).toBeVisible();
  await page.getByRole("button", { name: "Delete Review crew" }).click();
  const deleteTeamDialog = page.getByRole("dialog", { name: "Delete team?" });
  await expect(deleteTeamDialog).toContainText(
    'Delete "Review crew". Already-deployed agents are not affected, but this team template will no longer be available.',
  );
  await deleteTeamDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(deleteTeamDialog).toBeHidden();
  await page.getByRole("button", { name: "Deploy Review crew" }).click();
  await expect(
    page.getByLabel("Anthropic API key", { exact: true }),
  ).toHaveValue("encrypted-default-key");
  await page
    .getByLabel("Anthropic API key", { exact: true })
    .fill("team-api-key");
  await page.getByRole("button", { name: "Deploy team", exact: true }).click();
  await expect.poll(() => managedAgents.length).toBe(3);
  await page.getByRole("button", { name: "Export Review crew" }).click();
  const teamExportDialog = page.getByRole("dialog", {
    name: "Export Review crew",
  });
  await teamExportDialog.getByLabel("Memories").selectOption("everything");
  await teamExportDialog.getByLabel("File format").selectOption("json");
  await expect(teamExportDialog.getByText("1 of 1 members")).toBeVisible();
  const teamDownload = page.waitForEvent("download");
  await teamExportDialog.getByRole("button", { name: "Export" }).click();
  const exportedTeam = JSON.parse(
    (await downloadedBytes(await teamDownload)).toString("utf8"),
  ) as {
    format: string;
    version: number;
    team: { name: string };
    members: Array<{
      definition: Record<string, unknown>;
      profile: Record<string, unknown>;
      memory: {
        level: string;
        entries: Array<{ slug: string; body: string }>;
      };
    }>;
  };
  expect(exportedTeam).toMatchObject({
    format: "buzz-team-snapshot",
    version: 1,
    team: { name: "Review crew" },
    members: [
      {
        profile: { displayName: "Review lead" },
        memory: {
          level: "everything",
          entries: [
            {
              slug: "core",
              body: "Review carefully and preserve user intent.",
            },
          ],
        },
      },
    ],
  });
  expect(JSON.stringify(exportedTeam)).not.toMatch(
    /team-api-key|persona_id|agent_pubkey|private_key|credential_mode/u,
  );
  exportedTeam.team.name = "Portable crew";
  exportedTeam.members[0].definition.name = "Portable reviewer";
  exportedTeam.members[0].definition.respondTo = "allowlist";
  exportedTeam.members[0].definition.respondToAllowlist = ["bb".repeat(32)];
  exportedTeam.members[0].definition.privateKeyNsec = "nsec1must-not-import";
  exportedTeam.members[0].profile.displayName = "Portable reviewer";
  await page.getByLabel("Import team snapshot file").setInputFiles({
    name: "portable-crew.team.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exportedTeam)),
  });
  const teamImportDialog = page.getByRole("dialog", {
    name: "Import team snapshot",
  });
  await expect(teamImportDialog.getByText("Portable crew")).toBeVisible();
  await expect(
    teamImportDialog.getByText("1 plaintext memory entry", { exact: false }),
  ).toBeVisible();
  await teamImportDialog.getByRole("button", { name: "Import" }).click();
  await expect(
    page.getByRole("heading", { name: "Deploy Portable crew" }),
  ).toBeVisible();
  await expect
    .poll(() => {
      const imported = submittedEvents.find(
        (event) =>
          event.kind === 30175 &&
          event.content.includes('"display_name":"Portable reviewer"'),
      );
      return (
        imported?.content.includes('"respond_to":"owner-only"') === true &&
        !imported.content.includes("respond_to_allowlist") &&
        !imported.content.includes("must-not-import")
      );
    })
    .toBe(true);
  await page
    .getByLabel("Anthropic API key", { exact: true })
    .fill("portable-team-api-key");
  await page.getByRole("button", { name: "Deploy team", exact: true }).click();
  await expect.poll(() => managedAgents.length).toBe(4);
  await expect
    .poll(() => restoredMemory)
    .toEqual([
      { slug: "core", body: "Remember imported reviews." },
      { slug: "core", body: "Review carefully and preserve user intent." },
    ]);
  const reviewAgentCard = page
    .locator("article")
    .filter({
      hasText: "Review lead",
    })
    .first();
  await reviewAgentCard
    .getByRole("button", { name: "Review lead actions" })
    .click();
  await reviewAgentCard.getByRole("button", { name: "View memory" }).click();
  await expect(
    page.getByRole("heading", { name: "Review lead memory" }),
  ).toBeVisible();
  await expect(
    page.getByText("Review carefully and preserve user intent."),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Review lead memory" })
    .getByRole("button", { name: "Close" })
    .click();
  await reviewAgentCard
    .getByRole("button", { name: "Review lead actions" })
    .click();
  await reviewAgentCard
    .getByRole("button", { name: "Export snapshot" })
    .click();
  const deployedExport = page.getByRole("dialog", {
    name: "Export Review lead",
  });
  await deployedExport.getByLabel("File format").selectOption("json");
  await deployedExport
    .getByLabel("Memory to include")
    .selectOption("everything");
  await expect(
    deployedExport.getByText("stored as plaintext", { exact: false }),
  ).toBeVisible();
  const deployedDownload = page.waitForEvent("download");
  await deployedExport.getByRole("button", { name: "Export" }).click();
  const deployedSnapshot = JSON.parse(
    (await downloadedBytes(await deployedDownload)).toString("utf8"),
  ) as Record<string, unknown>;
  expect(deployedSnapshot).toMatchObject({
    format: "buzz-agent-snapshot",
    version: 1,
    definition: {
      name: "Review lead",
      systemPrompt: "Review changes carefully and report risks.",
      runtime: "buzz-agent",
      model: "claude-sonnet-4-6",
    },
    profile: { displayName: "Review lead" },
    memory: {
      level: "everything",
      entries: [
        {
          slug: "core",
          body: "Review carefully and preserve user intent.",
        },
      ],
    },
  });
  expect(JSON.stringify(deployedSnapshot)).not.toMatch(
    /test-persona-api-key|private_key|agent_pubkey|credential_mode/u,
  );
  await reviewAgentCard
    .getByRole("button", { name: "Review lead actions" })
    .click();
  await reviewAgentCard.getByRole("button", { name: "View activity" }).click();
  await expect(
    page.getByRole("heading", { name: "Review lead activity" }),
  ).toBeVisible();
  const activityTranscript = page.getByRole("log", {
    name: "Live ACP transcript",
  });
  await expect(page.getByText("#1 tools/call", { exact: true })).toBeVisible();
  await expect(
    activityTranscript.getByText("Review in progress.", { exact: true }),
  ).toBeVisible();
  await expect(
    activityTranscript.getByText("Inspect repository"),
  ).toBeVisible();
  await expect(
    activityTranscript.getByText("Ran command", { exact: true }),
  ).toBeVisible();
  await expect(
    activityTranscript.getByText("pwd", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel active turn" }).click();
  await expect
    .poll(() => {
      const control = submittedEvents.find(
        (event) =>
          event.kind === 24200 &&
          event.tags.some((tag) => tag[0] === "frame" && tag[1] === "control"),
      );
      return (
        control?.tags.some(
          (tag) => tag[0] === "p" && tag[1] === agentPubkey,
        ) === true &&
        control.tags.some(
          (tag) =>
            tag[0] === "h" && tag[1] === "44444444-4444-4444-8444-444444444444",
        ) &&
        !control.content.includes("cancel_turn") &&
        !control.content.includes("44444444-4444-4444-8444-444444444444")
      );
    })
    .toBe(true);
  await page
    .getByRole("dialog", { name: "Review lead activity" })
    .getByRole("button", { name: "Close" })
    .click();
  await reviewAgentCard
    .getByRole("button", { name: "Review lead actions" })
    .click();
  await reviewAgentCard.getByRole("button", { name: "Harness log" }).click();
  await expect(
    page.getByRole("heading", { name: "Review lead harness log" }),
  ).toBeVisible();
  await expect(page.getByText("ACP session ready")).toBeVisible();
  await expect(page.getByText("Older output was discarded")).toBeVisible();
  await page
    .getByRole("dialog", { name: "Review lead harness log" })
    .getByRole("button", { name: "Close" })
    .click();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Templates" }).click();
  await expect(
    page.getByRole("heading", { name: "Channel templates" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Review room");
  await page.getByLabel("Description (optional)").fill("Review work together");
  await page
    .getByLabel("Canvas template (optional)")
    .fill("# {channel.name}\n\nCreated from {template.name}");
  await page.getByRole("checkbox", { name: "Review lead" }).check();
  await page.getByRole("checkbox", { name: "Review crew" }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => {
      const template = submittedEvents.find(
        (event) =>
          event.kind === 30078 &&
          event.tags.some(
            (tag) =>
              tag[0] === "d" &&
              /^buzz-web:channel-template:[0-9a-f]{32}$/.test(tag[1] ?? ""),
          ),
      );
      return (
        template?.tags.some(
          (tag) =>
            tag[0] === "d" &&
            /^buzz-web:channel-template:[0-9a-f]{32}$/.test(tag[1] ?? ""),
        ) === true &&
        !template.content.includes("Review room") &&
        !template.content.includes("Review changes carefully") &&
        !template.content.includes("{channel.name}")
      );
    })
    .toBe(true);
  await page.getByRole("button", { name: "Delete Review room" }).click();
  const deleteTemplateDialog = page.getByRole("dialog", {
    name: "Delete template",
  });
  await expect(deleteTemplateDialog).toContainText(
    'Are you sure you want to delete "Review room"? This action cannot be undone.',
  );
  await page.keyboard.press("Escape");
  await expect(deleteTemplateDialog).toBeHidden();
  await page.getByRole("link", { name: "Channels" }).click();
  await expect(page.getByRole("heading", { name: "general" })).toBeVisible();
  await page.getByRole("button", { name: "Create channel" }).click();
  await page.getByLabel("Channel name").fill("release-review");
  await page.getByLabel("Template").selectOption({ label: "Review room" });
  await page
    .getByRole("dialog", { name: "Create channel" })
    .getByRole("button", { name: "Create channel" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Finish template setup" }),
  ).toBeVisible();
  await page
    .getByLabel("Anthropic API key", { exact: true })
    .fill("template-api-key");
  await page.getByRole("button", { name: "Add agents" }).click();
  await expect.poll(() => managedAgents.length).toBe(5);
  await expect
    .poll(() => {
      const canvas = submittedEvents.find(
        (event) =>
          event.kind === 40100 &&
          event.content === "# release-review\n\nCreated from Review room",
      );
      return (
        Boolean(canvas) &&
        submittedEvents.some(
          (event) =>
            event.kind === 9000 &&
            event.tags.some(
              (tag) => tag[0] === "p" && tag[1] === agentPubkey,
            ) &&
            event.tags.some((tag) => tag[0] === "role" && tag[1] === "bot"),
        ) &&
        !submittedEvents.some((event) =>
          event.content.includes("template-api-key"),
        )
      );
    })
    .toBe(true);

  await page.getByRole("link", { name: "Agents" }).click();
  await page.getByRole("button", { name: "New agent" }).click();
  const customAgentDialog = page.getByRole("dialog", { name: "Create agent" });
  await customAgentDialog
    .getByText("Agent name", { exact: true })
    .locator("..")
    .getByRole("textbox")
    .fill("Gemini reviewer");
  await customAgentDialog
    .getByText("Harness", { exact: true })
    .locator("..")
    .getByRole("combobox")
    .selectOption("gemini");
  const geminiApiKey = customAgentDialog.getByRole("textbox", {
    name: "Gemini API key",
  });
  await expect(geminiApiKey).toBeVisible();
  await expect(customAgentDialog.getByLabel("Agent runtime args")).toHaveCount(
    0,
  );
  await geminiApiKey.fill("gemini-test-key");
  await customAgentDialog
    .getByPlaceholder("Choose a model")
    .fill("gemini-2.5-pro");
  await customAgentDialog.getByRole("button", { name: "Create agent" }).click();
  await expect.poll(() => managedAgents.length).toBe(6);
  expect(createdAgentInputs[5]).toMatchObject({
    name: "Gemini reviewer",
    runtime: "gemini",
    model: "gemini-2.5-pro",
    credential_mode: "api-key",
    agent_args: [],
    secrets: { GEMINI_API_KEY: "gemini-test-key" },
  });
  const personasSection = page
    .getByRole("heading", { name: "Personas" })
    .locator("xpath=ancestor::section[1]");
  const snapshotPersona = personasSection.locator("article").filter({
    hasText: "Snapshot auditor",
  });
  await snapshotPersona
    .getByRole("button", { name: "Delete Snapshot auditor" })
    .click();
  const deletePersonaDialog = page.getByRole("dialog", {
    name: "Delete agent?",
  });
  await expect(deletePersonaDialog).toContainText(
    "Also deletes 1 hosted agent instance and removes its relay membership",
  );
  await deletePersonaDialog.getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => managedAgents.length).toBe(5);
  await expect
    .poll(() => {
      const personaId = submittedEvents
        .find(
          (event) =>
            event.kind === 30175 &&
            event.content.includes('"display_name":"Snapshot auditor"'),
        )
        ?.tags.find((tag) => tag[0] === "d")?.[1];
      return submittedEvents.some(
        (event) =>
          event.kind === 5 &&
          event.tags.some(
            (tag) =>
              tag[0] === "a" && tag[1] === `30175:${ownerPubkey}:${personaId}`,
          ),
      );
    })
    .toBe(true);
  const managedAgentMessage = finalizeEvent(
    {
      kind: 9,
      created_at: Math.floor(Date.now() / 1_000),
      content: "Managed agent message",
      tags: [["h", "44444444-4444-4444-8444-444444444444"]],
    },
    agentSecret,
  );
  submittedEvents.push(managedAgentMessage);
  await page.getByRole("link", { name: "Channels" }).click();
  await expect(page.getByRole("heading", { name: "general" })).toBeVisible();
  const managedAgentArticle = page.locator(
    `article[id="message-${managedAgentMessage.id}"]`,
  );
  await expect(managedAgentArticle).toBeVisible();
  await managedAgentArticle.hover();
  await expect(
    managedAgentArticle.getByRole("button", { name: "Delete message" }),
  ).toBeVisible();
  await managedAgentArticle
    .getByRole("button", { name: "Edit message" })
    .click();
  const managedAgentEditComposer = page.getByRole("textbox", {
    name: "Edit message",
    exact: true,
  });
  await expect(managedAgentEditComposer).toHaveValue("Managed agent message");
  await managedAgentEditComposer.fill("Owner corrected managed agent message");
  await expect(managedAgentEditComposer).toHaveValue(
    "Owner corrected managed agent message",
  );
  await page.getByRole("button", { name: "Save edit" }).click();
  await expect
    .poll(() =>
      submittedEvents.find(
        (event) =>
          event.kind === 40003 &&
          event.tags.some(
            (tag) => tag[0] === "e" && tag[1] === managedAgentMessage.id,
          ),
      ),
    )
    .toMatchObject({
      content: "Owner corrected managed agent message",
      pubkey: ownerPubkey,
    });
  await expect(managedAgentArticle).toContainText(
    "Owner corrected managed agent message",
  );

  const { credentials } = await cdp.send("WebAuthn.getCredentials", {
    authenticatorId,
  });
  const primaryCredential = credentials.find((credential) =>
    Buffer.from(credential.credentialId, "base64url").equals(
      Buffer.from(claimedCredential?.credential_id ?? "", "base64url"),
    ),
  );
  expect(primaryCredential).toBeTruthy();
  await cdp.send("WebAuthn.removeCredential", {
    authenticatorId,
    credentialId: primaryCredential?.credentialId ?? "",
  });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Unlock with passkey" }).click();
  await expect(page.getByRole("heading", { name: "general" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.goto(`${testOrigin}/`);
  await page.getByRole("button", { name: "Unlock with passkey" }).click();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(
    page.getByText("Owner mention from inbox").first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Back" })).toBeHidden();
  await page.getByText("Owner mention from inbox").first().click();
  await expect(page).toHaveURL(/\?item=[0-9a-f]{64}$/u);
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await expect(page.getByText("Owner mention from inbox").last()).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/\?item=/u);
  await expect(page.getByRole("button", { name: "Back" })).toBeHidden();
  await page.goForward();
  await expect(page).toHaveURL(/\?item=[0-9a-f]{64}$/u);
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/buzz-web-inbox-mobile.png" });
});

test("existing owner enrolls from an encrypted NIP-49 backup", async ({
  page,
}) => {
  test.setTimeout(45_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  });

  const token = "84".repeat(32);
  const password = "desktop backup password";
  const ownerSecret = new Uint8Array(32);
  ownerSecret[31] = 9;
  const expectedOwnerPubkey = getPublicKey(ownerSecret);
  const encryptedBackup = encryptNip49(ownerSecret, password);
  ownerSecret.fill(0);

  await page.route("**/api/owner/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        claimed: false,
        vault_ready: false,
        owner_pubkey: expectedOwnerPubkey,
        claim_enabled: true,
      }),
    });
  });
  await page.route("**/api/owner/claim", async (route) => {
    const request = route.request();
    const body = request.postData() ?? "";
    expect(body).not.toContain(encryptedBackup);
    expect(body).not.toContain(password);
    const authorization = request.headers().authorization ?? "";
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(expectedOwnerPubkey);
    expect(event.tags).toContainEqual([
      "payload",
      createHash("sha256").update(body).digest("hex"),
    ]);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ owner_pubkey: expectedOwnerPubkey }),
    });
  });

  await page.goto(`${testOrigin}/agents/setup#${token}`);
  await page.getByLabel("Existing owner key").fill(encryptedBackup);
  await page.getByLabel("Backup password").fill(password);
  await page.getByRole("button", { name: "Create owner passkey" }).click();
  await expect(
    page.getByRole("heading", { name: "Owner passkey created" }),
  ).toBeVisible();
});

test("invite requires age and legal consent before opening Buzz", async ({
  page,
}) => {
  await page.route("**/api/join-policy", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        policy: {
          terms_markdown: "# Terms",
          privacy_markdown: "# Privacy",
          age_attestation_required: true,
          version: "policy-v1",
        },
      }),
    });
  });
  await page.route("https://api.github.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify([
        { draft: false, prerelease: false, assets: [] },
        {
          draft: false,
          prerelease: false,
          assets: [
            {
              name: "Buzz_0.4.9_aarch64.dmg",
              browser_download_url:
                "https://github.com/block/buzz/releases/download/v0.4.9/Buzz_0.4.9_aarch64.dmg",
            },
            {
              name: "Buzz_0.4.9_x64.dmg",
              browser_download_url:
                "https://github.com/block/buzz/releases/download/v0.4.9/Buzz_0.4.9_x64.dmg",
            },
            {
              name: "Buzz_0.4.9_amd64.AppImage",
              browser_download_url:
                "https://github.com/block/buzz/releases/download/v0.4.9/Buzz_0.4.9_amd64.AppImage",
            },
            {
              name: "Buzz_0.4.9_x64-setup_alpha-unsigned.exe",
              browser_download_url:
                "https://github.com/block/buzz/releases/download/v0.4.9/Buzz_0.4.9_x64-setup_alpha-unsigned.exe",
            },
          ],
        },
      ]),
    });
  });
  await page.goto("/invite/demo-code");

  await expect(
    page.getByRole("link", { name: "Download it now" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/block/buzz/releases/download/v0.4.9/Buzz_0.4.9_x64-setup_alpha-unsigned.exe",
  );

  const ageConfirmation = page.getByLabel("I am 18 years of age or older.");
  const agreementConfirmation = page.getByLabel(
    "I agree to the Buzz Terms of Service and Privacy Policy.",
  );
  const acceptInvite = page.getByRole("button", {
    name: "Accept invite in Buzz",
  });

  await expect(ageConfirmation).toBeVisible();
  await expect(agreementConfirmation).toBeVisible();
  await expect(acceptInvite).toBeDisabled();

  const termsLink = page.getByRole("button", { name: "Terms of Service" });
  const privacyLink = page.getByRole("button", { name: "Privacy Policy" });
  await expect(termsLink).toHaveCSS("text-decoration-line", "none");
  await expect(privacyLink).toHaveCSS("text-decoration-line", "none");
  await termsLink.hover();
  await expect(termsLink).toHaveCSS("text-decoration-line", "underline");
  await page.mouse.move(0, 0);
  await privacyLink.hover();
  await expect(privacyLink).toHaveCSS("text-decoration-line", "underline");

  await page
    .locator("label")
    .filter({ hasText: "I am 18 years of age or older." })
    .click();
  await expect(ageConfirmation).toBeChecked();
  await expect(acceptInvite).toBeDisabled();
  await page
    .locator("label")
    .filter({
      hasText: "I agree to the Buzz Terms of Service and Privacy Policy.",
    })
    .click({ position: { x: 8, y: 8 } });
  await expect(agreementConfirmation).toBeChecked();
  await expect(acceptInvite).toBeEnabled();

  const consentBox = await page
    .getByTestId("invite-join-policy-notice")
    .boundingBox();
  const acceptButtonBox = await acceptInvite.boundingBox();
  expect(consentBox?.y).toBeLessThan(acceptButtonBox?.y ?? 0);
  expect(consentBox?.width).toBe(acceptButtonBox?.width);
});

test("invite can enroll a NIP-07 identity for browser access", async ({
  page,
}) => {
  const pubkey = "ab".repeat(32);
  await page.addInitScript((extensionPubkey) => {
    (
      window as Window & {
        nostr?: {
          getPublicKey(): Promise<string>;
          signEvent(
            event: Record<string, unknown>,
          ): Promise<Record<string, unknown>>;
        };
      }
    ).nostr = {
      async getPublicKey() {
        return extensionPubkey;
      },
      async signEvent(event) {
        return {
          ...event,
          id: "cd".repeat(32),
          pubkey: extensionPubkey,
          sig: "ef".repeat(64),
        };
      },
    };
  }, pubkey);
  await page.route("**/api/join-policy", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ policy: null }),
    });
  });

  let claimObserved = false;
  await page.route("**/api/invites/claim", async (route) => {
    claimObserved = true;
    const request = route.request();
    const body = request.postData() ?? "";
    expect(JSON.parse(body)).toEqual({
      code: "browser-code",
    });

    const authorization = request.headers().authorization;
    expect(authorization).toMatch(/^Nostr /);
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    ) as {
      pubkey: string;
      tags: string[][];
    };
    expect(event.pubkey).toBe(pubkey);
    expect(event.tags).toContainEqual(["u", request.url()]);
    expect(event.tags).toContainEqual(["method", "POST"]);
    expect(event.tags).toContainEqual([
      "payload",
      createHash("sha256").update(body).digest("hex"),
    ]);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "joined",
        community_id: "community-id",
        host: "127.0.0.1",
        role: "member",
      }),
    });
  });

  await page.goto("/invite/browser-code");
  await page.getByRole("button", { name: "Join in browser" }).click();
  await expect(page).toHaveURL("/");
  expect(claimObserved).toBe(true);
});

test("invite asks Safari users to choose their Mac download", async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/26.5 Safari/605.1.15",
  });
  await context.addInitScript(() => {
    Object.defineProperties(navigator, {
      platform: { configurable: true, value: "MacIntel" },
      maxTouchPoints: { configurable: true, value: 0 },
      userAgentData: { configurable: true, value: undefined },
    });
  });
  const page = await context.newPage();
  await page.route("**/api/join-policy", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ policy: null }),
    });
  });
  await page.route("https://api.github.com/**", async (route) => {
    await route.fulfill({ status: 500 });
  });

  await page.goto("/invite/demo-code");
  const download = page.getByRole("link", { name: "Download it now" });
  await expect(download).toHaveAttribute("aria-haspopup", "dialog");
  await download.click();

  const chooser = page.getByRole("dialog", {
    name: "Which Mac do you have?",
  });
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole("link", { name: /Newer Mac/ })).toContainText(
    "2021 or later, or a late-2020 Mac with an Apple M1 chip",
  );
  await expect(chooser.getByRole("link", { name: /Older Mac/ })).toContainText(
    "2019 or earlier, or a 2020 Mac with an Intel processor",
  );
  await expect(chooser.getByText("About This Mac")).toBeVisible();

  const openedPagePromise = context.waitForEvent("page");
  await chooser.getByRole("link", { name: /Newer Mac/ }).click();
  const openedPage = await openedPagePromise;
  await expect(chooser).toBeHidden();
  await expect(openedPage).toHaveURL("https://github.com/block/buzz/releases");
  await expect(page).toHaveURL(/\/invite\/demo-code$/);
  await openedPage.close();

  await download.click();
  await expect(chooser).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chooser).toBeHidden();
  await expect(download).toBeFocused();
  await context.close();
});

test("invite download falls back for mobile and non-desktop devices", async ({
  browser,
}) => {
  const unsupportedDevices = [
    {
      name: "iPhone Safari",
      platform: "iPhone",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
    },
    {
      name: "iPadOS desktop mode",
      platform: "MacIntel",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
    },
    {
      name: "Android phone",
      platform: "Linux armv8l",
      userAgent:
        "Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 Mobile",
      maxTouchPoints: 5,
    },
    {
      name: "ChromeOS",
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; CrOS x86_64 16093.68.0) AppleWebKit/537.36",
      maxTouchPoints: 0,
    },
  ];

  for (const device of unsupportedDevices) {
    const context = await browser.newContext({ userAgent: device.userAgent });
    await context.addInitScript(({ platform, maxTouchPoints }) => {
      Object.defineProperties(navigator, {
        platform: { configurable: true, value: platform },
        maxTouchPoints: { configurable: true, value: maxTouchPoints },
        userAgentData: {
          configurable: true,
          value: { platform, mobile: maxTouchPoints > 0 },
        },
      });
    }, device);
    const page = await context.newPage();
    await page.route("**/api/join-policy", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ policy: null }),
      });
    });
    await page.route("https://api.github.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify([
          {
            draft: false,
            prerelease: false,
            assets: [
              {
                name: "Buzz_0.4.9_x64.dmg",
                browser_download_url:
                  "https://github.com/block/buzz/releases/download/v0.4.9/Buzz_0.4.9_x64.dmg",
              },
              {
                name: "Buzz_0.4.9_amd64.AppImage",
                browser_download_url:
                  "https://github.com/block/buzz/releases/download/v0.4.9/Buzz_0.4.9_amd64.AppImage",
              },
            ],
          },
        ]),
      });
    });

    await page.goto("/invite/demo-code");
    await expect(
      page.getByRole("link", { name: "Download it now" }),
      device.name,
    ).toHaveAttribute("href", "https://github.com/block/buzz/releases");
    await context.close();
  }
});
