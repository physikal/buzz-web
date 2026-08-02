# Buzz Web security model

Buzz Web adds an owner-only browser control plane and a server-side agent
supervisor to the existing relay. It does not turn the browser into an agent
runtime and does not give an agent process access to Docker.

## Trust boundaries

- The public relay image contains the web bundle but no Node-based harnesses or
  ACP adapters. The agent host remains a separate image and process.
- Every control-plane request is a short-lived NIP-98 event signed by the
  owner's Nostr key. Writes include a body digest and nonce and are rejected on
  replay. There is no bearer session cookie or plaintext private key in browser
  storage.
- Fresh deployments start unclaimed. Bootstrap creates a 256-bit, 24-hour claim
  token, exposes only its SHA-256 hash to the relay, and prints the raw token in
  the one-shot log. The browser creates the Nostr owner key, proves it through a
  payload-bound NIP-98 claim, and atomically inserts the sole owner and encrypted
  vault. An existing owner must sign with the same key to enroll a legacy relay.
- The browser stores the owner key only as AES-256-GCM ciphertext. A WebAuthn
  PRF result feeds HKDF to produce the wrapping key; neither PRF output nor the
  plaintext Nostr key reaches the relay. A separate high-entropy recovery code
  wraps the same key, and only its ciphertext is stored in Postgres.
- Plaintext owner-key operations live in a dedicated browser worker. React code
  receives only the public key, encrypted wrappers, and signed events. The
  worker zeroes and drops the key on explicit lock and automatically locks after
  15 minutes without signing. Closing the page destroys the worker. An owner may
  explicitly create a standard NIP-49 backup; scrypt and XChaCha20-Poly1305 run
  inside the same worker, and only the password-encrypted `ncryptsec` artifact
  crosses back to the page for download. The web UI does not expose a raw
  private-key reveal path. Existing-owner enrollment can also decrypt a NIP-49
  backup inside the worker; the browser verifies that its public key matches the
  configured relay owner, and neither the backup nor its password enters the
  claim payload.
- The relay verifies that the signer is the tenant's current relay owner before
  listing, creating, starting, stopping, or deleting hosted agents.
- The relay creates agent identities server-side. Agent private keys and
  provider credentials are encrypted with ChaCha20-Poly1305 using tenant and
  agent IDs as authenticated context. The database stores only ciphertext.
- Portable agent and team snapshots never include agent identities, provider
  secrets, executable settings, or hosted persona-lineage metadata. Source
  allowlists are cleared by default on import. Memory is an explicit plaintext
  export, matching the desktop format. Restoring it requires an owner-signed,
  payload-bound request while the new agent is fully stopped; the relay decrypts
  that agent's key only in process memory, signs and NIP-44 encrypts one bounded
  entry, then submits it through the ordinary event-ingest validation path. The
  control plane does not persist or return the plaintext or private key.
- Agent processes receive an empty environment plus a fixed set of relay,
  identity, and ACP values. Non-secret provider and tuning fields are stored as
  normalized values, then the relay and agent host use one shared Rust catalog
  to map them onto a positive environment allowlist. Executable paths,
  arbitrary environment names, `NODE_OPTIONS`, loader variables, database
  credentials, Redis credentials, and the envelope key cannot be supplied by
  the browser.
- Runtime commands come from a deployment-owned server-side catalog shared by
  the relay and agent host. Built-ins are compiled in; custom entries come only
  from the operator's `BUZZ_AGENT_RUNTIME_CATALOG_JSON`. The authenticated
  owner catalog response omits commands and fixed arguments. The owner may
  supply a bounded argument array for built-ins. Custom runtime arguments are
  denied unless the operator explicitly enables them; accepted arguments are passed
  directly to `exec` without shell interpretation and may not contain the
  comma delimiter used by the ACP transport. No API value is interpreted as an
  executable, shell command, image name, or host path. Custom web harnesses
  must therefore be installed and advertised by the server operator rather
  than accepting a browser-supplied command. Custom commands must be executable
  basenames resolved through the host's fixed `PATH`. Custom secret fields are
  exact-match allowlisted and restricted to ordinary credential suffixes; Buzz,
  dynamic-loader, database, proxy, container, and toolchain control variables
  are rejected.
- Codex and Claude subscription login uses a separate private control port on
  the agent host. Public requests still require an owner-signed NIP-98 event;
  relay-to-host requests also require a domain-separated token derived from the
  deployment envelope key. The host accepts only fixed vendor login commands,
  only while the target agent is fully stopped, and runs them as that agent's
  dedicated UID with an empty environment.
- The agent host is not attached to the public edge network. Its control port
  is reachable only on the internal backend network, while a separate egress
  network provides the outbound access required by agent and vendor CLIs.
- Login output and confirmation input are capped, stripped of terminal control
  sequences, held only in process memory, and never written to the relay
  database or logs. Login sessions expire after 15 minutes. The resulting
  vendor credential files live only in the agent's mode-`0700` data directory.
- Hosted-agent observer history is stored in a dedicated journal, outside the
  general event and search tables. Only validated agent-to-owner telemetry is
  eligible, and the stored value is the original signed NIP-44 ciphertext
  envelope. Retrieval requires an owner-signed request for that owned agent,
  returns `no-store`, and the browser re-verifies the Nostr signature and exact
  routing tags before local decryption. Active journals are trimmed toward the
  newest 10,000 frames at most once every ten seconds and history older than 30
  days is reaped; one response is capped at 3,000 frames and 8 MiB. Deleting the
  hosted agent cascades its history.
- Each agent runs under a stable, unique Unix UID with a mode `0700` data
  directory. The supervisor uses fenced, short-lived database leases; a stale
  runner terminates when it can no longer renew its lease. During a host pause
  or network partition, failover can still produce a brief overlap before the
  stale process observes that it lost the lease.
- The agent host receives only its scoped database and envelope secrets. It has
  no Redis, S3, relay-signing, owner-key, or Docker-socket access. Its container
  drops all capabilities except `SETUID`, `SETGID`, and `CHOWN`, which establish
  the per-agent sandbox before exec.
- Postgres, Redis, and object storage have no published ports and use generated
  credentials. The relay is the deployment's only public ingress endpoint.
- Browser responses set a restrictive Content Security Policy, deny framing,
  disable MIME sniffing, send no referrer, and advertise HSTS. Authenticated
  owner and agent API responses are marked `no-store` and vary on authorization.
  Production CORS is pinned to the configured HTTPS origin.
- ACP packages are exact-versioned and installed with a committed npm lockfile
  containing registry integrity hashes. Production deployments should use the
  workflow's immutable relay and agent image tags from the same commit.

## Operational requirements

1. Terminate TLS at Dokploy and do not expose Postgres, Redis, MinIO, health, or
   metrics ports publicly.
2. Open the bootstrap setup URL promptly, store the recovery code separately,
   then delete or restrict the bootstrap logs. Anyone who obtains the unexpired
   token before the first claim can become owner.
3. Treat the vault unlock code like the owner key. It is deliberately sufficient
   to decrypt the vault and may be stored in a separate password manager for
   cross-device access. Do not store it in Dokploy, the Buzz database, or the
   same backup set as the encrypted vault.
4. Store an exported NIP-49 file separately from its backup password. A weak or
   reused password reduces the protection of the downloaded file even though
   the server never receives either value.
5. Keep `respond_to` set to `owner-only` unless broader access is intentional.
   A permitted author can ask an agent to exercise whatever repository,
   network, and provider access that particular harness has.
6. Review and rebuild pinned harness dependencies regularly. Do not install
   extra runtimes in the relay image.

## Residual risk

The hosted design exposes the existing relay and the new owner API over HTTPS,
so its web bundle, reverse proxy, and browser become relevant attack surfaces.
Per-request signatures, CSP, same-origin CORS, owner authorization, fixed-size
ciphertexts, and an isolated worker reduce this risk.

This is not the same isolation boundary as Buzz Desktop. Desktop keeps the
plaintext owner key in a native Rust process backed by the operating-system
keyring, outside the web renderer. Buzz Web must deliver code from the owner
origin before WebAuthn releases the PRF output. A compromised relay image,
deployment pipeline, or same-origin script could replace that code and wait for
the owner to unlock. Database theft alone yields only authenticated ciphertext,
but compromise of the live web origin during an unlock can expose owner
authority. The worker prevents accidental UI access; it cannot defend against
malicious replacement code from the same origin.

The observer journal adds encrypted telemetry volume, timestamps, and the
hosted-agent association to database backups. Message, prompt, tool, and result
content remains NIP-44 ciphertext, but traffic analysis is still possible and
backups must honor the same 30-day retention policy operationally.

WebAuthn credentials are phishing-resistant and domain-bound, which improves
login phishing resistance relative to manually pasting an `nsec`. PRF support
still varies by browser and authenticator. Buzz fails closed when PRF is absent
instead of storing the key under a weaker password-only scheme.

Password-manager unlock is not a non-PRF passkey fallback disguised as the same
mechanism. It uses the separately generated 256-bit vault code as encryption
material, so the relay still cannot decrypt the owner key. A password manager
that can store passkeys but does not expose WebAuthn PRF can sync and autofill
that code without requiring server-side key escrow.

Agent UIDs isolate processes and data from each other and from host credentials,
but all agents in one `agent-host` container still share a Linux kernel and
network namespace. This is comparable to desktop agents running as local
processes, not to VM-grade isolation. A future high-assurance deployment can
place each leased agent in its own container or microVM without changing the
control-plane API or database lease model.

Subscription credentials are different from API-key configuration at rest.
API keys remain encrypted in Postgres until process launch; vendor CLI login
tokens must persist in the per-agent data volume so the official Codex or Claude
CLI can refresh and reuse them. Container root or a compromise of that agent
process can read its own subscription credentials, just as a desktop harness
can read credentials in its user profile. The UID boundary prevents another
non-root agent process from reading them, but it is not protection against a
compromised container host.
