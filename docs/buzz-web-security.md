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
  15 minutes without signing. Closing the page destroys the worker.
- The relay verifies that the signer is the tenant's current relay owner before
  listing, creating, starting, stopping, or deleting hosted agents.
- The relay creates agent identities server-side. Agent private keys and
  provider credentials are encrypted with ChaCha20-Poly1305 using tenant and
  agent IDs as authenticated context. The database stores only ciphertext.
- Agent processes receive an empty environment plus a fixed set of relay,
  identity, and ACP values. Provider settings use a positive allowlist;
  executable paths, `NODE_OPTIONS`, loader variables, database credentials,
  Redis credentials, and the envelope key cannot be supplied by the browser.
- Runtime commands come from a fixed server-side catalog. No API value is
  interpreted as a command, argument list, image name, or host path.
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
3. Treat the recovery code like the owner key. It is deliberately sufficient to
   decrypt the vault and enroll a replacement passkey. Do not store it in
   Dokploy, the Buzz database, or the same backup set as the encrypted vault.
4. Keep `respond_to` set to `owner-only` unless broader access is intentional.
   A permitted author can ask an agent to exercise whatever repository,
   network, and provider access that particular harness has.
5. Review and rebuild pinned harness dependencies regularly. Do not install
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

WebAuthn credentials are phishing-resistant and domain-bound, which improves
login phishing resistance relative to manually pasting an `nsec`. PRF support
still varies by browser and authenticator. Buzz fails closed when PRF is absent
instead of storing the key under a weaker password-only scheme.

Agent UIDs isolate processes and data from each other and from host credentials,
but all agents in one `agent-host` container still share a Linux kernel and
network namespace. This is comparable to desktop agents running as local
processes, not to VM-grade isolation. A future high-assurance deployment can
place each leased agent in its own container or microVM without changing the
control-plane API or database lease model.
