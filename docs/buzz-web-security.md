# Buzz Web security model

Buzz Web adds an owner-only browser control plane and a server-side agent
supervisor to the existing relay. It does not turn the browser into an agent
runtime and does not give an agent process access to Docker.

## Trust boundaries

- The public relay image contains the web bundle but no Node-based harnesses or
  ACP adapters. The agent host remains a separate image and process.
- Every control-plane request is a short-lived NIP-98 event signed by the
  owner's NIP-07 signer. Writes include a body digest and nonce and are rejected
  on replay. There is no bearer session cookie or private key in browser
  storage; `sessionStorage` contains only the owner's public key.
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
  agent API responses are marked `no-store` and vary on authorization.
  Production CORS is pinned to the configured HTTPS origin.
- ACP packages are exact-versioned and installed with a committed npm lockfile
  containing registry integrity hashes. Production deployments should use the
  workflow's immutable relay and agent image tags from the same commit.

## Operational requirements

1. Terminate TLS at Dokploy and do not expose Postgres, Redis, MinIO, health, or
   metrics ports publicly.
2. Import the bootstrap owner key into a trusted NIP-07 signer, then delete or
   restrict the one-shot bootstrap logs. Back up the owner-key and service
   secret volumes outside Dokploy.
3. Review signer prompts. A compromised signer or owner workstation has owner
   authority, just as a compromised desktop client does.
4. Keep `respond_to` set to `owner-only` unless broader access is intentional.
   A permitted author can ask an agent to exercise whatever repository,
   network, and provider access that particular harness has.
5. Review and rebuild pinned harness dependencies regularly. Do not install
   extra runtimes in the relay image.

## Residual risk

The hosted design exposes the existing relay and the new owner API over HTTPS,
so its web bundle, reverse proxy, and browser signer become relevant attack
surfaces. Per-request signatures, CSP, same-origin CORS, and owner authorization
reduce this risk, but they do not make a compromised browser extension safe.

Agent UIDs isolate processes and data from each other and from host credentials,
but all agents in one `agent-host` container still share a Linux kernel and
network namespace. This is comparable to desktop agents running as local
processes, not to VM-grade isolation. A future high-assurance deployment can
place each leased agent in its own container or microVM without changing the
control-plane API or database lease model.
