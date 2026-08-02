import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { nip19 } from "nostr-tools";
import { v2 as nip44 } from "nostr-tools/nip44";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

const publicBase = required("BUZZ_PUBLIC_URL").replace(/\/$/, "");
const transportBase = required("BUZZ_TRANSPORT_URL").replace(/\/$/, "");
const ownerKeyFile = required("BUZZ_OWNER_KEY_FILE");
const decoded = nip19.decode((await readFile(ownerKeyFile, "utf8")).trim());
if (decoded.type !== "nsec") throw new Error("Owner key file is not an nsec.");
const secretKey = decoded.data;
const ownerPubkey = getPublicKey(secretKey);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function authorization(url, method, body) {
  const tags = [
    ["u", url],
    ["method", method],
    ["nonce", randomUUID()],
  ];
  if (body !== undefined) {
    tags.push(["payload", createHash("sha256").update(body).digest("hex")]);
  }
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: "",
    },
    secretKey,
  );
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`;
}

async function request(path, { method = "GET", body } = {}) {
  const publicUrl = `${publicBase}${path}`;
  const transportUrl = new URL(`${transportBase}${path}`);
  const response = await new Promise((resolve, reject) => {
    const send =
      transportUrl.protocol === "https:" ? httpsRequest : httpRequest;
    const outgoing = send(
      transportUrl,
      {
        method,
        headers: {
          Accept: "application/json",
          Authorization: authorization(publicUrl, method, body),
          Host: new URL(publicBase).host,
          ...(body === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              }),
        },
      },
      (incoming) => {
        const chunks = [];
        incoming.on("data", (chunk) => chunks.push(chunk));
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    outgoing.on("error", reject);
    if (body !== undefined) outgoing.write(body);
    outgoing.end();
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `${method} ${path} failed (${response.status}): ${response.body}`,
    );
  }
  return response.status === 204 ? null : JSON.parse(response.body);
}

async function submitEvent(template) {
  const event = finalizeEvent(
    {
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      ...template,
    },
    secretKey,
  );
  const result = await request("/events", {
    method: "POST",
    body: JSON.stringify(event),
  });
  if (!result.accepted)
    throw new Error(result.message || "Relay rejected event.");
  return event;
}

const channelId = randomUUID();
await submitEvent({
  kind: 9007,
  tags: [
    ["h", channelId],
    ["name", `Web smoke ${channelId.slice(0, 8)}`],
    ["channel_type", "stream"],
    ["visibility", "private"],
  ],
});

const name = `Web API smoke ${Date.now()}`;
const created = await request("/api/agents", {
  method: "POST",
  body: JSON.stringify({
    name,
    persona_id: "smoke-persona",
    system_prompt: "Wait for owner instructions.",
    runtime: "buzz-agent",
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    agent_args: [],
    parallelism: 3,
    idle_timeout_seconds: 900,
    max_turn_duration_seconds: 7200,
    runtime_config: {
      thinking_effort: "high",
      max_rounds: "8",
      max_output_tokens: "8192",
      max_context_tokens: "200000",
    },
    respond_to: "owner-only",
    respond_to_allowlist: [],
    secrets: { ANTHROPIC_API_KEY: "smoke-test-not-a-real-key" },
    start_immediately: false,
  }),
});
const agent = created?.agent;
if (!agent?.id || agent.name !== name || agent.persona_id !== "smoke-persona")
  throw new Error("Create response is invalid.");
if (
  agent.provider !== "anthropic" ||
  agent.parallelism !== 3 ||
  agent.idle_timeout_seconds !== 900 ||
  agent.max_turn_duration_seconds !== 7200 ||
  agent.runtime_config?.thinking_effort !== "high" ||
  agent.runtime_config?.max_output_tokens !== "8192"
) {
  throw new Error("Advanced agent configuration did not round-trip.");
}
if (
  "sandbox_uid" in agent ||
  "secret_ciphertext" in agent ||
  "secrets" in agent
) {
  throw new Error("Create response exposed an internal or secret field.");
}

try {
  if (agent.desired_state !== "stopped" || agent.observed_state !== "stopped") {
    throw new Error("Snapshot-style creation did not leave the agent stopped.");
  }
  const memoryBody = "Remember the hosted snapshot restore.";
  await request(`/api/agents/${agent.id}/memory`, {
    method: "POST",
    body: JSON.stringify({ slug: "core", body: memoryBody }),
  });
  const engrams = await request("/query", {
    method: "POST",
    body: JSON.stringify([
      {
        kinds: [30174],
        authors: [agent.agent_pubkey],
        "#p": [ownerPubkey],
        limit: 10,
      },
    ]),
  });
  const engram = engrams.find((event) => event.pubkey === agent.agent_pubkey);
  if (!engram) throw new Error("Restored agent memory was not discoverable.");
  const conversationKey = nip44.utils.getConversationKey(
    secretKey,
    agent.agent_pubkey,
  );
  let plaintext;
  try {
    plaintext = nip44.decrypt(engram.content, conversationKey);
  } finally {
    conversationKey.fill(0);
  }
  if (plaintext !== JSON.stringify({ slug: "core", profile: memoryBody })) {
    throw new Error(
      "Restored agent memory could not be decrypted by the owner.",
    );
  }

  const listed = await request("/api/agents");
  if (!listed.agents.some((candidate) => candidate.id === agent.id)) {
    throw new Error("Created agent was not returned by the owner list API.");
  }

  await submitEvent({
    kind: 9000,
    tags: [
      ["h", channelId],
      ["p", agent.agent_pubkey],
      ["role", "bot"],
    ],
  });
  const memberships = await request("/query", {
    method: "POST",
    body: JSON.stringify([
      { kinds: [39002], "#p": [agent.agent_pubkey], limit: 10 },
    ]),
  });
  if (
    !memberships.some((event) =>
      event.tags.some((tag) => tag[0] === "d" && tag[1] === channelId),
    )
  ) {
    throw new Error("Agent channel membership was not discoverable.");
  }

  await request(`/api/agents/${agent.id}/start`, {
    method: "POST",
    body: "",
  });

  let current = agent;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = await request("/api/agents");
    current = state.agents.find((candidate) => candidate.id === agent.id);
    if (!current) throw new Error("Created agent disappeared before cleanup.");
    if (["running", "error", "stopped"].includes(current.observed_state)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (current.desired_state !== "stopped") {
    await request(`/api/agents/${agent.id}/stop`, { method: "POST", body: "" });
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = await request("/api/agents");
    current = state.agents.find((candidate) => candidate.id === agent.id);
    if (
      current?.observed_state === "stopped" ||
      current?.observed_state === "error"
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await request(`/api/agents/${agent.id}`, { method: "DELETE", body: "" });
  await submitEvent({ kind: 9008, tags: [["h", channelId]] });
  console.log(`Hosted-agent smoke test passed (${current.observed_state}).`);
} catch (error) {
  console.error(
    `Disposable resources retained for diagnosis: agent=${agent.id} channel=${channelId}`,
  );
  throw error;
}
