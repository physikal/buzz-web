-- Passkey-wrapped owner vault for the browser console.
--
-- The plaintext Nostr secret and WebAuthn PRF output never reach Postgres.
-- Every ciphertext wraps one 32-byte Nostr secret with AES-256-GCM, whose
-- 16-byte authentication tag is included in the 48-byte ciphertext.

CREATE TABLE owner_web_vaults (
    community_id               UUID NOT NULL PRIMARY KEY REFERENCES communities(id) ON DELETE CASCADE,
    owner_pubkey               TEXT NOT NULL,
    recovery_kdf_salt          BYTEA NOT NULL CHECK (octet_length(recovery_kdf_salt) = 32),
    recovery_nonce             BYTEA NOT NULL CHECK (octet_length(recovery_nonce) = 12),
    recovery_ciphertext        BYTEA NOT NULL CHECK (octet_length(recovery_ciphertext) = 48),
    format_version             SMALLINT NOT NULL DEFAULT 1 CHECK (format_version = 1),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_owner_web_vault_pubkey CHECK (owner_pubkey ~ '^[0-9a-f]{64}$')
);

CREATE TABLE owner_web_credentials (
    community_id               UUID NOT NULL,
    credential_id              BYTEA NOT NULL CHECK (
        octet_length(credential_id) BETWEEN 16 AND 1024
    ),
    label                      VARCHAR(120) NOT NULL DEFAULT 'Passkey',
    prf_input                  BYTEA NOT NULL CHECK (octet_length(prf_input) = 32),
    kdf_salt                   BYTEA NOT NULL CHECK (octet_length(kdf_salt) = 32),
    wrap_nonce                 BYTEA NOT NULL CHECK (octet_length(wrap_nonce) = 12),
    wrapped_nsec               BYTEA NOT NULL CHECK (octet_length(wrapped_nsec) = 48),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at               TIMESTAMPTZ,
    PRIMARY KEY (community_id, credential_id),
    FOREIGN KEY (community_id) REFERENCES owner_web_vaults(community_id) ON DELETE CASCADE
);
