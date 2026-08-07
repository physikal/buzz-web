//! Centralized managed-agent persistence and fenced runner leases.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{error::Result, CommunityId};

/// Persisted agent configuration and current runner observation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedAgentHostRecord {
    /// Tenant boundary for this record.
    pub community_id: Uuid,
    /// Stable agent record id.
    pub id: Uuid,
    /// Dedicated operating-system identity for process and data isolation.
    #[serde(skip_serializing)]
    pub sandbox_uid: i64,
    /// Owning Nostr public key.
    pub owner_pubkey: String,
    /// Agent Nostr public key.
    pub agent_pubkey: String,
    /// Relay-synced persona definition this instance was deployed from.
    pub persona_id: Option<String>,
    /// Human-readable agent name.
    pub name: String,
    /// Instructions supplied to the harness as the agent system prompt.
    pub system_prompt: String,
    /// Allowlisted runtime id.
    pub runtime: String,
    /// Optional model override.
    pub model: Option<String>,
    /// Normalized LLM provider id for harnesses that expose one.
    pub provider: Option<String>,
    /// Fixed-runtime arguments passed without shell interpretation.
    pub agent_args: Vec<String>,
    /// Maximum number of concurrent harness subprocesses.
    pub parallelism: i16,
    /// Optional silence timeout for one turn.
    pub idle_timeout_seconds: Option<i64>,
    /// Optional absolute wall-clock cap for one turn.
    pub max_turn_duration_seconds: Option<i64>,
    /// Validated, non-secret runtime tuning values.
    pub runtime_config: serde_json::Map<String, serde_json::Value>,
    /// Provider credential source used by this runtime.
    pub credential_mode: String,
    /// Inbound author gate.
    pub respond_to: String,
    /// Pubkeys accepted by the allowlist gate.
    pub respond_to_allowlist: Vec<String>,
    /// Requested runner state.
    pub desired_state: String,
    /// Last state reported by the runner.
    pub observed_state: String,
    /// Current fenced lease generation.
    pub lease_epoch: i64,
    /// Process id reported by the active runner.
    pub runtime_pid: Option<i64>,
    /// Redacted operational failure message.
    pub last_error: Option<String>,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Last configuration or observation update.
    pub updated_at: DateTime<Utc>,
}

/// Encrypted material returned only to a runner holding the matching lease.
#[derive(Debug, Clone)]
pub struct ManagedAgentLease {
    /// Public record.
    pub record: ManagedAgentHostRecord,
    /// Envelope nonce.
    pub secret_nonce: Vec<u8>,
    /// Envelope ciphertext.
    pub secret_ciphertext: Vec<u8>,
}

/// Values needed to insert a managed agent.
pub struct NewManagedAgentHost<'a> {
    /// Agent id.
    pub id: Uuid,
    /// Owner public key.
    pub owner_pubkey: &'a str,
    /// Agent public key.
    pub agent_pubkey: &'a str,
    /// Optional source persona definition id.
    pub persona_id: Option<&'a str>,
    /// Display name.
    pub name: &'a str,
    /// Agent instructions.
    pub system_prompt: &'a str,
    /// Runtime id.
    pub runtime: &'a str,
    /// Model override.
    pub model: Option<&'a str>,
    /// Normalized provider id.
    pub provider: Option<&'a str>,
    /// Runtime arguments.
    pub agent_args: &'a [String],
    /// Harness subprocess parallelism.
    pub parallelism: i16,
    /// Optional silence timeout.
    pub idle_timeout_seconds: Option<i64>,
    /// Optional hard turn timeout.
    pub max_turn_duration_seconds: Option<i64>,
    /// Validated, non-secret tuning map.
    pub runtime_config: &'a serde_json::Map<String, serde_json::Value>,
    /// Provider credential source.
    pub credential_mode: &'a str,
    /// Initial requested runner state.
    pub desired_state: &'a str,
    /// Inbound author gate.
    pub respond_to: &'a str,
    /// Inbound allowlist.
    pub respond_to_allowlist: &'a [String],
    /// Envelope nonce.
    pub secret_nonce: &'a [u8],
    /// Envelope ciphertext.
    pub secret_ciphertext: &'a [u8],
}

/// Mutable configuration for an existing stopped managed agent.
pub struct UpdateManagedAgentHost<'a> {
    /// Display name.
    pub name: &'a str,
    /// Harness instructions.
    pub system_prompt: &'a str,
    /// Allowlisted runtime id.
    pub runtime: &'a str,
    /// Optional model override.
    pub model: Option<&'a str>,
    /// Normalized provider id.
    pub provider: Option<&'a str>,
    /// Runtime arguments.
    pub agent_args: &'a [String],
    /// Harness subprocess parallelism.
    pub parallelism: i16,
    /// Optional silence timeout.
    pub idle_timeout_seconds: Option<i64>,
    /// Optional hard turn timeout.
    pub max_turn_duration_seconds: Option<i64>,
    /// Validated, non-secret tuning map.
    pub runtime_config: &'a serde_json::Map<String, serde_json::Value>,
    /// Provider credential source.
    pub credential_mode: &'a str,
    /// Inbound author gate.
    pub respond_to: &'a str,
    /// Inbound allowlist.
    pub respond_to_allowlist: &'a [String],
    /// Fresh envelope nonce after the write-only secret payload is re-encrypted.
    pub secret_nonce: &'a [u8],
    /// Fresh encrypted secret payload.
    pub secret_ciphertext: &'a [u8],
}

fn row_to_record(row: &sqlx::postgres::PgRow) -> Result<ManagedAgentHostRecord> {
    let allowlist: serde_json::Value = row.try_get("respond_to_allowlist")?;
    let agent_args: serde_json::Value = row.try_get("agent_args")?;
    let runtime_config: serde_json::Value = row.try_get("runtime_config")?;
    Ok(ManagedAgentHostRecord {
        community_id: row.try_get("community_id")?,
        id: row.try_get("id")?,
        sandbox_uid: row.try_get("sandbox_uid")?,
        owner_pubkey: row.try_get("owner_pubkey")?,
        agent_pubkey: row.try_get("agent_pubkey")?,
        persona_id: row.try_get("persona_id")?,
        name: row.try_get("name")?,
        system_prompt: row.try_get("system_prompt")?,
        runtime: row.try_get("runtime")?,
        model: row.try_get("model")?,
        provider: row.try_get("provider")?,
        agent_args: serde_json::from_value(agent_args)?,
        parallelism: row.try_get("parallelism")?,
        idle_timeout_seconds: row.try_get("idle_timeout_seconds")?,
        max_turn_duration_seconds: row.try_get("max_turn_duration_seconds")?,
        runtime_config: serde_json::from_value(runtime_config)?,
        credential_mode: row.try_get("credential_mode")?,
        respond_to: row.try_get("respond_to")?,
        respond_to_allowlist: serde_json::from_value(allowlist)?,
        desired_state: row.try_get("desired_state")?,
        observed_state: row.try_get("observed_state")?,
        lease_epoch: row.try_get("lease_epoch")?,
        runtime_pid: row.try_get("runtime_pid")?,
        last_error: row.try_get("last_error")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

/// Insert an agent, its relay membership, and owner relationship atomically.
pub async fn create(
    pool: &PgPool,
    community: CommunityId,
    input: NewManagedAgentHost<'_>,
) -> Result<ManagedAgentHostRecord> {
    let owner_bytes = hex::decode(input.owner_pubkey)
        .map_err(|_| crate::error::DbError::InvalidData("invalid owner pubkey".into()))?;
    let agent_bytes = hex::decode(input.agent_pubkey)
        .map_err(|_| crate::error::DbError::InvalidData("invalid agent pubkey".into()))?;
    let allowlist = serde_json::to_value(input.respond_to_allowlist)?;
    let agent_args = serde_json::to_value(input.agent_args)?;
    let runtime_config = serde_json::to_value(input.runtime_config)?;
    let mut tx = pool.begin().await?;

    sqlx::query("INSERT INTO users (community_id, pubkey) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(community.as_uuid())
        .bind(&owner_bytes)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO users (community_id, pubkey, agent_owner_pubkey) VALUES ($1, $2, $3) \
         ON CONFLICT (community_id, pubkey) DO UPDATE SET agent_owner_pubkey = \
         COALESCE(users.agent_owner_pubkey, EXCLUDED.agent_owner_pubkey)",
    )
    .bind(community.as_uuid())
    .bind(&agent_bytes)
    .bind(&owner_bytes)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO relay_members (community_id, pubkey, role, added_by) \
         VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING",
    )
    .bind(community.as_uuid())
    .bind(input.agent_pubkey)
    .bind(input.owner_pubkey)
    .execute(&mut *tx)
    .await?;

    let row = sqlx::query(
        "INSERT INTO managed_agent_hosts \
         (community_id, id, owner_pubkey, agent_pubkey, persona_id, name, system_prompt, runtime, model, provider, agent_args, parallelism, \
          idle_timeout_seconds, max_turn_duration_seconds, runtime_config, credential_mode, respond_to, respond_to_allowlist, \
          secret_nonce, secret_ciphertext, desired_state, observed_state) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, \
          CASE WHEN $21 = 'stopped' THEN 'stopped' ELSE 'pending' END) RETURNING \
         community_id, id, sandbox_uid, owner_pubkey, agent_pubkey, persona_id, name, system_prompt, runtime, model, provider, \
         agent_args, parallelism, idle_timeout_seconds, max_turn_duration_seconds, runtime_config, credential_mode, respond_to, \
         respond_to_allowlist, desired_state, observed_state, lease_epoch, runtime_pid, \
         last_error, created_at, updated_at",
    )
        .bind(community.as_uuid())
        .bind(input.id)
        .bind(input.owner_pubkey)
        .bind(input.agent_pubkey)
        .bind(input.persona_id)
        .bind(input.name)
        .bind(input.system_prompt)
        .bind(input.runtime)
        .bind(input.model)
        .bind(input.provider)
        .bind(agent_args)
        .bind(input.parallelism)
        .bind(input.idle_timeout_seconds)
        .bind(input.max_turn_duration_seconds)
        .bind(runtime_config)
        .bind(input.credential_mode)
        .bind(input.respond_to)
        .bind(allowlist)
        .bind(input.secret_nonce)
        .bind(input.secret_ciphertext)
        .bind(input.desired_state)
        .fetch_one(&mut *tx)
        .await?;
    let record = row_to_record(&row)?;
    tx.commit().await?;
    Ok(record)
}

/// List agents owned by a principal in one community.
pub async fn list_owned(
    pool: &PgPool,
    community: CommunityId,
    owner_pubkey: &str,
) -> Result<Vec<ManagedAgentHostRecord>> {
    let rows = sqlx::query(
        "SELECT community_id, id, sandbox_uid, owner_pubkey, agent_pubkey, persona_id, name, system_prompt, runtime, model, provider, agent_args, parallelism, idle_timeout_seconds, max_turn_duration_seconds, runtime_config, credential_mode, respond_to, \
         respond_to_allowlist, desired_state, observed_state, lease_epoch, runtime_pid, \
         last_error, created_at, updated_at FROM managed_agent_hosts \
         WHERE community_id = $1 AND owner_pubkey = $2 ORDER BY created_at",
    )
        .bind(community.as_uuid())
        .bind(owner_pubkey)
        .fetch_all(pool)
        .await?;
    rows.iter().map(row_to_record).collect()
}

/// List the distinct model ids required by desired-running relay-mesh agents.
///
/// This is an internal recovery view: it deliberately returns no owner,
/// credential, prompt, or agent identity fields.
pub async fn list_running_relay_mesh_models(
    pool: &PgPool,
    community: CommunityId,
) -> Result<Vec<String>> {
    let rows = sqlx::query(
        "SELECT DISTINCT COALESCE(NULLIF(BTRIM(model), ''), 'auto') AS model_id \
         FROM managed_agent_hosts \
         WHERE community_id = $1 AND desired_state = 'running' \
           AND BTRIM(runtime) = 'buzz-agent' AND BTRIM(provider) = 'relay-mesh' \
         ORDER BY model_id LIMIT 64",
    )
    .bind(community.as_uuid())
    .fetch_all(pool)
    .await?;
    let mut models = Vec::with_capacity(rows.len());
    for row in rows {
        models.push(row.try_get("model_id")?);
    }
    Ok(models)
}

/// Load an owned agent without returning encrypted secret columns.
pub async fn get_owned(
    pool: &PgPool,
    community: CommunityId,
    owner_pubkey: &str,
    id: Uuid,
) -> Result<Option<ManagedAgentHostRecord>> {
    let row = sqlx::query(
        "SELECT community_id, id, sandbox_uid, owner_pubkey, agent_pubkey, persona_id, name, system_prompt, runtime, model, provider, agent_args, parallelism, idle_timeout_seconds, max_turn_duration_seconds, runtime_config, credential_mode, respond_to, \
         respond_to_allowlist, desired_state, observed_state, lease_epoch, runtime_pid, \
         last_error, created_at, updated_at FROM managed_agent_hosts \
         WHERE community_id = $1 AND owner_pubkey = $2 AND id = $3",
    )
    .bind(community.as_uuid())
    .bind(owner_pubkey)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.as_ref().map(row_to_record).transpose()
}

/// Load an owned agent together with its encrypted envelope for a control-plane update.
pub async fn get_owned_with_secret(
    pool: &PgPool,
    community: CommunityId,
    owner_pubkey: &str,
    id: Uuid,
) -> Result<Option<ManagedAgentLease>> {
    let row = sqlx::query(
        "SELECT community_id, id, sandbox_uid, owner_pubkey, agent_pubkey, persona_id, name, system_prompt, runtime, model, provider, agent_args, parallelism, idle_timeout_seconds, max_turn_duration_seconds, runtime_config, credential_mode, respond_to, \
         respond_to_allowlist, desired_state, observed_state, lease_epoch, runtime_pid, \
         last_error, created_at, updated_at, secret_nonce, secret_ciphertext FROM managed_agent_hosts \
         WHERE community_id = $1 AND owner_pubkey = $2 AND id = $3",
    )
    .bind(community.as_uuid())
    .bind(owner_pubkey)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.as_ref()
        .map(|row| {
            Ok(ManagedAgentLease {
                record: row_to_record(row)?,
                secret_nonce: row.try_get("secret_nonce")?,
                secret_ciphertext: row.try_get("secret_ciphertext")?,
            })
        })
        .transpose()
}

/// Update a stopped, unleased agent without exposing its credential envelope.
pub async fn update_owned(
    pool: &PgPool,
    community: CommunityId,
    owner_pubkey: &str,
    id: Uuid,
    input: UpdateManagedAgentHost<'_>,
) -> Result<Option<ManagedAgentHostRecord>> {
    let allowlist = serde_json::to_value(input.respond_to_allowlist)?;
    let agent_args = serde_json::to_value(input.agent_args)?;
    let runtime_config = serde_json::to_value(input.runtime_config)?;
    let row = sqlx::query(
        "UPDATE managed_agent_hosts SET name = $1, system_prompt = $2, runtime = $3, model = $4, provider = $5, \
         agent_args = $6, parallelism = $7, idle_timeout_seconds = $8, max_turn_duration_seconds = $9, \
         runtime_config = $10, credential_mode = $11, respond_to = $12, respond_to_allowlist = $13, secret_nonce = $14, \
         secret_ciphertext = $15, last_error = NULL, updated_at = NOW() \
         WHERE community_id = $16 AND owner_pubkey = $17 AND id = $18 \
           AND desired_state = 'stopped' AND lease_expires_at IS NULL \
         RETURNING community_id, id, sandbox_uid, owner_pubkey, agent_pubkey, persona_id, name, system_prompt, runtime, model, provider, agent_args, parallelism, idle_timeout_seconds, max_turn_duration_seconds, runtime_config, credential_mode, respond_to, \
         respond_to_allowlist, desired_state, observed_state, lease_epoch, runtime_pid, last_error, created_at, updated_at",
    )
    .bind(input.name)
    .bind(input.system_prompt)
    .bind(input.runtime)
    .bind(input.model)
    .bind(input.provider)
    .bind(agent_args)
    .bind(input.parallelism)
    .bind(input.idle_timeout_seconds)
    .bind(input.max_turn_duration_seconds)
    .bind(runtime_config)
    .bind(input.credential_mode)
    .bind(input.respond_to)
    .bind(allowlist)
    .bind(input.secret_nonce)
    .bind(input.secret_ciphertext)
    .bind(community.as_uuid())
    .bind(owner_pubkey)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.as_ref().map(row_to_record).transpose()
}

/// Load an agent for the internal host control service.
pub async fn get(
    pool: &PgPool,
    community: CommunityId,
    id: Uuid,
) -> Result<Option<ManagedAgentHostRecord>> {
    let row = sqlx::query(
        "SELECT community_id, id, sandbox_uid, owner_pubkey, agent_pubkey, persona_id, name, system_prompt, runtime, model, provider, agent_args, parallelism, idle_timeout_seconds, max_turn_duration_seconds, runtime_config, credential_mode, respond_to, \
         respond_to_allowlist, desired_state, observed_state, lease_epoch, runtime_pid, \
         last_error, created_at, updated_at FROM managed_agent_hosts \
         WHERE community_id = $1 AND id = $2",
    )
    .bind(community.as_uuid())
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.as_ref().map(row_to_record).transpose()
}

/// Set desired state for an owned agent.
pub async fn set_desired_state(
    pool: &PgPool,
    community: CommunityId,
    owner_pubkey: &str,
    id: Uuid,
    desired_state: &str,
) -> Result<Option<ManagedAgentHostRecord>> {
    let row = sqlx::query(
        "UPDATE managed_agent_hosts SET desired_state = $1, updated_at = NOW(), \
         observed_state = CASE \
             WHEN $1 = 'running' AND observed_state IN ('stopped','error') THEN 'pending' \
             WHEN $1 = 'stopped' AND lease_owner IS NULL THEN 'stopped' \
             WHEN $1 = 'stopped' AND observed_state IN ('pending','starting','running') THEN 'stopping' \
             ELSE observed_state END \
         WHERE community_id = $2 AND owner_pubkey = $3 AND id = $4 RETURNING \
         community_id, id, sandbox_uid, owner_pubkey, agent_pubkey, persona_id, name, system_prompt, runtime, model, provider, agent_args, parallelism, idle_timeout_seconds, max_turn_duration_seconds, runtime_config, credential_mode, respond_to, \
         respond_to_allowlist, desired_state, observed_state, lease_epoch, runtime_pid, \
         last_error, created_at, updated_at",
    )
        .bind(desired_state)
        .bind(community.as_uuid())
        .bind(owner_pubkey)
        .bind(id)
        .fetch_optional(pool)
        .await?;
    row.as_ref().map(row_to_record).transpose()
}

/// Delete an owned agent only after it is stopped and unleased.
pub async fn delete_owned(
    pool: &PgPool,
    community: CommunityId,
    owner_pubkey: &str,
    id: Uuid,
) -> Result<Option<String>> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "DELETE FROM managed_agent_hosts WHERE community_id = $1 AND owner_pubkey = $2 \
         AND id = $3 AND desired_state = 'stopped' AND lease_expires_at IS NULL \
         RETURNING agent_pubkey",
    )
    .bind(community.as_uuid())
    .bind(owner_pubkey)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        tx.rollback().await?;
        return Ok(None);
    };
    let agent_pubkey: String = row.get("agent_pubkey");
    sqlx::query(
        "DELETE FROM relay_members WHERE community_id = $1 AND pubkey = $2 AND role = 'member'",
    )
    .bind(community.as_uuid())
    .bind(&agent_pubkey)
    .execute(&mut *tx)
    .await?;
    let agent_bytes = hex::decode(&agent_pubkey)
        .map_err(|_| crate::error::DbError::InvalidData("invalid stored agent pubkey".into()))?;
    sqlx::query(
        "UPDATE users SET deactivated_at = NOW(), updated_at = NOW() \
         WHERE community_id = $1 AND pubkey = $2",
    )
    .bind(community.as_uuid())
    .bind(agent_bytes)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Some(agent_pubkey))
}

/// Claim one runnable agent with an expiring, monotonically fenced lease.
pub async fn claim_next(
    pool: &PgPool,
    runner_id: Uuid,
    lease_seconds: i64,
) -> Result<Option<ManagedAgentLease>> {
    let row = sqlx::query(
        "WITH candidate AS ( \
           SELECT community_id, id FROM managed_agent_hosts \
           WHERE desired_state = 'running' \
             AND (lease_expires_at IS NULL OR lease_expires_at < NOW()) \
           ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1 \
         ) UPDATE managed_agent_hosts a SET lease_owner = $1, lease_epoch = lease_epoch + 1, \
           lease_expires_at = NOW() + make_interval(secs => $2), observed_state = 'starting', \
           last_error = NULL, updated_at = NOW() FROM candidate c \
         WHERE a.community_id = c.community_id AND a.id = c.id \
         RETURNING a.community_id, a.id, a.sandbox_uid, a.owner_pubkey, a.agent_pubkey, a.persona_id, a.name, a.runtime, \
         a.system_prompt, a.model, a.provider, a.agent_args, a.parallelism, a.idle_timeout_seconds, a.max_turn_duration_seconds, \
         a.runtime_config, a.credential_mode, a.respond_to, a.respond_to_allowlist, a.desired_state, a.observed_state, \
         a.lease_epoch, a.runtime_pid, a.last_error, a.created_at, a.updated_at, \
         a.secret_nonce, a.secret_ciphertext",
    )
        .bind(runner_id)
        .bind(lease_seconds as f64)
        .fetch_optional(pool)
        .await?;
    row.as_ref()
        .map(|row| {
            Ok(ManagedAgentLease {
                record: row_to_record(row)?,
                secret_nonce: row.try_get("secret_nonce")?,
                secret_ciphertext: row.try_get("secret_ciphertext")?,
            })
        })
        .transpose()
}

/// Renew a lease and publish the runner's current observation.
#[allow(clippy::too_many_arguments)]
pub async fn renew_lease(
    pool: &PgPool,
    community: CommunityId,
    id: Uuid,
    runner_id: Uuid,
    lease_epoch: i64,
    lease_seconds: i64,
    observed_state: &str,
    runtime_pid: Option<i64>,
) -> Result<bool> {
    let result = sqlx::query(
        "UPDATE managed_agent_hosts SET lease_expires_at = NOW() + make_interval(secs => $1), \
         observed_state = $2, runtime_pid = $3, updated_at = NOW() \
         WHERE community_id = $4 AND id = $5 AND lease_owner = $6 AND lease_epoch = $7 \
           AND desired_state = 'running'",
    )
    .bind(lease_seconds as f64)
    .bind(observed_state)
    .bind(runtime_pid)
    .bind(community.as_uuid())
    .bind(id)
    .bind(runner_id)
    .bind(lease_epoch)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// Release a lease and publish a terminal observation.
pub async fn release_lease(
    pool: &PgPool,
    community: CommunityId,
    id: Uuid,
    runner_id: Uuid,
    lease_epoch: i64,
    observed_state: &str,
    last_error: Option<&str>,
) -> Result<bool> {
    let result = sqlx::query(
        "UPDATE managed_agent_hosts SET lease_owner = NULL, lease_expires_at = NULL, \
         observed_state = $1, desired_state = CASE WHEN $1 = 'error' THEN 'stopped' \
             ELSE desired_state END, runtime_pid = NULL, last_error = $2, updated_at = NOW() \
         WHERE community_id = $3 AND id = $4 AND lease_owner = $5 AND lease_epoch = $6",
    )
    .bind(observed_state)
    .bind(last_error)
    .bind(community.as_uuid())
    .bind(id)
    .bind(runner_id)
    .bind(lease_epoch)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() == 1)
}
