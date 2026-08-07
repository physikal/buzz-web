//! Owner-authenticated web control for the deployment's shared-compute host.

use std::{collections::BTreeSet, sync::Arc, time::Duration};

use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    Json,
};
use buzz_agent_host::{derive_control_token, parse_envelope_key};
use buzz_core::TenantContext;
use buzz_db::event::EventQuery;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use nostr::{Event, EventBuilder, Kind, Tag};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::{agents::authorize_owner, api_error};
use crate::state::AppState;

const MESH_STATUS_KIND: u16 = 30_003;
const MEMBERSHIP_KIND: i32 = 13_534;
const STATUS_FRESHNESS_SECS: u64 = 120;
const MAX_MODEL_ID_BYTES: usize = 512;
const MAX_STATUS_EVENTS: i64 = 1_000;
const MAX_TRUSTED_OWNERS: usize = 64;
const MAX_INTERNAL_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartInput {
    model_id: String,
    #[serde(default)]
    max_vram_gb: Option<u64>,
}

/// Return owner-visible shared-compute lifecycle status.
pub async fn status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    authorize_deployment_owner(&state, &headers, "GET", "/api/compute/status", None, false).await?;
    let mut payload = proxy_compute("GET", "status", None).await?;
    // Loopback addresses are implementation details and unusable in a browser.
    payload["apiBaseUrl"] = Value::Null;
    payload["consoleUrl"] = Value::Null;
    if let Some(object) = payload.as_object_mut() {
        object.remove("rosterVersion");
        object.remove("routeTargets");
    }
    Ok((private_headers(), Json(payload)))
}

/// Return the native host's curated model catalog.
pub async fn catalog(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    authorize_deployment_owner(&state, &headers, "GET", "/api/compute/catalog", None, false)
        .await?;
    Ok((
        private_headers(),
        Json(proxy_compute("GET", "catalog", None).await?),
    ))
}

/// Return models installed on the native shared-compute host.
pub async fn models(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    authorize_deployment_owner(&state, &headers, "GET", "/api/compute/models", None, false).await?;
    Ok((
        private_headers(),
        Json(proxy_compute("GET", "models", None).await?),
    ))
}

/// Return aggregate serving usage for the native shared-compute host.
pub async fn usage(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    authorize_deployment_owner(&state, &headers, "GET", "/api/compute/usage", None, false).await?;
    Ok((
        private_headers(),
        Json(proxy_compute("GET", "usage", None).await?),
    ))
}

/// Start sharing the selected model with current relay members.
pub async fn start(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<(StatusCode, HeaderMap, Json<Value>)> {
    let (tenant, _) = authorize_deployment_owner(
        &state,
        &headers,
        "POST",
        "/api/compute/start",
        Some(&body),
        true,
    )
    .await?;
    let mut input: StartInput = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid request body"))?;
    validate_start_input(&mut input)?;
    let discovery = discovery_snapshot(&state, &tenant).await?;
    let payload = json!({
        "modelId": input.model_id,
        "maxVramGb": input.max_vram_gb,
        "joinToken": discovery.join_token,
        "trustedOwnerIds": discovery.trusted_owner_ids,
        "rosterVersion": discovery.roster_version,
    });
    let result = proxy_compute("POST", "start", Some(payload)).await?;
    Ok((StatusCode::ACCEPTED, private_headers(), Json(result)))
}

/// Stop the native shared-compute runtime.
pub async fn stop(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    authorize_deployment_owner(
        &state,
        &headers,
        "POST",
        "/api/compute/stop",
        Some(&body),
        true,
    )
    .await?;
    if !body.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "request body must be empty",
        ));
    }
    let result = proxy_compute("POST", "stop", Some(json!({}))).await?;
    Ok((private_headers(), Json(result)))
}

async fn authorize_deployment_owner(
    state: &AppState,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
    require_payload: bool,
) -> ApiResult<(TenantContext, nostr::PublicKey)> {
    let result = authorize_owner(state, headers, method, path, body, require_payload).await?;
    let deployment = crate::tenant::bind_deployment_community(&state.db, &state.config.relay_url)
        .await
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "shared compute is unavailable",
            )
        })?;
    if result.0.community() != deployment.community() {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "shared compute belongs to a different community",
        ));
    }
    Ok(result)
}

fn validate_start_input(input: &mut StartInput) -> ApiResult<()> {
    input.model_id = input.model_id.trim().to_string();
    if !is_hosted_model_ref(&input.model_id) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "modelId must be a catalog or Hugging Face model reference",
        ));
    }
    if input
        .max_vram_gb
        .is_some_and(|value| !(1..=1024).contains(&value))
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "maxVramGb must be between 1 and 1024",
        ));
    }
    Ok(())
}

pub(crate) fn is_hosted_model_ref(value: &str) -> bool {
    if value.is_empty()
        || value.len() > MAX_MODEL_ID_BYTES
        || value.starts_with('/')
        || value.starts_with('~')
        || value.starts_with("./")
        || value.starts_with("../")
        || value.ends_with('/')
        || value.to_ascii_lowercase().ends_with(".gguf")
        || value.contains('\\')
        || value.contains('?')
        || value.contains('#')
        || value.chars().any(char::is_whitespace)
    {
        return false;
    }

    let (reference, hugging_face) = match value.strip_prefix("hf://") {
        Some(reference) => (reference, true),
        None if value.contains("://") => return false,
        None => (value, false),
    };
    if reference.is_empty()
        || reference.starts_with('/')
        || reference.ends_with('/')
        || reference.contains("//")
        || reference
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
        || !reference.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'/' | b'@' | b':')
        })
    {
        return false;
    }

    if hugging_face {
        return reference.contains('/')
            && !reference.contains(':')
            && reference.matches('@').count() <= 1;
    }

    match reference.find(':') {
        Some(colon) => {
            reference[..colon].contains('/')
                && !reference[colon + 1..].is_empty()
                && !reference[colon + 1..].contains(['/', ':', '@'])
        }
        None => reference.matches('@').count() <= 1,
    }
}

async fn proxy_compute(method: &str, action: &str, body: Option<Value>) -> ApiResult<Value> {
    let envelope_key = std::env::var("BUZZ_AGENT_SECRET_KEY")
        .ok()
        .and_then(|value| parse_envelope_key(&value).ok())
        .ok_or_else(|| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "shared compute is not configured",
            )
        })?;
    let base = std::env::var("BUZZ_AGENT_HOST_CONTROL_URL")
        .unwrap_or_else(|_| "http://agent-host:8090".into());
    let url = format!("{}/v1/compute/{action}", base.trim_end_matches('/'));
    let request_timeout = if action == "ensure-client" {
        Duration::from_secs(4 * 60)
    } else {
        Duration::from_secs(30)
    };
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(request_timeout)
        .build()
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "shared compute is unavailable",
            )
        })?;
    let mut request = match method {
        "GET" => client.get(url),
        "POST" => client.post(url),
        _ => unreachable!("fixed compute method"),
    }
    .bearer_auth(derive_control_token(&envelope_key));
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|error| {
        tracing::warn!(%error, "shared compute control request failed");
        api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "shared compute is unavailable",
        )
    })?;
    let status =
        StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    if response
        .content_length()
        .is_some_and(|size| size > MAX_INTERNAL_RESPONSE_BYTES as u64)
    {
        return Err(api_error(
            StatusCode::BAD_GATEWAY,
            "shared compute response is too large",
        ));
    }
    let bytes = response.bytes().await.map_err(|_| {
        api_error(
            StatusCode::BAD_GATEWAY,
            "shared compute returned an invalid response",
        )
    })?;
    if bytes.len() > MAX_INTERNAL_RESPONSE_BYTES {
        return Err(api_error(
            StatusCode::BAD_GATEWAY,
            "shared compute response is too large",
        ));
    }
    let payload = serde_json::from_slice::<Value>(&bytes).map_err(|_| {
        api_error(
            StatusCode::BAD_GATEWAY,
            "shared compute returned an invalid response",
        )
    })?;
    if !status.is_success() {
        return Err(api_error(
            status,
            payload
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("shared compute request failed"),
        ));
    }
    Ok(payload)
}

struct DiscoverySnapshot {
    trusted_owner_ids: Vec<String>,
    join_token: Option<String>,
    serve_targets: Vec<DiscoveryTarget>,
    roster_version: String,
}

struct DiscoveryTarget {
    model_id: String,
    join_token: String,
}

async fn discovery_snapshot(
    state: &AppState,
    tenant: &TenantContext,
) -> ApiResult<DiscoverySnapshot> {
    let relay_pubkey = state.relay_keypair.public_key().to_hex();
    let membership_events = state
        .db
        .query_events(&EventQuery {
            kinds: Some(vec![MEMBERSHIP_KIND]),
            pubkey: Some(state.relay_keypair.public_key().to_bytes().to_vec()),
            global_only: true,
            limit: Some(1),
            ..EventQuery::for_community(tenant.community())
        })
        .await
        .map_err(|error| {
            tracing::warn!(%error, "shared compute discovery query failed");
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "shared compute discovery is unavailable",
            )
        })?;
    let membership = membership_events
        .iter()
        .map(|stored| &stored.event)
        .max_by_key(|event| event.created_at)
        .ok_or_else(|| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "shared compute is waiting for the member roster",
            )
        })?;
    let mut members = membership
        .tags
        .iter()
        .filter_map(|tag| {
            let values = tag.as_slice();
            if !matches!(values.first().map(String::as_str), Some("member" | "p")) {
                return None;
            }
            values
                .get(1)
                .map(|value| value.trim().to_ascii_lowercase())
                .filter(|value| {
                    value.len() == 64
                        && value
                            .bytes()
                            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
                })
        })
        .collect::<BTreeSet<_>>();
    // The relay key is the authority that signed the roster. Allowing its own
    // compute report adds no identity authority beyond that existing trust.
    members.insert(relay_pubkey.clone());

    let status_events = state
        .db
        .query_events(&EventQuery {
            kinds: Some(vec![i32::from(MESH_STATUS_KIND)]),
            global_only: true,
            limit: Some(MAX_STATUS_EVENTS),
            ..EventQuery::for_community(tenant.community())
        })
        .await
        .map_err(|error| {
            tracing::warn!(%error, "shared compute status query failed");
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "shared compute discovery is unavailable",
            )
        })?;

    let mut trusted = BTreeSet::new();
    let mut join_token = None;
    let mut serve_targets = Vec::new();
    let now = nostr::Timestamp::now().as_secs();
    for event in status_events
        .iter()
        .map(|stored| &stored.event)
        .filter(|event| members.contains(&event.pubkey.to_hex().to_ascii_lowercase()))
    {
        let Some(binding) = verified_binding(event) else {
            continue;
        };
        if event.pubkey.to_hex() != relay_pubkey {
            trusted.insert(binding.owner_id);
        }
        if join_token.is_none()
            && event.pubkey.to_hex() != relay_pubkey
            && event
                .created_at
                .as_secs()
                .saturating_add(STATUS_FRESHNESS_SECS)
                >= now
        {
            join_token = first_target_token(&binding.payload);
        }
        if event.pubkey.to_hex() != relay_pubkey
            && event
                .created_at
                .as_secs()
                .saturating_add(STATUS_FRESHNESS_SECS)
                >= now
        {
            serve_targets.extend(targets_from_payload(&binding.payload));
        }
    }
    let trusted_owner_ids = trusted
        .into_iter()
        .take(MAX_TRUSTED_OWNERS)
        .collect::<Vec<_>>();
    Ok(DiscoverySnapshot {
        roster_version: roster_version(&trusted_owner_ids),
        trusted_owner_ids,
        join_token,
        serve_targets,
    })
}

fn roster_version(owner_ids: &[String]) -> String {
    let mut digest = Sha256::new();
    for owner_id in owner_ids {
        digest.update((owner_id.len() as u64).to_be_bytes());
        digest.update(owner_id.as_bytes());
    }
    hex::encode(digest.finalize())
}

struct VerifiedBinding {
    owner_id: String,
    payload: Value,
}

fn verified_binding(event: &Event) -> Option<VerifiedBinding> {
    let payload: Value = serde_json::from_str(&event.content).ok()?;
    let owner_id = payload
        .get("ownerId")?
        .as_str()?
        .trim()
        .to_ascii_lowercase();
    let verifying_key_bytes: [u8; 32] =
        hex::decode(payload.get("ownerVerifyingKey")?.as_str()?.trim())
            .ok()?
            .try_into()
            .ok()?;
    if owner_id != hex::encode(Sha256::digest(verifying_key_bytes)) {
        return None;
    }
    let key = VerifyingKey::from_bytes(&verifying_key_bytes).ok()?;
    let member_signature = signature_field(&payload, "ownerBindingSig")?;
    key.verify(
        format!(
            "buzz-mesh-owner-binding-v1:{}",
            event.pubkey.to_hex().to_ascii_lowercase()
        )
        .as_bytes(),
        &member_signature,
    )
    .ok()?;
    let endpoint_tokens = endpoint_tokens(&payload)?;
    let endpoint_signature = signature_field(&payload, "ownerEndpointBindingSig")?;
    key.verify(
        &endpoint_binding_bytes(&event.pubkey.to_hex(), &endpoint_tokens),
        &endpoint_signature,
    )
    .ok()?;
    Some(VerifiedBinding { owner_id, payload })
}

fn signature_field(payload: &Value, field: &str) -> Option<Signature> {
    let bytes = hex::decode(payload.get(field)?.as_str()?.trim()).ok()?;
    Signature::from_slice(&bytes).ok()
}

fn endpoint_tokens(payload: &Value) -> Option<Vec<String>> {
    let targets = payload
        .get("serveTargets")
        .or_else(|| payload.get("serve_targets"))?
        .as_array()?;
    targets
        .iter()
        .map(|target| {
            target
                .get("endpointAddr")
                .or_else(|| target.get("endpoint_addr"))?
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .collect()
}

fn endpoint_binding_bytes(member_pubkey: &str, endpoint_tokens: &[String]) -> Vec<u8> {
    let mut tokens = endpoint_tokens
        .iter()
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    tokens.sort_unstable();
    tokens.dedup();
    let mut digest = Sha256::new();
    for token in tokens {
        digest.update((token.len() as u64).to_be_bytes());
        digest.update(token.as_bytes());
    }
    format!(
        "buzz-mesh-owner-endpoint-binding-v1:{}:{}",
        member_pubkey.trim().to_ascii_lowercase(),
        hex::encode(digest.finalize())
    )
    .into_bytes()
}

fn first_target_token(payload: &Value) -> Option<String> {
    targets_from_payload(payload)
        .into_iter()
        .next()
        .map(|target| target.join_token)
}

fn targets_from_payload(payload: &Value) -> Vec<DiscoveryTarget> {
    let Some(targets) = payload
        .get("serveTargets")
        .or_else(|| payload.get("serve_targets"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    targets
        .iter()
        .filter_map(|target| {
            let model_id = target
                .get("modelId")
                .or_else(|| target.get("model_id"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty() && value.len() <= MAX_MODEL_ID_BYTES)?;
            let join_token = target
                .get("endpointAddr")
                .or_else(|| target.get("endpoint_addr"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty() && value.len() <= 64 * 1024)
                .map(ToString::to_string)?;
            Some(DiscoveryTarget {
                model_id: model_id.to_string(),
                join_token,
            })
        })
        .collect()
}

fn join_token_for_model(discovery: &DiscoverySnapshot, model_id: &str) -> Option<String> {
    let requested = canonical_model_id(model_id);
    discovery
        .serve_targets
        .iter()
        .find(|target| requested == "auto" || canonical_model_id(&target.model_id) == requested)
        .map(|target| target.join_token.clone())
}

/// Ensure the deployment-local OpenAI ingress can route one relay-mesh agent.
///
/// The model is persisted owner configuration, while the dial pointer and
/// admission roster are always re-derived from current verified relay events.
pub(crate) async fn ensure_agent_client(
    state: &AppState,
    tenant: &TenantContext,
    model_id: &str,
) -> ApiResult<()> {
    let model_id = model_id.trim();
    if !is_hosted_model_ref(model_id) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "relay-mesh model must be a catalog or Hugging Face reference",
        ));
    }
    let status = proxy_compute("GET", "status", None).await?;
    let local_route = host_serves_model(&status, model_id);
    let discovery = discovery_snapshot(state, tenant).await?;
    let join_token = (!local_route)
        .then(|| join_token_for_model(&discovery, model_id))
        .flatten();
    let result = proxy_compute(
        "POST",
        "ensure-client",
        Some(json!({
            "modelId": model_id,
            "joinToken": join_token,
            "trustedOwnerIds": discovery.trusted_owner_ids,
            "rosterVersion": discovery.roster_version,
        })),
    )
    .await?;
    if result.get("state").and_then(Value::as_str) != Some("running") {
        return Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "shared compute did not become ready",
        ));
    }
    Ok(())
}

/// Keep the native host roster synchronized and publish its signed status.
pub async fn run_coordinator(state: Arc<AppState>) {
    let mut interval = tokio::time::interval(Duration::from_secs(45));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        if let Err(error) = coordinator_tick(&state).await {
            tracing::debug!(%error, "shared compute coordinator tick skipped");
        }
    }
}

async fn coordinator_tick(state: &Arc<AppState>) -> anyhow::Result<()> {
    let tenant = crate::tenant::bind_deployment_community(&state.db, &state.config.relay_url)
        .await
        .map_err(|error| match error {
            crate::tenant::BindError::UnmappedHost => {
                anyhow::anyhow!("deployment community is not configured")
            }
            crate::tenant::BindError::Lookup(error) => anyhow::Error::new(error),
        })?;
    let host_status =
        proxy_compute("GET", "status", None)
            .await
            .map_err(|(_, Json(payload))| {
                anyhow::anyhow!(payload
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("host status unavailable")
                    .to_owned())
            })?;
    if host_status.get("desiredEnabled").and_then(Value::as_bool) == Some(true) {
        reconcile_desired_host(state, &tenant, &host_status).await?;
    }
    reconcile_running_agent_routes(state, &tenant).await;
    let report = proxy_compute("GET", "report", None)
        .await
        .map_err(|_| anyhow::anyhow!("compute report unavailable"))?;
    publish_report(&tenant, state, report).await
}

async fn reconcile_running_agent_routes(state: &Arc<AppState>, tenant: &TenantContext) {
    let mut models = match state
        .db
        .list_running_relay_mesh_models(tenant.community())
        .await
    {
        Ok(models) => models,
        Err(error) => {
            tracing::warn!(%error, "could not load hosted shared-compute recovery set");
            return;
        }
    };
    let host_status = match proxy_compute("GET", "status", None).await {
        Ok(status) => status,
        Err(_) => return,
    };
    let state_name = host_status.get("state").and_then(Value::as_str);
    if state_name == Some("starting") {
        return;
    }
    let mode = host_status.get("mode").and_then(Value::as_str);
    let discovery = match discovery_snapshot(state, tenant).await {
        Ok(discovery) => discovery,
        Err(_) => return,
    };
    let roster_changed = host_status.get("rosterVersion").and_then(Value::as_str)
        != Some(discovery.roster_version.as_str());

    // Preserve desktop's idle-client behavior while still refreshing its
    // admission roster. Active agents below remain the authoritative recovery
    // set whenever any are desired-running.
    if models.is_empty()
        && mode == Some("client")
        && (state_name == Some("failed") || roster_changed)
    {
        if let Some(model_id) = host_status
            .get("modelId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            models.push(model_id.to_string());
        }
    }
    let routed_targets = host_status
        .get("routeTargets")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|targets| targets.iter())
        .filter_map(|(model, target)| {
            target
                .as_str()
                .map(|target| (canonical_model_id(model), target.to_string()))
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    let desired_targets = models
        .iter()
        .map(|model| {
            (
                canonical_model_id(model),
                route_target_fingerprint(&host_status, &discovery, model),
            )
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    let recover_all = state_name != Some("running") || mode == Some("client") && roster_changed;

    for model_id in
        models_requiring_route_recovery(models, &routed_targets, &desired_targets, recover_all)
    {
        if let Err((_, Json(payload))) = ensure_agent_client(state, tenant, &model_id).await {
            tracing::warn!(
                model_id,
                error = payload
                    .get("error")
                    .and_then(|value| value.as_str())
                    .unwrap_or("shared compute route recovery failed"),
                "could not restore hosted shared-compute route"
            );
        }
    }
}

async fn reconcile_desired_host(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    host_status: &Value,
) -> anyhow::Result<()> {
    let Some(model_id) = host_status
        .get("modelId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
    else {
        return Ok(());
    };
    let discovery = discovery_snapshot(state, tenant)
        .await
        .map_err(|(_, Json(payload))| {
            anyhow::anyhow!(payload
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("discovery unavailable")
                .to_owned())
        })?;
    let state_name = host_status.get("state").and_then(Value::as_str);
    let roster_changed = host_status.get("rosterVersion").and_then(Value::as_str)
        != Some(discovery.roster_version.as_str());
    if state_name == Some("failed") || state_name == Some("running") && roster_changed {
        proxy_compute("POST", "stop", Some(json!({})))
            .await
            .map_err(|_| anyhow::anyhow!("could not refresh shared compute admission"))?;
    } else if state_name != Some("off") {
        return Ok(());
    }
    proxy_compute(
        "POST",
        "start",
        Some(json!({
            "modelId": model_id,
            "maxVramGb": host_status.get("maxVramGb"),
            "joinToken": discovery.join_token,
            "trustedOwnerIds": discovery.trusted_owner_ids,
            "rosterVersion": discovery.roster_version,
        })),
    )
    .await
    .map_err(|_| anyhow::anyhow!("could not restore shared compute"))?;
    Ok(())
}

fn canonical_model_id(value: &str) -> String {
    value.trim().replace("@main", "")
}

fn host_serves_model(host_status: &Value, model_id: &str) -> bool {
    host_status.get("state").and_then(Value::as_str) == Some("running")
        && host_status.get("mode").and_then(Value::as_str) == Some("serve")
        && (model_id == "auto"
            || host_status
                .get("modelId")
                .and_then(Value::as_str)
                .is_some_and(|local| canonical_model_id(local) == canonical_model_id(model_id)))
}

fn route_target_fingerprint(
    host_status: &Value,
    discovery: &DiscoverySnapshot,
    model_id: &str,
) -> Option<String> {
    if host_serves_model(host_status, model_id) {
        return Some(String::new());
    }
    join_token_for_model(discovery, model_id).map(|token| {
        let digest = Sha256::digest(token.trim().as_bytes());
        hex::encode(digest)
    })
}

fn models_requiring_route_recovery(
    models: Vec<String>,
    routed_targets: &std::collections::BTreeMap<String, String>,
    desired_targets: &std::collections::BTreeMap<String, Option<String>>,
    recover_all: bool,
) -> Vec<String> {
    models
        .into_iter()
        .filter(|model| {
            if recover_all {
                return true;
            }
            let canonical = canonical_model_id(model);
            desired_targets
                .get(&canonical)
                .and_then(Option::as_ref)
                .is_none_or(|desired| routed_targets.get(&canonical) != Some(desired))
        })
        .collect()
}

async fn publish_report(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    report: Value,
) -> anyhow::Result<()> {
    if report.to_string().len() > 256 * 1024 {
        anyhow::bail!("compute report is too large");
    }
    let owner_id = report
        .get("ownerId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow::anyhow!("compute report has no owner identity"))?;
    let d_tag = format!("buzz-mesh-member-status:{owner_id}");
    let event = EventBuilder::new(Kind::Custom(MESH_STATUS_KIND), report.to_string())
        .tags([
            Tag::parse(["d", d_tag.as_str()])?,
            Tag::parse(["k", "buzz-mesh-status"])?,
        ])
        .sign_with_keys(&state.relay_keypair)?;
    if verified_binding(&event).is_none() {
        anyhow::bail!("compute report identity binding is invalid");
    }
    let (stored, inserted) = state
        .db
        .insert_event(tenant.community(), &event, None)
        .await?;
    if inserted {
        crate::handlers::event::dispatch_persistent_event(
            tenant,
            state,
            &stored,
            u32::from(MESH_STATUS_KIND),
            &state.relay_keypair.public_key().to_hex(),
            None,
        )
        .await;
    }
    Ok(())
}

fn private_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    headers.insert(header::VARY, "Authorization".parse().unwrap());
    headers
}

type ApiError = (StatusCode, Json<Value>);
type ApiResult<T> = Result<T, ApiError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_input_rejects_paths_urls_and_unbounded_vram() {
        for model_id in [
            "/etc/passwd",
            "../model.gguf",
            "model.gguf",
            "file:///tmp/model.gguf",
            "http://169.254.169.254/latest/meta-data",
            "https://attacker.example/model",
            "ftp:attacker.example/model",
            "org/model?download=1",
            "org/model#revision",
            "org/model\nnext",
        ] {
            assert!(validate_start_input(&mut StartInput {
                model_id: model_id.into(),
                max_vram_gb: None
            })
            .is_err());
        }
        assert!(validate_start_input(&mut StartInput {
            model_id: "org/model".into(),
            max_vram_gb: Some(1025),
        })
        .is_err());
    }

    #[test]
    fn start_input_accepts_catalog_and_hugging_face_references() {
        for model_id in [
            "Gemma-4-E4B-it-Q4_K_M",
            "unsloth/gemma-4-E4B-it-GGUF:Q4_K_M",
            "hf://meshllm/qwen3-8b@main",
        ] {
            assert!(validate_start_input(&mut StartInput {
                model_id: model_id.into(),
                max_vram_gb: None,
            })
            .is_ok());
        }
    }

    #[test]
    fn endpoint_binding_is_order_independent_and_length_delimited() {
        let a = endpoint_binding_bytes("AB", &["one".into(), "two".into()]);
        let b = endpoint_binding_bytes("ab", &["two".into(), "one".into(), "one".into()]);
        assert_eq!(a, b);
        assert_ne!(
            endpoint_binding_bytes("ab", &["ab".into(), "c".into()]),
            endpoint_binding_bytes("ab", &["a".into(), "bc".into()])
        );
    }

    #[test]
    fn roster_version_is_stable_and_length_delimited() {
        assert_eq!(
            roster_version(&["aa".repeat(32), "bb".repeat(32)]),
            roster_version(&["aa".repeat(32), "bb".repeat(32)])
        );
        assert_ne!(
            roster_version(&["ab".into(), "c".into()]),
            roster_version(&["a".into(), "bc".into()])
        );
    }

    #[test]
    fn model_target_selection_matches_desktop_auto_and_exact_rules() {
        let discovery = DiscoverySnapshot {
            trusted_owner_ids: Vec::new(),
            join_token: Some("first".into()),
            serve_targets: vec![
                DiscoveryTarget {
                    model_id: "org/model-a@main".into(),
                    join_token: "token-a".into(),
                },
                DiscoveryTarget {
                    model_id: "org/model-b:Q4_K_M".into(),
                    join_token: "token-b".into(),
                },
            ],
            roster_version: "ab".repeat(32),
        };
        assert_eq!(
            join_token_for_model(&discovery, "auto").as_deref(),
            Some("token-a")
        );
        assert_eq!(
            join_token_for_model(&discovery, "org/model-a").as_deref(),
            Some("token-a")
        );
        assert_eq!(
            join_token_for_model(&discovery, "org/model-b:Q4_K_M").as_deref(),
            Some("token-b")
        );
        assert_eq!(join_token_for_model(&discovery, "org/missing"), None);
    }

    #[test]
    fn route_recovery_restores_every_missing_model_after_restart() {
        let routed = std::collections::BTreeMap::from([
            ("org/model-a".to_string(), "fingerprint-a".to_string()),
            (
                "org/model-b:Q4_K_M".to_string(),
                "old-fingerprint".to_string(),
            ),
        ]);
        let desired = std::collections::BTreeMap::from([
            ("org/model-a".to_string(), Some("fingerprint-a".to_string())),
            (
                "org/model-b:Q4_K_M".to_string(),
                Some("fingerprint-b".to_string()),
            ),
            ("auto".to_string(), None),
        ]);
        assert_eq!(
            models_requiring_route_recovery(
                vec![
                    "org/model-a@main".into(),
                    "org/model-b:Q4_K_M".into(),
                    "auto".into(),
                ],
                &routed,
                &desired,
                false,
            ),
            vec!["org/model-b:Q4_K_M", "auto"]
        );
        assert_eq!(
            models_requiring_route_recovery(
                vec!["org/model-a@main".into(), "org/model-b:Q4_K_M".into()],
                &routed,
                &desired,
                true,
            ),
            vec!["org/model-a@main", "org/model-b:Q4_K_M"]
        );
    }
}
