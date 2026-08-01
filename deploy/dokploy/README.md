# Dokploy deployment

This Compose application runs the Buzz relay, browser client, centralized agent
host, Postgres, Redis, and private object storage. The relay and agent host use
separate images and processes. The agent host has no Redis, S3, or relay signing
credentials. The supervisor drops every agent child to an unprivileged Unix
identity and private data directory that cannot traverse the host-only
credential mount or another agent's directory; children also inherit none of
the supervisor's database or envelope environment variables. See
[`docs/buzz-web-security.md`](../../docs/buzz-web-security.md) for the complete
trust-boundary review and residual risks.

## Deploy

1. Create a Dokploy **Compose** service from this GitHub repository.
2. Set the Compose path to `deploy/dokploy/compose.yml`.
3. Add `BUZZ_DOMAIN` in Dokploy's Environment screen.
4. Add a Dokploy domain for service `relay`, container port `3000`, with HTTPS.
5. Deploy, then open the completed `bootstrap` service log once. Copy the
   `BUZZ_OWNER_NSEC` value into a NIP-07 browser signer and clear/protect the
   bootstrap log according to your log-retention policy.
6. Visit `https://<BUZZ_DOMAIN>/agents`, choose **Connect owner key**, and approve
   the signer request.

## Browser sign-in

Browsers do not include a Nostr signer by default. Install a NIP-07 signer
extension in the browser used for administration, create a signer account by
importing the generated `BUZZ_OWNER_NSEC`, and keep that account selected while
using the owner console. The web application never asks for, receives, or stores
the private key. **Connect owner key** requests only the public key, and the
signer asks for approval when the console signs an authenticated management
request.

The owner public key is remembered in that browser session so a refresh returns
to the Agents page. The private key remains in the signer. A different computer
can administer the same centralized agents after installing a compatible signer
and importing the same owner key; it does not launch a second copy of any agent.

All other credentials are generated with the operating system CSPRNG and kept
in named volumes. Re-deploying does not rotate them. Back up the named data and
secret volumes together. The owner private-key volume is mounted only by the
one-shot bootstrap service; neither the relay nor the agent host can read it.

GitHub pushes to `main` publish `:main` and `:agent-main`; point production at
the matching immutable `:sha-<commit>` and `:agent-sha-<commit>` tags after the
first validation deploy.
