//! Owner-authenticated centralized agent control API.

use std::{collections::BTreeMap, sync::Arc};

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use buzz_agent_host::{
    decrypt_secret, derive_control_token, encrypt_secret, parse_envelope_key,
    public_runtime_catalog, runtime_allows_secret_env, runtime_command, runtime_config_env_name,
    runtime_model_required, AgentSecretPayload,
};
use buzz_core::TenantContext;
use nostr::{EventBuilder, JsonUtil, Keys, Kind, Tag, ToBech32};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{api_error, bridge};
use crate::state::AppState;

const MAX_NAME_LEN: usize = 120;
const MAX_SYSTEM_PROMPT_LEN: usize = 128 * 1024;
const MAX_MODEL_LEN: usize = 255;
const MAX_AGENT_ARGS: usize = 32;
const MAX_AGENT_ARG_LEN: usize = 1024;
const MAX_RUNTIME_CONFIG_ENTRIES: usize = 16;
const MAX_RUNTIME_CONFIG_VALUE_LEN: usize = 2048;
const MAX_SECRET_COUNT: usize = 32;
const MAX_SECRET_VALUE_LEN: usize = 16 * 1024;
const MAX_OBSERVER_HISTORY_EVENTS: i64 = 3_000;
const MAX_OBSERVER_HISTORY_BYTES: i64 = 8 * 1024 * 1024;

/// Owner-supplied configuration for one centrally hosted agent.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateAgentRequest {
    name: String,
    #[serde(default)]
    persona_id: Option<String>,
    #[serde(default)]
    system_prompt: String,
    runtime: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    agent_args: Vec<String>,
    #[serde(default = "default_parallelism")]
    parallelism: u8,
    #[serde(default)]
    idle_timeout_seconds: Option<u64>,
    #[serde(default)]
    max_turn_duration_seconds: Option<u64>,
    #[serde(default)]
    runtime_config: BTreeMap<String, String>,
    #[serde(default = "default_respond_to")]
    respond_to: String,
    #[serde(default)]
    respond_to_allowlist: Vec<String>,
    #[serde(default)]
    secrets: BTreeMap<String, String>,
    #[serde(default = "default_credential_mode")]
    credential_mode: String,
    #[serde(default = "default_start_immediately")]
    start_immediately: bool,
}

/// Owner-supplied replacement configuration. Omitted fields retain their value;
/// omitted secrets retain the existing write-only credential envelope.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateAgentRequest {
    name: Option<String>,
    system_prompt: Option<String>,
    runtime: Option<String>,
    model: Option<Option<String>>,
    provider: Option<Option<String>>,
    agent_args: Option<Vec<String>>,
    parallelism: Option<u8>,
    idle_timeout_seconds: Option<Option<u64>>,
    max_turn_duration_seconds: Option<Option<u64>>,
    runtime_config: Option<BTreeMap<String, String>>,
    respond_to: Option<String>,
    respond_to_allowlist: Option<Vec<String>>,
    secrets: Option<BTreeMap<String, String>>,
    credential_mode: Option<String>,
}

fn default_respond_to() -> String {
    "owner-only".into()
}

fn default_credential_mode() -> String {
    "api-key".into()
}

const fn default_start_immediately() -> bool {
    true
}

const fn default_parallelism() -> u8 {
    1
}

pub(crate) async fn authorize_owner(
    state: &AppState,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
    require_payload: bool,
) -> Result<(TenantContext, nostr::PublicKey), (StatusCode, Json<Value>)> {
    let raw_host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let tenant = crate::tenant::bind_community(&state.db, raw_host)
        .await
        .map_err(|_| api_error(StatusCode::NOT_FOUND, "community not found"))?;
    let expected_url = bridge::nip98_expected_url(&state.config.relay_url, &tenant, path);
    let (pubkey, event_id) = bridge::verify_bridge_auth_with_options(
        headers,
        method,
        &expected_url,
        body,
        true,
        require_payload,
    )?;
    bridge::check_nip98_replay(state, &tenant, event_id).await?;
    let member = state
        .db
        .get_relay_member(tenant.community(), &pubkey.to_hex())
        .await
        .map_err(|error| {
            tracing::error!(%error, "agent owner lookup failed");
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        })?;
    if member.is_none_or(|member| member.role != "owner") {
        return Err(api_error(StatusCode::FORBIDDEN, "owner access required"));
    }
    Ok((tenant, pubkey))
}

/// Return the caller's centralized agents without exposing encrypted columns.
pub async fn list_agents(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (tenant, owner) =
        authorize_owner(&state, &headers, "GET", "/api/agents", None, false).await?;
    let agents = state
        .db
        .list_managed_agent_hosts(tenant.community(), &owner.to_hex())
        .await
        .map_err(|error| {
            tracing::error!(%error, "managed-agent list failed");
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        })?;
    Ok(Json(json!({ "agents": agents })))
}

/// Return the deployment-owned harness catalog without exposing executable
/// names, paths, fixed arguments, or credential values.
pub async fn list_runtimes(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    authorize_owner(&state, &headers, "GET", "/api/agents/runtimes", None, false).await?;
    let runtimes = public_runtime_catalog().map_err(|error| {
        tracing::error!(%error, "managed-agent runtime catalog is invalid");
        api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "agent runtime catalog is unavailable",
        )
    })?;
    Ok(Json(json!({ "runtimes": runtimes })))
}

/// Mint an agent identity, encrypt its secrets, and register desired state.
pub async fn create_agent(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let (tenant, owner) =
        authorize_owner(&state, &headers, "POST", "/api/agents", Some(&body), true).await?;
    let input: CreateAgentRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid request body"))?;
    validate_create(&input)?;
    let CreateAgentRequest {
        name,
        persona_id,
        system_prompt,
        runtime,
        model,
        provider,
        agent_args,
        parallelism,
        idle_timeout_seconds,
        max_turn_duration_seconds,
        runtime_config,
        respond_to,
        respond_to_allowlist,
        secrets,
        credential_mode,
        start_immediately,
    } = input;
    let runtime_config_json = runtime_config
        .iter()
        .map(|(key, value)| (key.clone(), Value::String(value.clone())))
        .collect::<serde_json::Map<String, Value>>();

    let envelope_key = std::env::var("BUZZ_AGENT_SECRET_KEY")
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "agent hosting is not configured",
            )
        })
        .and_then(|value| {
            parse_envelope_key(&value).map_err(|_| {
                api_error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "agent hosting is not configured",
                )
            })
        })?;
    let id = Uuid::new_v4();
    let keys = Keys::generate();
    let nsec = keys.secret_key().to_bech32().map_err(|_| {
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "agent identity generation failed",
        )
    })?;
    let agent_pubkey = keys.public_key().to_hex();
    let encrypted = encrypt_secret(
        &envelope_key,
        *tenant.community().as_uuid(),
        id,
        AgentSecretPayload {
            private_key_nsec: nsec,
            env: secrets,
        },
    )
    .map_err(|error| {
        tracing::error!(%error, "agent secret encryption failed");
        api_error(StatusCode::INTERNAL_SERVER_ERROR, "agent creation failed")
    })?;

    let owner_pubkey = owner.to_hex();
    let record = state
        .db
        .create_managed_agent_host(
            tenant.community(),
            buzz_db::managed_agent_host::NewManagedAgentHost {
                id,
                owner_pubkey: &owner_pubkey,
                agent_pubkey: &agent_pubkey,
                persona_id: persona_id.as_deref(),
                name: name.trim(),
                system_prompt: system_prompt.trim(),
                runtime: &runtime,
                model: model.as_deref().map(str::trim),
                provider: provider.as_deref().map(str::trim),
                agent_args: &agent_args,
                parallelism: i16::from(parallelism),
                idle_timeout_seconds: idle_timeout_seconds.map(|value| value as i64),
                max_turn_duration_seconds: max_turn_duration_seconds.map(|value| value as i64),
                runtime_config: &runtime_config_json,
                credential_mode: &credential_mode,
                desired_state: if credential_mode == "subscription" || !start_immediately {
                    "stopped"
                } else {
                    "running"
                },
                respond_to: &respond_to,
                respond_to_allowlist: &respond_to_allowlist,
                secret_nonce: &encrypted.nonce,
                secret_ciphertext: &encrypted.ciphertext,
            },
        )
        .await
        .map_err(|error| {
            tracing::warn!(%error, "managed-agent create failed");
            api_error(
                StatusCode::CONFLICT,
                "agent name or identity already exists",
            )
        })?;
    Ok((StatusCode::CREATED, Json(json!({ "agent": record }))))
}

/// Replace mutable configuration for a stopped agent while keeping credentials write-only.
pub async fn update_agent(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/agents/{id}");
    let (tenant, owner) =
        authorize_owner(&state, &headers, "PATCH", &path, Some(&body), true).await?;
    let input: UpdateAgentRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid request body"))?;
    let envelope_key = std::env::var("BUZZ_AGENT_SECRET_KEY")
        .ok()
        .and_then(|value| parse_envelope_key(&value).ok())
        .ok_or_else(|| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "agent hosting is not configured",
            )
        })?;
    let owner_pubkey = owner.to_hex();
    let existing = state
        .db
        .get_owned_managed_agent_host_with_secret(tenant.community(), &owner_pubkey, id)
        .await
        .map_err(|error| {
            tracing::error!(%error, "managed-agent update lookup failed");
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        })?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "agent not found"))?;
    if existing.record.desired_state != "stopped" || existing.record.observed_state != "stopped" {
        return Err(api_error(
            StatusCode::CONFLICT,
            "stop the agent before changing its configuration",
        ));
    }

    let mut secret = decrypt_secret(
        &envelope_key,
        *tenant.community().as_uuid(),
        id,
        &existing.secret_nonce,
        &existing.secret_ciphertext,
    )
    .map_err(|error| {
        tracing::error!(%error, "managed-agent secret decrypt failed");
        api_error(StatusCode::INTERNAL_SERVER_ERROR, "agent update failed")
    })?;
    let credential_mode = input
        .credential_mode
        .as_deref()
        .unwrap_or(&existing.record.credential_mode);
    if credential_mode == "subscription" {
        secret.env.clear();
    } else if let Some(secrets) = input.secrets {
        secret.env = secrets;
    }
    let validation = CreateAgentRequest {
        name: input.name.unwrap_or_else(|| existing.record.name.clone()),
        persona_id: existing.record.persona_id.clone(),
        system_prompt: input
            .system_prompt
            .unwrap_or_else(|| existing.record.system_prompt.clone()),
        runtime: input
            .runtime
            .unwrap_or_else(|| existing.record.runtime.clone()),
        model: input.model.unwrap_or_else(|| existing.record.model.clone()),
        provider: input
            .provider
            .unwrap_or_else(|| existing.record.provider.clone()),
        agent_args: input
            .agent_args
            .unwrap_or_else(|| existing.record.agent_args.clone()),
        parallelism: input
            .parallelism
            .unwrap_or(existing.record.parallelism as u8),
        idle_timeout_seconds: input.idle_timeout_seconds.unwrap_or_else(|| {
            existing
                .record
                .idle_timeout_seconds
                .map(|value| value as u64)
        }),
        max_turn_duration_seconds: input.max_turn_duration_seconds.unwrap_or_else(|| {
            existing
                .record
                .max_turn_duration_seconds
                .map(|value| value as u64)
        }),
        runtime_config: input.runtime_config.unwrap_or_else(|| {
            existing
                .record
                .runtime_config
                .iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| (key.clone(), value.to_owned()))
                })
                .collect()
        }),
        respond_to: input
            .respond_to
            .unwrap_or_else(|| existing.record.respond_to.clone()),
        respond_to_allowlist: input
            .respond_to_allowlist
            .unwrap_or_else(|| existing.record.respond_to_allowlist.clone()),
        secrets: secret.env.clone(),
        credential_mode: credential_mode.to_owned(),
        start_immediately: true,
    };
    validate_create(&validation)?;
    let runtime_config_json = validation
        .runtime_config
        .iter()
        .map(|(key, value)| (key.clone(), Value::String(value.clone())))
        .collect::<serde_json::Map<String, Value>>();
    let encrypted = encrypt_secret(
        &envelope_key,
        *tenant.community().as_uuid(),
        id,
        AgentSecretPayload {
            private_key_nsec: secret.private_key_nsec.clone(),
            env: secret.env.clone(),
        },
    )
    .map_err(|error| {
        tracing::error!(%error, "managed-agent secret re-encrypt failed");
        api_error(StatusCode::INTERNAL_SERVER_ERROR, "agent update failed")
    })?;
    let record = state
        .db
        .update_managed_agent_host(
            tenant.community(),
            &owner_pubkey,
            id,
            buzz_db::managed_agent_host::UpdateManagedAgentHost {
                name: validation.name.trim(),
                system_prompt: validation.system_prompt.trim(),
                runtime: &validation.runtime,
                model: validation.model.as_deref().map(str::trim),
                provider: validation.provider.as_deref().map(str::trim),
                agent_args: &validation.agent_args,
                parallelism: i16::from(validation.parallelism),
                idle_timeout_seconds: validation.idle_timeout_seconds.map(|value| value as i64),
                max_turn_duration_seconds: validation
                    .max_turn_duration_seconds
                    .map(|value| value as i64),
                runtime_config: &runtime_config_json,
                credential_mode: &validation.credential_mode,
                respond_to: &validation.respond_to,
                respond_to_allowlist: &validation.respond_to_allowlist,
                secret_nonce: &encrypted.nonce,
                secret_ciphertext: &encrypted.ciphertext,
            },
        )
        .await
        .map_err(|error| {
            tracing::error!(%error, "managed-agent update failed");
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        })?
        .ok_or_else(|| {
            api_error(
                StatusCode::CONFLICT,
                "stop the agent before changing its configuration",
            )
        })?;
    Ok(Json(json!({ "agent": record })))
}

/// Return subscription-login status from the private agent-host control port.
pub async fn auth_status(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/agents/{id}/auth");
    let (tenant, owner) = authorize_owner(&state, &headers, "GET", &path, None, false).await?;
    require_owned_subscription_agent(&state, tenant.community(), &owner.to_hex(), id).await?;
    proxy_agent_host("GET", *tenant.community().as_uuid(), id, None).await
}

/// Return a bounded, redacted, in-memory tail from the private agent host.
pub async fn agent_logs(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<Value>), (StatusCode, Json<Value>)> {
    let path = format!("/api/agents/{id}/logs");
    let (tenant, owner) = authorize_owner(&state, &headers, "GET", &path, None, false).await?;
    require_owned_agent(&state, tenant.community(), &owner.to_hex(), id).await?;
    let payload = proxy_agent_host_logs(*tenant.community().as_uuid(), id).await?;
    let mut response_headers = HeaderMap::new();
    response_headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    Ok((response_headers, payload))
}

/// Return recent signed observer ciphertext for local owner decryption.
pub async fn agent_activity(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<Value>), (StatusCode, Json<Value>)> {
    let path = format!("/api/agents/{id}/activity");
    let (tenant, owner) = authorize_owner(&state, &headers, "GET", &path, None, false).await?;
    let id =
        Uuid::parse_str(&id).map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid agent id"))?;
    let events = state
        .db
        .list_owned_managed_agent_observer_events(
            tenant.community(),
            &owner.to_hex(),
            id,
            MAX_OBSERVER_HISTORY_EVENTS,
            MAX_OBSERVER_HISTORY_BYTES,
        )
        .await
        .map_err(|error| {
            tracing::error!(%error, "managed-agent observer history lookup failed");
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        })?;
    let mut response_headers = HeaderMap::new();
    response_headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    Ok((response_headers, Json(json!({ "events": events }))))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
/// One plaintext snapshot memory entry to re-encrypt for an owned agent.
pub struct RestoreAgentMemoryRequest {
    /// Canonical NIP-AE slug (`core` or `mem/...`).
    slug: String,
    /// Plaintext entry value from the explicitly imported snapshot.
    body: String,
}

/// Restore one plaintext snapshot entry under an owned, fully stopped agent.
/// The browser never receives agent key material; the signed NIP-AE event goes
/// through the same membership, signature, envelope, and retention pipeline as
/// any external relay submission.
pub async fn restore_agent_memory(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/agents/{id}/memory");
    let (tenant, owner) =
        authorize_owner(&state, &headers, "POST", &path, Some(&body), true).await?;
    let input: RestoreAgentMemoryRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid request body"))?;
    let memory_body = snapshot_memory_body(&input)?;

    let envelope_key = std::env::var("BUZZ_AGENT_SECRET_KEY")
        .ok()
        .and_then(|value| parse_envelope_key(&value).ok())
        .ok_or_else(|| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "agent hosting is not configured",
            )
        })?;
    let owner_pubkey = owner.to_hex();
    let existing = state
        .db
        .get_owned_managed_agent_host_with_secret(tenant.community(), &owner_pubkey, id)
        .await
        .map_err(|error| {
            tracing::error!(%error, "managed-agent memory lookup failed");
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        })?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "agent not found"))?;
    if existing.record.desired_state != "stopped" || existing.record.observed_state != "stopped" {
        return Err(api_error(
            StatusCode::CONFLICT,
            "stop the agent before restoring memory",
        ));
    }
    let secret = decrypt_secret(
        &envelope_key,
        *tenant.community().as_uuid(),
        id,
        &existing.secret_nonce,
        &existing.secret_ciphertext,
    )
    .map_err(|error| {
        tracing::error!(%error, "managed-agent secret decrypt failed");
        api_error(StatusCode::INTERNAL_SERVER_ERROR, "memory restore failed")
    })?;
    let agent_keys = Keys::parse(&secret.private_key_nsec).map_err(|error| {
        tracing::error!(%error, "managed-agent identity parse failed");
        api_error(StatusCode::INTERNAL_SERVER_ERROR, "memory restore failed")
    })?;
    let event = buzz_core::engram::build_event(
        &agent_keys,
        &owner,
        &memory_body,
        nostr::Timestamp::now().as_secs(),
    )
    .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid memory entry"))?;
    let event_json = event.as_json();
    let expected_url = bridge::nip98_expected_url(&state.config.relay_url, &tenant, "/events");
    let authorization =
        nip98_header(&agent_keys, &expected_url, event_json.as_bytes()).map_err(|error| {
            tracing::error!(%error, "managed-agent memory auth failed");
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "memory restore failed")
        })?;
    drop(agent_keys);
    drop(secret);
    let mut submit_headers = HeaderMap::new();
    submit_headers.insert(
        header::HOST,
        tenant
            .host()
            .parse()
            .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "memory restore failed"))?,
    );
    submit_headers.insert(
        header::AUTHORIZATION,
        authorization
            .parse()
            .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "memory restore failed"))?,
    );
    let Json(receipt) =
        bridge::submit_event(State(state), submit_headers, Bytes::from(event_json)).await?;
    if receipt.get("accepted").and_then(Value::as_bool) != Some(true) {
        return Err(api_error(
            StatusCode::BAD_GATEWAY,
            "relay rejected memory entry",
        ));
    }
    Ok(Json(json!({ "event_id": event.id.to_hex() })))
}

fn snapshot_memory_body(
    input: &RestoreAgentMemoryRequest,
) -> Result<buzz_core::engram::Body, (StatusCode, Json<Value>)> {
    let body = if input.slug == buzz_core::engram::CORE_SLUG {
        buzz_core::engram::Body::Core {
            profile: input.body.clone(),
        }
    } else {
        buzz_core::engram::Body::Memory {
            slug: input.slug.clone(),
            value: Some(input.body.clone()),
        }
    };
    buzz_core::engram::validate_slug(body.slug())
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid memory entry"))?;
    if body.to_json_bytes().len() > buzz_core::engram::NIP44_PLAINTEXT_MAX {
        return Err(api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "memory entry is too large",
        ));
    }
    Ok(body)
}

fn nip98_header(keys: &Keys, url: &str, body: &[u8]) -> anyhow::Result<String> {
    let payload_hash = hex::encode(Sha256::digest(body));
    let event = EventBuilder::new(Kind::HttpAuth, "")
        .tags([
            Tag::parse(["u", url])?,
            Tag::parse(["method", "POST"])?,
            Tag::parse(["payload", &payload_hash])?,
            Tag::parse(["nonce", &Uuid::new_v4().to_string()])?,
        ])
        .sign_with_keys(keys)?;
    Ok(format!(
        "Nostr {}",
        BASE64.encode(event.as_json().as_bytes())
    ))
}

/// Start the fixed vendor subscription-login command for one stopped agent.
pub async fn start_auth(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/agents/{id}/auth/start");
    let (tenant, owner) =
        authorize_owner(&state, &headers, "POST", &path, Some(&body), true).await?;
    require_owned_subscription_agent(&state, tenant.community(), &owner.to_hex(), id).await?;
    proxy_agent_host("POST", *tenant.community().as_uuid(), id, None).await
}

/// Forward a short OAuth confirmation code directly to the ephemeral CLI stdin.
pub async fn auth_input(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/agents/{id}/auth/input");
    let (tenant, owner) =
        authorize_owner(&state, &headers, "POST", &path, Some(&body), true).await?;
    require_owned_subscription_agent(&state, tenant.community(), &owner.to_hex(), id).await?;
    let input: AuthInput = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid request body"))?;
    if input.value.is_empty() || input.value.len() > 4096 || input.value.contains(['\r', '\n']) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid authentication input",
        ));
    }
    proxy_agent_host(
        "INPUT",
        *tenant.community().as_uuid(),
        id,
        Some(json!({ "value": input.value })),
    )
    .await
}

/// Cancel an in-progress vendor login command.
pub async fn cancel_auth(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/agents/{id}/auth");
    let (tenant, owner) =
        authorize_owner(&state, &headers, "DELETE", &path, Some(&body), true).await?;
    require_owned_subscription_agent(&state, tenant.community(), &owner.to_hex(), id).await?;
    proxy_agent_host("DELETE", *tenant.community().as_uuid(), id, None).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthInput {
    value: String,
}

async fn require_owned_subscription_agent(
    state: &AppState,
    community: buzz_core::CommunityId,
    owner_pubkey: &str,
    id: Uuid,
) -> Result<(), (StatusCode, Json<Value>)> {
    let record = require_owned_agent(state, community, owner_pubkey, id).await?;
    if record.credential_mode != "subscription" {
        return Err(api_error(
            StatusCode::CONFLICT,
            "agent is configured to use an API key",
        ));
    }
    Ok(())
}

async fn require_owned_agent(
    state: &AppState,
    community: buzz_core::CommunityId,
    owner_pubkey: &str,
    id: Uuid,
) -> Result<buzz_db::managed_agent_host::ManagedAgentHostRecord, (StatusCode, Json<Value>)> {
    state
        .db
        .get_owned_managed_agent_host(community, owner_pubkey, id)
        .await
        .map_err(|error| {
            tracing::error!(%error, "managed-agent auth lookup failed");
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        })?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "agent not found"))
}

async fn proxy_agent_host_logs(
    community: Uuid,
    id: Uuid,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    proxy_agent_host_request("GET", community, id, "logs", None).await
}

async fn proxy_agent_host(
    action: &str,
    community: Uuid,
    id: Uuid,
    body: Option<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let suffix = if action == "INPUT" {
        "auth/input"
    } else {
        "auth"
    };
    proxy_agent_host_request(action, community, id, suffix, body).await
}

async fn proxy_agent_host_request(
    action: &str,
    community: Uuid,
    id: Uuid,
    suffix: &str,
    body: Option<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let envelope_key = std::env::var("BUZZ_AGENT_SECRET_KEY")
        .ok()
        .and_then(|value| parse_envelope_key(&value).ok())
        .ok_or_else(|| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "agent hosting is not configured",
            )
        })?;
    let base = std::env::var("BUZZ_AGENT_HOST_CONTROL_URL")
        .unwrap_or_else(|_| "http://agent-host:8090".into());
    let url = format!(
        "{}/v1/agents/{community}/{id}/{suffix}",
        base.trim_end_matches('/')
    );
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| api_error(StatusCode::SERVICE_UNAVAILABLE, "agent host is unavailable"))?;
    let mut request = match action {
        "GET" => client.get(url),
        "POST" | "INPUT" => client.post(url),
        "DELETE" => client.delete(url),
        _ => unreachable!("fixed internal action"),
    }
    .bearer_auth(derive_control_token(&envelope_key));
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|error| {
        tracing::warn!(%error, "agent host control request failed");
        api_error(StatusCode::SERVICE_UNAVAILABLE, "agent host is unavailable")
    })?;
    let status =
        StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let payload = response
        .json::<Value>()
        .await
        .unwrap_or_else(|_| json!({ "error": "agent host returned an invalid response" }));
    if !status.is_success() {
        let message = payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("agent host request failed");
        return Err(api_error(status, message));
    }
    Ok(Json(payload))
}

/// Request a stopped agent to start on the server-owned runner.
pub async fn start_agent(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    set_state(state, id, headers, body, "start", "running").await
}

/// Request a running agent to stop.
pub async fn stop_agent(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    set_state(state, id, headers, body, "stop", "stopped").await
}

async fn set_state(
    state: Arc<AppState>,
    id: Uuid,
    headers: HeaderMap,
    body: Bytes,
    action: &str,
    desired_state: &str,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/agents/{id}/{action}");
    let (tenant, owner) =
        authorize_owner(&state, &headers, "POST", &path, Some(&body), true).await?;
    if desired_state == "running" {
        let record = state
            .db
            .get_owned_managed_agent_host(tenant.community(), &owner.to_hex(), id)
            .await
            .map_err(|error| {
                tracing::error!(%error, "managed-agent start lookup failed");
                api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
            })?
            .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "agent not found"))?;
        if record.credential_mode == "subscription" {
            let status = proxy_agent_host("GET", *tenant.community().as_uuid(), id, None).await?;
            if status.0.get("connected").and_then(Value::as_bool) != Some(true) {
                return Err(api_error(
                    StatusCode::CONFLICT,
                    "connect the agent subscription before starting it",
                ));
            }
        }
    }
    let record = state
        .db
        .set_managed_agent_desired_state(tenant.community(), &owner.to_hex(), id, desired_state)
        .await
        .map_err(|error| {
            tracing::error!(%error, "managed-agent state update failed");
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        })?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "agent not found"))?;
    Ok(Json(json!({ "agent": record })))
}

/// Delete a stopped agent and revoke its direct relay membership.
pub async fn delete_agent(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    let path = format!("/api/agents/{id}");
    let (tenant, owner) =
        authorize_owner(&state, &headers, "DELETE", &path, Some(&body), true).await?;
    state
        .db
        .delete_managed_agent_host(tenant.community(), &owner.to_hex(), id)
        .await
        .map_err(|error| {
            tracing::error!(%error, "managed-agent delete failed");
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        })?
        .ok_or_else(|| {
            api_error(
                StatusCode::CONFLICT,
                "agent must be fully stopped before deletion",
            )
        })?;
    Ok(StatusCode::NO_CONTENT)
}

fn validate_create(input: &CreateAgentRequest) -> Result<(), (StatusCode, Json<Value>)> {
    let name = input.name.trim();
    if name.is_empty() || name.len() > MAX_NAME_LEN {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid agent name"));
    }
    if input.persona_id.as_deref().is_some_and(|id| {
        id.is_empty()
            || id.len() > 64
            || !id.bytes().enumerate().all(|(index, byte)| {
                byte.is_ascii_lowercase()
                    || byte.is_ascii_digit()
                    || (index > 0 && matches!(byte, b'_' | b'-'))
            })
    }) {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid persona id"));
    }
    if input.system_prompt.len() > MAX_SYSTEM_PROMPT_LEN {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "agent instructions are too long",
        ));
    }
    if runtime_command(&input.runtime).is_none() {
        return Err(api_error(StatusCode::BAD_REQUEST, "unsupported runtime"));
    }
    let runtime = runtime_command(&input.runtime)
        .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "unsupported runtime"))?;
    if !matches!(input.credential_mode.as_str(), "api-key" | "subscription")
        || (input.credential_mode == "subscription"
            && (input.runtime == "buzz-agent" || runtime.custom || !input.secrets.is_empty()))
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid credential mode",
        ));
    }
    if input
        .model
        .as_deref()
        .is_some_and(|model| model.trim().is_empty() || model.len() > MAX_MODEL_LEN)
    {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid model"));
    }
    if runtime.custom
        && ((runtime.model_env.is_none() && input.model.is_some())
            || (runtime_model_required(&input.runtime)
                && input
                    .model
                    .as_deref()
                    .is_none_or(|model| model.trim().is_empty())))
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid model for selected runtime",
        ));
    }
    if input.agent_args.len() > MAX_AGENT_ARGS
        || (runtime.custom && !runtime.allow_owner_args && !input.agent_args.is_empty())
        || input
            .agent_args
            .iter()
            .any(|arg| arg.is_empty() || arg.len() > MAX_AGENT_ARG_LEN || arg.contains(['\0', ',']))
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid agent arguments",
        ));
    }
    if !(1..=32).contains(&input.parallelism) {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid parallelism"));
    }
    if input
        .idle_timeout_seconds
        .is_some_and(|value| !(1..=604_799).contains(&value))
        || input
            .max_turn_duration_seconds
            .is_some_and(|value| !(2..=604_800).contains(&value))
        || matches!(
            (input.idle_timeout_seconds, input.max_turn_duration_seconds),
            (Some(idle), Some(maximum)) if idle >= maximum
        )
    {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid turn timeout"));
    }
    validate_runtime_config(input)?;
    if !matches!(
        input.respond_to.as_str(),
        "owner-only" | "allowlist" | "anyone"
    ) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid respond-to mode",
        ));
    }
    if input.respond_to == "allowlist" && input.respond_to_allowlist.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "allowlist mode requires at least one public key",
        ));
    }
    if input.respond_to_allowlist.iter().any(|pubkey| {
        pubkey.len() != 64
            || !pubkey
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    }) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid allowlist public key",
        ));
    }
    if input.secrets.len() > MAX_SECRET_COUNT
        || input.secrets.iter().any(|(name, value)| {
            !runtime_allows_secret_env(&input.runtime, name)
                || value.is_empty()
                || value.len() > MAX_SECRET_VALUE_LEN
        })
    {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid agent secrets"));
    }
    if input.credential_mode == "api-key" {
        let required_secret = match (input.runtime.as_str(), input.provider.as_deref()) {
            ("codex", _) => Some("OPENAI_API_KEY"),
            ("claude", _) | ("buzz-agent", Some("anthropic")) => Some("ANTHROPIC_API_KEY"),
            ("buzz-agent", Some("openai")) => Some("OPENAI_COMPAT_API_KEY"),
            ("buzz-agent", Some("openrouter")) => Some("OPENROUTER_API_KEY"),
            ("buzz-agent", Some("databricks" | "databricks_v2")) => None,
            _ => None,
        };
        if required_secret.is_some_and(|name| !input.secrets.contains_key(name)) {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                "required agent credential is missing",
            ));
        }
        if runtime.custom
            && runtime
                .secret_fields
                .iter()
                .any(|field| field.required && !input.secrets.contains_key(&field.env))
        {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                "required agent credential is missing",
            ));
        }
    }
    Ok(())
}

fn validate_runtime_config(input: &CreateAgentRequest) -> Result<(), (StatusCode, Json<Value>)> {
    let provider = input.provider.as_deref().map(str::trim);
    if input.runtime == "buzz-agent" {
        if !matches!(
            provider,
            Some("anthropic" | "openai" | "openrouter" | "databricks" | "databricks_v2")
        ) || input
            .model
            .as_deref()
            .is_none_or(|model| model.trim().is_empty())
        {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                "Buzz Agent requires a provider and model",
            ));
        }
    } else if provider.is_some() || !input.runtime_config.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "runtime tuning is not supported by this harness",
        ));
    }
    if input.runtime_config.len() > MAX_RUNTIME_CONFIG_ENTRIES
        || input.runtime_config.iter().any(|(key, value)| {
            runtime_config_env_name(&input.runtime, provider, key).is_none()
                || value.is_empty()
                || value.len() > MAX_RUNTIME_CONFIG_VALUE_LEN
        })
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid runtime configuration",
        ));
    }
    if input
        .runtime_config
        .get("thinking_effort")
        .is_some_and(|value| {
            !matches!(
                value.as_str(),
                "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
            )
        })
        || input
            .runtime_config
            .get("max_rounds")
            .is_some_and(|value| value.parse::<u32>().is_err())
        || input
            .runtime_config
            .get("max_output_tokens")
            .is_some_and(|value| value.parse::<u32>().ok().is_none_or(|number| number == 0))
        || input
            .runtime_config
            .get("max_context_tokens")
            .is_some_and(|value| value.parse::<u64>().ok().is_none_or(|number| number == 0))
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid runtime tuning value",
        ));
    }
    if let (Some(output), Some(context)) = (
        input
            .runtime_config
            .get("max_output_tokens")
            .and_then(|value| value.parse::<u64>().ok()),
        input
            .runtime_config
            .get("max_context_tokens")
            .and_then(|value| value.parse::<u64>().ok()),
    ) {
        if output >= context {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                "context limit must exceed max output tokens",
            ));
        }
    }
    let http_url = |key: &str| {
        input.runtime_config.get(key).is_none_or(|value| {
            (value.starts_with("https://") || value.starts_with("http://"))
                && !value.chars().any(char::is_whitespace)
        })
    };
    if !http_url("base_url") || !http_url("databricks_host") {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid provider URL"));
    }
    if input
        .runtime_config
        .get("api_mode")
        .is_some_and(|value| !matches!(value.as_str(), "auto" | "chat" | "responses"))
        || input.runtime_config.contains_key("api_mode") && provider != Some("openai")
        || input.runtime_config.contains_key("api_version") && provider != Some("anthropic")
        || input.runtime_config.contains_key("databricks_host")
            && !matches!(provider, Some("databricks" | "databricks_v2"))
        || matches!(provider, Some("databricks" | "databricks_v2"))
            && !input.runtime_config.contains_key("databricks_host")
        || input.runtime_config.contains_key("base_url")
            && matches!(provider, Some("databricks" | "databricks_v2"))
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "provider setting does not match the selected provider",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_request() -> CreateAgentRequest {
        CreateAgentRequest {
            name: "Build agent".into(),
            persona_id: None,
            system_prompt: "Review pull requests.".into(),
            runtime: "codex".into(),
            model: None,
            provider: None,
            agent_args: vec![],
            parallelism: 1,
            idle_timeout_seconds: None,
            max_turn_duration_seconds: None,
            runtime_config: BTreeMap::new(),
            respond_to: "owner-only".into(),
            respond_to_allowlist: vec![],
            secrets: BTreeMap::from([("OPENAI_API_KEY".into(), "test-key".into())]),
            credential_mode: "api-key".into(),
            start_immediately: true,
        }
    }

    #[test]
    fn create_validation_rejects_remote_command_names() {
        let mut request = valid_request();
        request.runtime = "/bin/sh".into();
        assert!(validate_create(&request).is_err());
    }

    #[test]
    fn create_validation_rejects_reserved_environment() {
        let mut request = valid_request();
        request
            .secrets
            .insert("DATABASE_URL".into(), "stolen".into());
        assert!(validate_create(&request).is_err());
        request.secrets = BTreeMap::from([
            ("OPENAI_API_KEY".into(), "test-key".into()),
            ("BUZZ_AGENT_PROVIDER".into(), "openai".into()),
        ]);
        assert!(validate_create(&request).is_err());
    }

    #[test]
    fn subscription_login_is_limited_to_vendor_harnesses_without_api_secrets() {
        let mut request = valid_request();
        request.credential_mode = "subscription".into();
        request.secrets.clear();
        assert!(validate_create(&request).is_ok());

        request.runtime = "buzz-agent".into();
        assert!(validate_create(&request).is_err());

        request.runtime = "codex".into();
        request
            .secrets
            .insert("OPENAI_API_KEY".into(), "mixed-mode".into());
        assert!(validate_create(&request).is_err());
    }

    #[test]
    fn advanced_runtime_config_is_fixed_and_bounded() {
        let mut request = valid_request();
        request.runtime = "buzz-agent".into();
        request.model = Some("claude-sonnet-4-6".into());
        request.provider = Some("anthropic".into());
        request.secrets = BTreeMap::from([("ANTHROPIC_API_KEY".into(), "test-key".into())]);
        request.agent_args = vec!["serve".into()];
        request.parallelism = 4;
        request.idle_timeout_seconds = Some(900);
        request.max_turn_duration_seconds = Some(7200);
        request
            .runtime_config
            .insert("thinking_effort".into(), "high".into());
        request
            .runtime_config
            .insert("max_output_tokens".into(), "8192".into());
        request
            .runtime_config
            .insert("max_context_tokens".into(), "200000".into());
        assert!(validate_create(&request).is_ok());

        request.agent_args = vec!["--config,/etc/passwd".into()];
        assert!(validate_create(&request).is_err());
        request.agent_args.clear();
        request
            .runtime_config
            .insert("LD_PRELOAD".into(), "/tmp/inject.so".into());
        assert!(validate_create(&request).is_err());
    }

    #[test]
    fn create_request_defaults_to_starting_immediately() {
        let request: CreateAgentRequest = serde_json::from_value(json!({
            "name": "Snapshot agent",
            "runtime": "codex"
        }))
        .unwrap();
        assert!(request.start_immediately);

        let stopped: CreateAgentRequest = serde_json::from_value(json!({
            "name": "Snapshot agent",
            "runtime": "codex",
            "start_immediately": false
        }))
        .unwrap();
        assert!(!stopped.start_immediately);
    }

    #[test]
    fn persona_lineage_is_optional_and_strictly_validated() {
        let mut request = valid_request();
        request.persona_id = Some("review_lead-2".into());
        assert!(validate_create(&request).is_ok());

        for invalid in ["", "ReviewLead", "-review", "review/lead", "review lead"] {
            request.persona_id = Some(invalid.into());
            assert!(validate_create(&request).is_err(), "accepted {invalid:?}");
        }
    }

    #[test]
    fn snapshot_memory_validation_is_strict_and_bounded() {
        let valid = RestoreAgentMemoryRequest {
            slug: "mem/review".into(),
            body: "Check the security boundary.".into(),
        };
        assert!(snapshot_memory_body(&valid).is_ok());

        let invalid_slug = RestoreAgentMemoryRequest {
            slug: "../secret".into(),
            body: "no".into(),
        };
        assert!(snapshot_memory_body(&invalid_slug).is_err());

        let oversized = RestoreAgentMemoryRequest {
            slug: "core".into(),
            body: "x".repeat(buzz_core::engram::NIP44_PLAINTEXT_MAX),
        };
        assert!(snapshot_memory_body(&oversized).is_err());
    }
}
