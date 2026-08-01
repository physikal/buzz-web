-- Record whether a runtime uses an encrypted API key or the vendor CLI's
-- subscription login. Subscription agents are created stopped so the login
-- ceremony can complete in their isolated home before a runner starts.

ALTER TABLE managed_agent_hosts
    ADD COLUMN credential_mode TEXT NOT NULL DEFAULT 'api-key'
        CHECK (credential_mode IN ('api-key', 'subscription'));
