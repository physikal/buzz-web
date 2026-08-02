import { createHash, createHmac } from "node:crypto";
import {
  expect,
  test,
  type Download as PlaywrightDownload,
} from "@playwright/test";
import { v2 as nip44 } from "nostr-tools/nip44";
import { finalizeEvent, getPublicKey, verifyEvent } from "nostr-tools/pure";

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

test("owner setup creates a passkey-wrapped signer and enters Channels", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
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
  let catalogImageRequests = 0;
  let ownerPubkey = "";
  const managedAgents: Array<Record<string, unknown>> = [];
  const createdAgentInputs: Array<Record<string, unknown>> = [];
  const restoredMemory: Array<{ slug: string; body: string }> = [];
  const submittedEvents: Array<{
    id: string;
    pubkey: string;
    sig: string;
    kind: number;
    content: string;
    tags: string[][];
  }> = [];
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
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: `https://cdn.example.com/${sha256}`,
        sha256,
        size: bytes.length,
        type: request.headers()["content-type"],
      }),
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
            created_at: Math.floor(Date.now() / 1000),
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
          const filters = JSON.stringify(frame.slice(2));
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
          }
          if (filters.includes("40008")) {
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 9,
                    created_at: createdAt,
                    content: "Welcome to Buzz Web.",
                    tags: [["h", "44444444-4444-4444-8444-444444444444"]],
                  },
                  signer,
                ),
              ]),
            );
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
                    tags: [["member", ownerPubkey, "owner"]],
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
                    ],
                  },
                  signer,
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
          }
          if (filters.includes("10100")) {
            socket.send(
              JSON.stringify([
                "EVENT",
                subscriptionId,
                finalizeEvent(
                  {
                    kind: 10100,
                    created_at: createdAt,
                    content: JSON.stringify({ name: "Relay agent" }),
                    tags: [],
                  },
                  signer,
                ),
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
                    }),
                    tags: [],
                  },
                  signer,
                ),
              ]),
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
  await expect(page.getByRole("heading", { name: "general" })).toBeVisible();
  await expect(page.getByText("Welcome to Buzz Web.")).toBeVisible();
  await expect(page.getByLabel("Message #general")).toBeVisible();
  expect(ownerPubkey).toMatch(/^[0-9a-f]{64}$/);
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
  await page.getByRole("button", { name: "Mark read #general" }).click();
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
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Open Relay agent profile" }).click();
  await expect(
    page.getByRole("dialog", { name: "Relay agent profile" }),
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
  await page.getByRole("button", { name: "Close" }).click();
  const welcomeMessage = page.locator("article").filter({
    hasText: "Welcome to Buzz Web.",
  });
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
  await page.getByLabel("Passkey label").fill("Bitwarden passkey");
  await page.getByRole("button", { name: "Add passkey" }).click();
  await expect(page.getByText("Passkey added")).toBeVisible();
  expect(addedCredentialCount).toBe(1);
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
  await expect(
    page.getByRole("heading", { name: "Relay project" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name").fill("Web parity");
  await page.getByLabel("Description").fill("Created from the browser");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 30617 &&
          event.tags.some((tag) => tag[0] === "d" && tag[1] === "web-parity"),
      ),
    )
    .toBe(true);
  await page.getByRole("link", { name: "Relay project" }).click();
  await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
  await page.getByRole("button", { name: "New issue" }).click();
  await page.getByLabel("Title").fill("Browser issue");
  await page.getByLabel("Description").fill("Track this from Buzz Web");
  await page.getByRole("button", { name: "Create issue" }).click();
  await expect
    .poll(() =>
      submittedEvents.some(
        (event) =>
          event.kind === 1621 &&
          event.tags.some(
            (tag) => tag[0] === "subject" && tag[1] === "Browser issue",
          ),
      ),
    )
    .toBe(true);
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
  await page.getByRole("link", { name: "Pulse" }).click();
  await expect(page.getByRole("heading", { name: "Pulse" })).toBeVisible();
  await expect(page.getByText("Relay-native Pulse update")).toBeVisible();
  await expect(page.getByText("Forged relay frame")).toHaveCount(0);
  await page.getByLabel("Create Pulse note").fill("Published from Buzz Web");
  await page.getByRole("button", { name: "Post" }).click();
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
  const pulseNote = page.locator("article").filter({
    hasText: "Relay-native Pulse update",
  });
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
  await expect(
    page.getByText("Follow people to see their updates here."),
  ).toBeVisible();
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
  await page.getByRole("link", { name: "Channels" }).click();
  await expect(page.getByRole("heading", { name: "general" })).toBeVisible();

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
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await expect(page.getByText("Owner mention from inbox").last()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/buzz-web-inbox-mobile.png" });
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
