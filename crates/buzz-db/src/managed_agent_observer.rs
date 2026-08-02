//! Bounded ciphertext history for centrally hosted agent observer frames.

use chrono::{DateTime, Duration, Utc};
use nostr::Event;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{CommunityId, Result};

const MAX_EVENTS_PER_AGENT: i64 = 10_000;
const MAX_AGE_DAYS: i64 = 30;
const TRIM_INTERVAL_SECONDS: i64 = 10;

/// Archive a signed, encrypted telemetry envelope for a hosted agent.
pub async fn archive(
    pool: &PgPool,
    community: CommunityId,
    agent_pubkey: &str,
    owner_pubkey: &str,
    event: &Event,
) -> Result<bool> {
    let created_at = DateTime::from_timestamp(event.created_at.as_secs() as i64, 0)
        .ok_or_else(|| crate::DbError::InvalidData("invalid observer timestamp".into()))?;
    let event_json = serde_json::to_value(event)?;
    let mut tx = pool.begin().await?;
    let inserted_agent: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO managed_agent_observer_events \
         (community_id, agent_id, event_id, created_at, event_json) \
         SELECT community_id, id, $4, $5, $6 FROM managed_agent_hosts \
         WHERE community_id=$1 AND agent_pubkey=$2 AND owner_pubkey=$3 \
         ON CONFLICT DO NOTHING RETURNING agent_id",
    )
    .bind(community.as_uuid())
    .bind(agent_pubkey)
    .bind(owner_pubkey)
    .bind(event.id.as_bytes().as_slice())
    .bind(created_at)
    .bind(event_json)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(agent_id) = inserted_agent else {
        tx.commit().await?;
        return Ok(false);
    };

    let should_trim: Option<bool> = sqlx::query_scalar(
        "UPDATE managed_agent_hosts SET observer_archive_trimmed_at=NOW() \
         WHERE community_id=$1 AND id=$2 \
           AND observer_archive_trimmed_at < NOW() - make_interval(secs => $3) \
         RETURNING true",
    )
    .bind(community.as_uuid())
    .bind(agent_id)
    .bind(TRIM_INTERVAL_SECONDS as f64)
    .fetch_optional(&mut *tx)
    .await?;
    if should_trim.is_some() {
        let cutoff = Utc::now() - Duration::days(MAX_AGE_DAYS);
        sqlx::query(
            "DELETE FROM managed_agent_observer_events archived \
             WHERE archived.community_id=$1 AND archived.agent_id=$2 AND ( \
               archived.created_at < $3 OR archived.event_id IN ( \
                 SELECT event_id FROM managed_agent_observer_events \
                 WHERE community_id=$1 AND agent_id=$2 \
                 ORDER BY created_at DESC, event_id DESC \
                 OFFSET $4 \
               ) \
             )",
        )
        .bind(community.as_uuid())
        .bind(agent_id)
        .bind(cutoff)
        .bind(MAX_EVENTS_PER_AGENT)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(true)
}

/// Return the newest archived envelopes for one owner-controlled agent.
pub async fn list_owned(
    pool: &PgPool,
    community: CommunityId,
    owner_pubkey: &str,
    agent_id: Uuid,
    limit: i64,
    max_bytes: i64,
) -> Result<Vec<Value>> {
    let events = sqlx::query_scalar(
        "SELECT event_json FROM ( \
           SELECT observer.event_json, observer.created_at, observer.event_id, \
                  sum(pg_column_size(observer.event_json)) OVER ( \
                    ORDER BY observer.created_at DESC, observer.event_id DESC \
                  ) AS cumulative_bytes \
           FROM managed_agent_observer_events observer \
           JOIN managed_agent_hosts agent \
             ON agent.community_id=observer.community_id AND agent.id=observer.agent_id \
           WHERE observer.community_id=$1 AND observer.agent_id=$2 AND agent.owner_pubkey=$3 \
           ORDER BY observer.created_at DESC, observer.event_id DESC LIMIT $4 \
         ) bounded WHERE cumulative_bytes <= $5 \
         ORDER BY created_at DESC, event_id DESC",
    )
    .bind(community.as_uuid())
    .bind(agent_id)
    .bind(owner_pubkey)
    .bind(limit)
    .bind(max_bytes)
    .fetch_all(pool)
    .await?;
    Ok(events)
}

/// Apply the global age limit and per-agent row cap in one bounded sweep.
pub async fn reap(pool: &PgPool, max_age: Duration, max_per_agent: i64) -> Result<u64> {
    let cutoff = Utc::now() - max_age;
    let deleted = sqlx::query(
        "WITH expired AS ( \
           SELECT community_id, agent_id, event_id FROM ( \
             SELECT community_id, agent_id, event_id, created_at, \
                    row_number() OVER (PARTITION BY community_id, agent_id \
                                       ORDER BY created_at DESC, event_id DESC) AS row_number \
             FROM managed_agent_observer_events \
           ) ranked WHERE created_at < $1 OR row_number > $2 \
         ) \
         DELETE FROM managed_agent_observer_events archived USING expired \
         WHERE archived.community_id=expired.community_id \
           AND archived.agent_id=expired.agent_id \
           AND archived.event_id=expired.event_id",
    )
    .bind(cutoff)
    .bind(max_per_agent)
    .execute(pool)
    .await?;
    Ok(deleted.rows_affected())
}
