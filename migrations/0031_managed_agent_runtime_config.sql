-- Persist advanced hosted-agent settings separately from the encrypted,
-- write-only credential envelope. The agent host maps these normalized fields
-- to a fixed environment allowlist; none are executable names or raw env keys.

ALTER TABLE managed_agent_hosts
    ADD COLUMN provider VARCHAR(64),
    ADD COLUMN agent_args JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN parallelism SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN idle_timeout_seconds BIGINT,
    ADD COLUMN max_turn_duration_seconds BIGINT,
    ADD COLUMN runtime_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT chk_managed_agent_provider
        CHECK (provider IS NULL OR provider ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
    ADD CONSTRAINT chk_managed_agent_agent_args_array
        CHECK (jsonb_typeof(agent_args) = 'array'),
    ADD CONSTRAINT chk_managed_agent_parallelism
        CHECK (parallelism BETWEEN 1 AND 32),
    ADD CONSTRAINT chk_managed_agent_idle_timeout
        CHECK (idle_timeout_seconds IS NULL OR idle_timeout_seconds BETWEEN 1 AND 604799),
    ADD CONSTRAINT chk_managed_agent_max_turn_duration
        CHECK (max_turn_duration_seconds IS NULL OR max_turn_duration_seconds BETWEEN 2 AND 604800),
    ADD CONSTRAINT chk_managed_agent_timeout_order
        CHECK (idle_timeout_seconds IS NULL OR max_turn_duration_seconds IS NULL
               OR idle_timeout_seconds < max_turn_duration_seconds),
    ADD CONSTRAINT chk_managed_agent_runtime_config_object
        CHECK (jsonb_typeof(runtime_config) = 'object');
