//! Owner-authenticated centralized agent control API.

use std::{collections::BTreeMap, sync::Arc};

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::Json,
};
use buzz_agent_host::{
    allowed_secret_env_name, derive_control_token, encrypt_secret, parse_envelope_key,
    runtime_command, AgentSecretPayload,
};
use buzz_core::TenantContext;
use nostr::{Keys, ToBech32};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use super::{api_error, bridge};
use crate::state::AppState;

const MAX_NAME_LEN: usize = 120;
const MAX_SYSTEM_PROMPT_LEN: usize = 128 * 1024;
const MAX_MODEL_LEN: usize = 255;
const MAX_SECRET_COUNT: usize = 32;
const MAX_SECRET_VALUE_LEN: usize = 16 * 1024;

/// Owner-supplied configuration for one centrally hosted agent.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateAgentRequest {
    name: String,
    #[serde(default)]
    system_prompt: String,
    runtime: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default = "default_respond_to")]
    respond_to: String,
    #[serde(default)]
    respond_to_allowlist: Vec<String>,
    #[serde(default)]
    secrets: BTreeMap<String, String>,
    #[serde(default = "default_credential_mode")]
    credential_mode: String,
}

fn default_respond_to() -> String {
    "owner-only".into()
}

fn default_credential_mode() -> String {
    "api-key".into()
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
        system_prompt,
        runtime,
        model,
        respond_to,
        respond_to_allowlist,
        secrets,
        credential_mode,
    } = input;

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
                name: name.trim(),
                system_prompt: system_prompt.trim(),
                runtime: &runtime,
                model: model.as_deref().map(str::trim),
                credential_mode: &credential_mode,
                desired_state: if credential_mode == "subscription" {
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
    let record = state
        .db
        .get_owned_managed_agent_host(community, owner_pubkey, id)
        .await
        .map_err(|error| {
            tracing::error!(%error, "managed-agent auth lookup failed");
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        })?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "agent not found"))?;
    if record.credential_mode != "subscription" {
        return Err(api_error(
            StatusCode::CONFLICT,
            "agent is configured to use an API key",
        ));
    }
    Ok(())
}

async fn proxy_agent_host(
    action: &str,
    community: Uuid,
    id: Uuid,
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
    let suffix = if action == "INPUT" { "/input" } else { "" };
    let url = format!(
        "{}/v1/agents/{community}/{id}/auth{suffix}",
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
            .unwrap_or("agent authentication failed");
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
    if input.system_prompt.len() > MAX_SYSTEM_PROMPT_LEN {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "agent instructions are too long",
        ));
    }
    if runtime_command(&input.runtime).is_none() {
        return Err(api_error(StatusCode::BAD_REQUEST, "unsupported runtime"));
    }
    if !matches!(input.credential_mode.as_str(), "api-key" | "subscription")
        || (input.credential_mode == "subscription"
            && (input.runtime == "buzz-agent" || !input.secrets.is_empty()))
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
            !allowed_secret_env_name(name) || value.is_empty() || value.len() > MAX_SECRET_VALUE_LEN
        })
    {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid agent secrets"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_request() -> CreateAgentRequest {
        CreateAgentRequest {
            name: "Build agent".into(),
            system_prompt: "Review pull requests.".into(),
            runtime: "codex".into(),
            model: None,
            respond_to: "owner-only".into(),
            respond_to_allowlist: vec![],
            secrets: BTreeMap::new(),
            credential_mode: "api-key".into(),
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
    }

    #[test]
    fn subscription_login_is_limited_to_vendor_harnesses_without_api_secrets() {
        let mut request = valid_request();
        request.credential_mode = "subscription".into();
        assert!(validate_create(&request).is_ok());

        request.runtime = "buzz-agent".into();
        assert!(validate_create(&request).is_err());

        request.runtime = "codex".into();
        request
            .secrets
            .insert("OPENAI_API_KEY".into(), "mixed-mode".into());
        assert!(validate_create(&request).is_err());
    }
}
