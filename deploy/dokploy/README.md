# Dokploy deployment

This Compose application runs the Buzz relay, browser client, centralized agent
host, Postgres, Redis, and private object storage. The relay and agent host use
separate images and processes. See
[`docs/buzz-web-security.md`](../../docs/buzz-web-security.md) for the complete
trust-boundary review.

## Deploy

1. Create a Dokploy **Compose** service from this GitHub repository.
2. Set the Compose path to `deploy/dokploy/compose.yml`.
3. Add `BUZZ_DOMAIN` in Dokploy's Environment screen.
4. Add a Dokploy domain for service `relay`, container port `3000`, with HTTPS.
5. Deploy and open the completed `bootstrap` service log.
6. Open the printed `BUZZ_OWNER_SETUP_URL` within 24 hours.
7. Choose **Create owner passkey**, approve the browser's passkey prompt, and
   store the one-time vault unlock code in a password manager or away from the
   server.

The browser generates the Nostr owner key. The bootstrap container generates
only a high-entropy setup token and gives the relay its SHA-256 hash. A successful
claim consumes the setup capability by creating the sole owner vault and owner
membership in one database transaction. Re-running bootstrap rotates an expired
unclaimed link without rotating deployment service credentials.

## Browser sign-in

Visit `https://<BUZZ_DOMAIN>/channels` and choose **Unlock with passkey**. The
browser obtains a credential-bound PRF value after Touch ID, Face ID, Windows
Hello, a device PIN, or a supported security key. That value unwraps the Nostr
owner key inside a dedicated signing worker. The plaintext key exists only in
browser memory and automatically locks after 15 minutes without signing or when
the page closes.

The first beta targets current Chrome, Edge, and Brave releases with WebAuthn
PRF support. Buzz feature-detects PRF and fails setup instead of silently using a
weaker password vault. WebAuthn support alone is not sufficient; the selected
passkey provider must return a PRF result.

Passkey providers may synchronize the credential to another computer. When a
provider, including Bitwarden's current browser-extension passkey provider,
does not return a PRF value to relying sites, choose **Use password manager or
recovery code**. Buzz decrypts the existing owner key locally using the
256-bit code; it does not send that code or the plaintext key to the relay.
Every browser still controls the same centralized channels and agents.

After unlocking, the owner can open **Settings → Profile → Encrypted owner
backup** to download a standard password-protected NIP-49 file. Encryption runs
inside the signing worker; Buzz does not upload the backup password, the file,
or the plaintext owner key. Store the file separately from its password.

## Channels and subscription agents

The first owner visit creates the same `general` and `welcome-everyone`
channels as Buzz Desktop. Use `/channels` to create rooms, send messages, and
mention centrally hosted agents after adding them to a channel.

For Codex or Claude Code, **Subscription** is the default authentication mode.
Create the agent, open the vendor sign-in link, enter the displayed device code
or paste Claude's confirmation code, and Buzz starts the agent after the vendor
CLI reports success. The login command runs as that agent's dedicated UID and
writes credentials only to its mode-`0700` data directory. API-key mode remains
available for both harnesses.

Changing `BUZZ_DOMAIN` changes the WebAuthn relying-party identity. Keep the
recovery code before changing domains, then use it to enroll a passkey on the
new domain after the deployment data has moved.

## Existing deployments

Bootstrap preserves an existing `owner_nsec` volume and continues configuring
its public key as the relay owner. Its next deployment log prints an owner setup
URL. Open that URL, paste the existing owner `nsec` once, and create a passkey
vault. A password-protected NIP-49 backup can be pasted or selected instead. The
key or encrypted backup is delivered to the local signing worker and is not
included in the claim request. A NIP-07 signer remains available as a
compatibility fallback until this enrollment is completed.

All service credentials are generated with the operating-system CSPRNG and kept
in named volumes. Re-deploying does not rotate them. Back up the Postgres and
service-secret volumes together, and keep the owner recovery code in a separate
password manager or offline location.

GitHub pushes to `main` publish `:main` and `:agent-main`; use matching immutable
`:sha-<commit>` and `:agent-sha-<commit>` tags after validating a deployment.

## Operator-installed ACP harnesses

The built-in image includes Buzz Agent, Codex, and Claude Code. An operator can
add another ACP adapter without giving the browser process-execution control:

1. Build an agent image derived from the matching Buzz agent image and install
   the adapter as a basename-only executable in `/usr/local/bin`.
2. Set `BUZZ_AGENT_IMAGE` to that image.
3. Set `BUZZ_AGENT_RUNTIME_CATALOG_JSON` to a compact JSON array describing the
   installed adapter.
4. Redeploy. The owner-only agent, persona, team, template, and defaults screens
   read the catalog automatically.

Example derivative image:

```dockerfile
FROM ghcr.io/physikal/buzz-web:agent-sha-<commit>
USER root
COPY --chmod=0755 example-acp /usr/local/bin/example-acp
USER buzz:buzz
```

Example Dokploy environment value (keep it on one line):

```text
BUZZ_AGENT_RUNTIME_CATALOG_JSON=[{"id":"example","label":"Example ACP","command":"example-acp","args":[],"model_env":"EXAMPLE_MODEL","model_required":true,"secret_fields":[{"env":"EXAMPLE_API_KEY","label":"Example API key","required":true}]}]
```

Owner-supplied arguments are disabled for custom harnesses by default. Add
`"allow_owner_args":true` only when that adapter's complete flag surface is an
acceptable capability for every Buzz owner.

The same Compose variable is injected into the relay and agent host. The relay
returns only the ID, label, model behavior, and credential prompts to an
authenticated owner. It never returns the command or fixed arguments. Runtime
IDs, executable basenames, fixed arguments, model variables, and secret fields
are strictly validated at both configuration and launch time. A malformed
catalog makes the catalog endpoint unavailable and does not authorize a custom
runtime.
