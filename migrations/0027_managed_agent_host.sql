-- Centralized, server-owned managed-agent desired state.
--
-- Secrets are encrypted by the control plane before they reach this table.
-- The runner is the only other component with the envelope key needed to
-- decrypt them. Runtime leases are fenced so multiple runner replicas cannot
-- concurrently launch the same Nostr identity.

CREATE SEQUENCE managed_agent_sandbox_uid_seq AS BIGINT START WITH 11000;

CREATE TABLE managed_agent_hosts (
    community_id       UUID NOT NULL REFERENCES communities(id),
    id                 UUID NOT NULL DEFAULT gen_random_uuid(),
    sandbox_uid        BIGINT NOT NULL DEFAULT nextval('managed_agent_sandbox_uid_seq'),
    owner_pubkey       TEXT NOT NULL,
    agent_pubkey       TEXT NOT NULL,
    name               VARCHAR(120) NOT NULL,
    system_prompt      TEXT NOT NULL DEFAULT '',
    runtime            TEXT NOT NULL CHECK (runtime IN ('buzz-agent', 'codex', 'claude')),
    model               VARCHAR(255),
    respond_to          TEXT NOT NULL DEFAULT 'owner-only'
                        CHECK (respond_to IN ('owner-only', 'allowlist', 'anyone')),
    respond_to_allowlist JSONB NOT NULL DEFAULT '[]'::jsonb,
    secret_nonce        BYTEA NOT NULL,
    secret_ciphertext   BYTEA NOT NULL,
    desired_state       TEXT NOT NULL DEFAULT 'running'
                        CHECK (desired_state IN ('running', 'stopped')),
    observed_state      TEXT NOT NULL DEFAULT 'pending'
                        CHECK (observed_state IN ('pending', 'starting', 'running', 'stopping', 'stopped', 'error')),
    lease_owner         UUID,
    lease_epoch         BIGINT NOT NULL DEFAULT 0,
    lease_expires_at    TIMESTAMPTZ,
    runtime_pid         BIGINT,
    last_error          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (community_id, id),
    UNIQUE (sandbox_uid),
    UNIQUE (community_id, agent_pubkey),
    UNIQUE (community_id, owner_pubkey, name),
    CONSTRAINT chk_managed_agent_owner_pubkey CHECK (owner_pubkey ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_managed_agent_pubkey CHECK (agent_pubkey ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_managed_agent_sandbox_uid CHECK (sandbox_uid BETWEEN 11000 AND 2147483646),
    CONSTRAINT chk_managed_agent_allowlist_array CHECK (jsonb_typeof(respond_to_allowlist) = 'array')
);

ALTER SEQUENCE managed_agent_sandbox_uid_seq OWNED BY managed_agent_hosts.sandbox_uid;

CREATE INDEX idx_managed_agent_hosts_owner
    ON managed_agent_hosts (community_id, owner_pubkey, created_at);

CREATE INDEX idx_managed_agent_hosts_reconcile
    ON managed_agent_hosts (desired_state, lease_expires_at)
    WHERE desired_state = 'running';
