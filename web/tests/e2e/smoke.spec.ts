import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { finalizeEvent, verifyEvent } from "nostr-tools/pure";

test("home page loads with Buzz branding", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("main").getByRole("img", { name: "Buzz" }),
  ).toBeVisible();
});

test("home page shows repositories section", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Repositories")).toBeVisible();
});

test("owner setup creates a passkey-wrapped signer and enters Channels", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
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

  const token = "42".repeat(32);
  let ownerPubkey = "";
  const submittedEvents: Array<{
    kind: number;
    content: string;
    tags: string[][];
  }> = [];
  let claimedCredential: {
    credential_id: string;
    prf_input: string;
    kdf_salt: string;
    nonce: string;
    ciphertext: string;
  } | null = null;
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
    expect(body.credential_id).toBe(claimedCredential?.credential_id);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        owner_pubkey: ownerPubkey,
        prf_input: claimedCredential?.prf_input,
        kdf_salt: claimedCredential?.kdf_salt,
        nonce: claimedCredential?.nonce,
        ciphertext: claimedCredential?.ciphertext,
      }),
    });
  });
  await page.route("**/api/agents", async (route) => {
    const authorization = route.request().headers().authorization ?? "";
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(ownerPubkey);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ agents: [] }),
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
        url: "http://localhost:4173/invite/owner-invite",
        max_uses: null,
        uses_remaining: null,
      }),
    });
  });
  await page.route("**/events", async (route) => {
    submittedEvents.push(
      JSON.parse(route.request().postData() ?? "{}") as {
        kind: number;
        content: string;
        tags: string[][];
      },
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ accepted: true }),
    });
  });
  await page.routeWebSocket(
    /ws:\/\/(?:127\.0\.0\.1|localhost):4173\/?$/,
    (socket) => {
      socket.onMessage((message) => {
        const frame = JSON.parse(String(message)) as unknown[];
        if (frame[0] === "REQ" && typeof frame[1] === "string") {
          const subscriptionId = frame[1];
          const filters = JSON.stringify(frame.slice(2));
          const signer = new Uint8Array(32);
          signer[31] = 1;
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
                      ["p", ownerPubkey],
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
          socket.send(JSON.stringify(["EOSE", subscriptionId]));
        }
      });
    },
  );

  await page.goto(`http://localhost:4173/agents/setup#${token}`);
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
  const welcomeMessage = page.locator("article").filter({
    hasText: "Welcome to Buzz Web.",
  });
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

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
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
  await page.getByRole("link", { name: "Channels" }).click();
  await expect(page.getByRole("heading", { name: "general" })).toBeVisible();

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
