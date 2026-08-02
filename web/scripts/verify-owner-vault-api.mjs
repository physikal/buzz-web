import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { nip19 } from "nostr-tools";
import { finalizeEvent } from "nostr-tools/pure";

const transportOrigin = process.env.BUZZ_HTTP_URL;
const signedOrigin = process.env.BUZZ_SIGNED_ORIGIN ?? transportOrigin;
const hostHeader = process.env.BUZZ_HOST_HEADER;
const token = process.env.BUZZ_OWNER_SETUP_TOKEN;

if (!transportOrigin || !signedOrigin || !token) {
  throw new Error(
    "Set BUZZ_HTTP_URL, BUZZ_SIGNED_ORIGIN, and BUZZ_OWNER_SETUP_TOKEN.",
  );
}

const secretKey = new Uint8Array(randomBytes(32));
const intruderSecretKey = new Uint8Array(randomBytes(32));
const base64url = (value) => Buffer.from(value).toString("base64url");
const credential = {
  credential_id: base64url(randomBytes(32)),
  label: "API verification passkey",
  prf_input: base64url(randomBytes(32)),
  kdf_salt: base64url(randomBytes(32)),
  nonce: base64url(randomBytes(12)),
  ciphertext: base64url(randomBytes(48)),
};
const recovery = {
  kdf_salt: base64url(randomBytes(32)),
  nonce: base64url(randomBytes(12)),
  ciphertext: base64url(randomBytes(48)),
};
const replacementCredential = {
  credential_id: base64url(randomBytes(32)),
  label: "API verification replacement passkey",
  prf_input: base64url(randomBytes(32)),
  kdf_salt: base64url(randomBytes(32)),
  nonce: base64url(randomBytes(12)),
  ciphertext: base64url(randomBytes(48)),
};

function authHeader(method, path, body, signingKey = secretKey) {
  const tags = [
    ["u", `${signedOrigin}${path}`],
    ["method", method],
  ];
  if (body !== undefined) {
    tags.push(["payload", createHash("sha256").update(body).digest("hex")]);
    tags.push(["nonce", randomUUID()]);
  }
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: "",
    },
    signingKey,
  );
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`;
}

async function request(path, options = {}) {
  const response = await fetch(`${transportOrigin}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(hostHeader ? { Host: hostHeader } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

const before = await request("/api/owner/status");
if (
  !before.response.ok ||
  before.payload.claimed ||
  before.payload.vault_ready
) {
  throw new Error(
    `Expected an unclaimed relay: ${JSON.stringify(before.payload)}`,
  );
}
if (
  !before.response.headers.get("cache-control")?.includes("no-store") ||
  !before.response.headers
    .get("permissions-policy")
    ?.includes("publickey-credentials-get=(self)") ||
  before.response.headers.get("x-frame-options") !== "DENY"
) {
  throw new Error(
    "Owner endpoints are missing required browser security headers.",
  );
}

const claimPath = "/api/owner/claim";
const claimBody = JSON.stringify({ token, credential, recovery });
const invalidClaimBody = JSON.stringify({
  token: "00".repeat(32),
  credential,
  recovery,
});
const invalidClaim = await request(claimPath, {
  method: "POST",
  headers: {
    Authorization: authHeader("POST", claimPath, invalidClaimBody),
    "Content-Type": "application/json",
  },
  body: invalidClaimBody,
});
if (invalidClaim.response.status !== 401) {
  throw new Error(
    `Invalid setup token was accepted: ${JSON.stringify(invalidClaim.payload)}`,
  );
}

const claim = await request(claimPath, {
  method: "POST",
  headers: {
    Authorization: authHeader("POST", claimPath, claimBody),
    "Content-Type": "application/json",
  },
  body: claimBody,
});
if (claim.response.status !== 201) {
  throw new Error(`Owner claim failed: ${JSON.stringify(claim.payload)}`);
}

const after = await request("/api/owner/status");
if (!after.payload.claimed || !after.payload.vault_ready) {
  throw new Error(`Claim was not durable: ${JSON.stringify(after.payload)}`);
}

const unlockPath = "/api/owner/vault/unlock";
const unlock = await request(unlockPath, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ credential_id: credential.credential_id }),
});
if (
  !unlock.response.ok ||
  unlock.payload.owner_pubkey !== claim.payload.owner_pubkey ||
  unlock.payload.ciphertext !== credential.ciphertext
) {
  throw new Error(`Stored wrapper mismatch: ${JSON.stringify(unlock.payload)}`);
}

const storedRecovery = await request("/api/owner/vault/recovery");
if (
  !storedRecovery.response.ok ||
  storedRecovery.payload.owner_pubkey !== claim.payload.owner_pubkey ||
  storedRecovery.payload.ciphertext !== recovery.ciphertext
) {
  throw new Error(
    `Stored recovery wrapper mismatch: ${JSON.stringify(storedRecovery.payload)}`,
  );
}

const agentsPath = "/api/agents";
const anonymousAgents = await request(agentsPath);
if (anonymousAgents.response.status !== 401) {
  throw new Error("Agent control plane allowed an unsigned request.");
}
const agents = await request(agentsPath, {
  headers: { Authorization: authHeader("GET", agentsPath) },
});
if (!agents.response.ok || !Array.isArray(agents.payload.agents)) {
  throw new Error(
    `Claimed owner was not authorized: ${JSON.stringify(agents.payload)}`,
  );
}

const credentialsPath = "/api/owner/credentials";
const credentialsBody = JSON.stringify({ credential: replacementCredential });
const intruderCredential = await request(credentialsPath, {
  method: "POST",
  headers: {
    Authorization: authHeader(
      "POST",
      credentialsPath,
      credentialsBody,
      intruderSecretKey,
    ),
    "Content-Type": "application/json",
  },
  body: credentialsBody,
});
if (intruderCredential.response.status !== 403) {
  throw new Error("A non-owner was allowed to register a passkey.");
}
const addCredential = await request(credentialsPath, {
  method: "POST",
  headers: {
    Authorization: authHeader("POST", credentialsPath, credentialsBody),
    "Content-Type": "application/json",
  },
  body: credentialsBody,
});
if (addCredential.response.status !== 201) {
  throw new Error(
    `Replacement passkey registration failed: ${JSON.stringify(addCredential.payload)}`,
  );
}

const replacementUnlock = await request(unlockPath, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ credential_id: replacementCredential.credential_id }),
});
if (
  !replacementUnlock.response.ok ||
  replacementUnlock.payload.owner_pubkey !== claim.payload.owner_pubkey ||
  replacementUnlock.payload.ciphertext !== replacementCredential.ciphertext
) {
  throw new Error(
    `Replacement wrapper mismatch: ${JSON.stringify(replacementUnlock.payload)}`,
  );
}

const duplicate = await request(claimPath, {
  method: "POST",
  headers: {
    Authorization: authHeader("POST", claimPath, claimBody),
    "Content-Type": "application/json",
  },
  body: claimBody,
});
if (duplicate.response.status !== 409) {
  throw new Error(
    `Second claim was not rejected: ${JSON.stringify(duplicate.payload)}`,
  );
}

if (process.env.BUZZ_OWNER_KEY_OUTPUT) {
  await writeFile(
    process.env.BUZZ_OWNER_KEY_OUTPUT,
    `${nip19.nsecEncode(secretKey)}\n`,
    {
      mode: 0o600,
    },
  );
}

console.log(
  JSON.stringify({
    ok: true,
    owner_pubkey: claim.payload.owner_pubkey,
    vault_ciphertext_bytes: Buffer.from(credential.ciphertext, "base64url")
      .length,
    recovery_ciphertext_bytes: Buffer.from(recovery.ciphertext, "base64url")
      .length,
    replacement_passkey_registered: true,
  }),
);
