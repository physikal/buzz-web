-- Runtime availability is enforced by the deployment-owned catalog in both
-- the relay and agent host. Keep only the bounded identifier shape in storage
-- so operator-installed runtimes do not require a schema migration.

ALTER TABLE managed_agent_hosts
    DROP CONSTRAINT managed_agent_hosts_runtime_check;

ALTER TABLE managed_agent_hosts
    ADD CONSTRAINT managed_agent_hosts_runtime_check
    CHECK (runtime ~ '^[a-z0-9][a-z0-9_-]{0,63}$');
