-- Owner-only ciphertext journal for hosted-agent observer telemetry.
--
-- These rows are deliberately separate from the general Nostr event/search
-- tables. The relay stores the already end-to-end encrypted signed envelope;
-- only the owner signer can decrypt it in a client.

CREATE TABLE managed_agent_observer_events (
    community_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    event_id BYTEA NOT NULL CHECK (octet_length(event_id) = 32),
    created_at TIMESTAMPTZ NOT NULL,
    event_json JSONB NOT NULL CHECK (jsonb_typeof(event_json) = 'object'),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (community_id, agent_id, event_id),
    FOREIGN KEY (community_id, agent_id)
        REFERENCES managed_agent_hosts (community_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_managed_agent_observer_events_recent
    ON managed_agent_observer_events
    (community_id, agent_id, created_at DESC, event_id DESC);

ALTER TABLE managed_agent_hosts
    ADD COLUMN observer_archive_trimmed_at TIMESTAMPTZ NOT NULL DEFAULT 'epoch';
