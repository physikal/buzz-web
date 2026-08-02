-- Keep hosted instances linked to their relay-synced persona definitions.
-- This is non-authoritative metadata used for portable team snapshots; it is
-- intentionally nullable for direct-created and pre-migration agents.

ALTER TABLE managed_agent_hosts
    ADD COLUMN persona_id TEXT
        CHECK (persona_id IS NULL OR persona_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$');

CREATE INDEX managed_agent_hosts_persona_idx
    ON managed_agent_hosts (community_id, owner_pubkey, persona_id)
    WHERE persona_id IS NOT NULL;
