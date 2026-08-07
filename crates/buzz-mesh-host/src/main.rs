#![recursion_limit = "512"]

use std::{
    collections::BTreeMap,
    io,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, RwLock as StdRwLock},
    time::Duration,
};

use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use mesh_llm_events::{ConsoleSessionMode, ModelProgressStatus, OutputEvent, OutputSink};
use mesh_llm_sdk::{client, serve, EmbeddedNodeHandle, MeshDiscoveryMode, TrustPolicy};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use subtle::ConstantTimeEq;
use tokio::sync::{Mutex, RwLock};
use tower_http::limit::RequestBodyLimitLayer;

const DEFAULT_API_PORT: u16 = 9337;
const DEFAULT_CONSOLE_PORT: u16 = 3131;
const DEFAULT_CONTROL_BIND: &str = "127.0.0.1:8091";
const MESH_IROH_RELAYS_ENV: &str = "BUZZ_MESH_IROH_RELAYS";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(180);
const STOP_TIMEOUT: Duration = Duration::from_secs(12);
const MAX_MODEL_ID_BYTES: usize = 512;
const MAX_TRUSTED_OWNERS: usize = 64;
const MAX_JOIN_TOKEN_BYTES: usize = 64 * 1024;

#[path = "../../../desktop/src-tauri/src/mesh_llm/catalog.rs"]
mod catalog;
#[path = "../../../desktop/src-tauri/src/mesh_llm/identity.rs"]
mod identity;
#[path = "../../../desktop/src-tauri/src/mesh_llm/transport_policy.rs"]
mod transport_policy;
#[path = "../../../desktop/src-tauri/src/mesh_llm/usage.rs"]
mod usage;

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "buzz_mesh_host=info".into()),
        )
        .init();
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(8 * 1024 * 1024)
        .build()?
        .block_on(run())
}

async fn run() -> anyhow::Result<()> {
    let token = std::env::var("BUZZ_MESH_HOST_CONTROL_TOKEN")?;
    if token.len() < 43 {
        anyhow::bail!("BUZZ_MESH_HOST_CONTROL_TOKEN is invalid");
    }
    let data_dir =
        PathBuf::from(std::env::var("BUZZ_MESH_DATA_DIR").unwrap_or_else(|_| "/data/mesh".into()));
    let reporter_pubkey = std::env::var("BUZZ_MESH_REPORTER_PUBKEY")?;
    validate_hex_id(&reporter_pubkey, "BUZZ_MESH_REPORTER_PUBKEY")?;
    let relay_url = std::env::var("BUZZ_RELAY_URL")?;
    let mesh_name = mesh_name_for_relay(&relay_url);
    tokio::fs::create_dir_all(&data_dir).await?;
    let bind: SocketAddr = std::env::var("BUZZ_MESH_HOST_CONTROL_BIND")
        .unwrap_or_else(|_| DEFAULT_CONTROL_BIND.into())
        .parse()?;
    let progress = Arc::new(StdRwLock::new(None));
    mesh_llm_events::set_output_sink(Arc::new(ProgressSink {
        progress: Arc::clone(&progress),
    }));
    let persisted = load_config(&data_dir).await.unwrap_or_default();
    let state = Arc::new(AppState {
        token: Arc::new(token),
        data_dir,
        reporter_pubkey,
        mesh_name,
        persisted: RwLock::new(persisted),
        slot: Mutex::new(RuntimeSlot::Off),
        progress,
    });
    let router = Router::new()
        .route("/v1/compute/status", get(status))
        .route("/v1/compute/catalog", get(model_catalog))
        .route("/v1/compute/models", get(installed_models))
        .route("/v1/compute/usage", get(serving_usage))
        .route("/v1/compute/report", get(status_report))
        .route("/v1/compute/start", post(start))
        .route("/v1/compute/ensure-client", post(ensure_client))
        .route("/v1/compute/stop", post(stop))
        .layer(RequestBodyLimitLayer::new(128 * 1024))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(%bind, "shared compute control port ready");
    axum::serve(listener, router).await?;
    Ok(())
}

struct AppState {
    token: Arc<String>,
    data_dir: PathBuf,
    reporter_pubkey: String,
    mesh_name: String,
    persisted: RwLock<PersistedConfig>,
    slot: Mutex<RuntimeSlot>,
    progress: Arc<StdRwLock<Option<MeshDownloadProgress>>>,
}

enum RuntimeSlot {
    Off,
    Starting(StartRequest),
    StartingClient(ClientRequest),
    Running(MeshRuntime),
    Failed {
        request: StartRequest,
        error: String,
    },
    FailedClient {
        request: ClientRequest,
        error: String,
    },
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedConfig {
    enabled: bool,
    model_id: String,
    max_vram_gb: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartRequest {
    model_id: String,
    #[serde(default)]
    max_vram_gb: Option<u64>,
    #[serde(default)]
    join_token: Option<String>,
    trusted_owner_ids: Vec<String>,
    roster_version: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClientRequest {
    model_id: String,
    #[serde(default)]
    join_token: Option<String>,
    trusted_owner_ids: Vec<String>,
    roster_version: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum NodeState {
    Off,
    Starting,
    Running,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum HealthStatus {
    Ok,
    Degraded,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Health {
    status: HealthStatus,
    reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeStatus {
    state: NodeState,
    mode: Option<&'static str>,
    health: Health,
    api_base_url: Option<String>,
    console_url: Option<String>,
    model_id: Option<String>,
    model_name: Option<String>,
    max_vram_gb: Option<u64>,
    endpoint_id: Option<String>,
    device_id: Option<String>,
    device_name: Option<String>,
    desired_enabled: bool,
    roster_version: Option<String>,
    route_targets: Option<BTreeMap<String, String>>,
    progress: Option<MeshDownloadProgress>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MeshDownloadProgress {
    label: String,
    file: Option<String>,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
    status: &'static str,
    done: bool,
}

struct ProgressSink {
    progress: Arc<StdRwLock<Option<MeshDownloadProgress>>>,
}

impl OutputSink for ProgressSink {
    fn emit_event(&self, event: OutputEvent) -> io::Result<()> {
        if let OutputEvent::ModelDownloadProgress {
            label,
            file,
            downloaded_bytes,
            total_bytes,
            status,
        } = event
        {
            let done = matches!(status, ModelProgressStatus::Ready);
            let snapshot = MeshDownloadProgress {
                label,
                file,
                downloaded_bytes,
                total_bytes,
                status: match status {
                    ModelProgressStatus::Ensuring => "preparing",
                    ModelProgressStatus::Downloading => "downloading",
                    ModelProgressStatus::Ready => "done",
                },
                done,
            };
            if let Ok(mut progress) = self.progress.write() {
                *progress = Some(snapshot);
            }
        }
        Ok(())
    }

    fn console_session_mode(&self) -> Option<ConsoleSessionMode> {
        Some(ConsoleSessionMode::InteractiveDashboard)
    }
}

struct MeshRuntime {
    handle: EmbeddedNodeHandle,
    mode: &'static str,
    model_id: String,
    max_vram_gb: Option<u64>,
    roster_version: String,
    route_targets: Arc<RwLock<BTreeMap<String, String>>>,
}

impl MeshRuntime {
    async fn start(mut request: StartRequest, mesh_name: &str) -> anyhow::Result<Self> {
        validate_start_request(&mut request)?;
        mesh_llm_host_runtime::initialize_host_runtime()
            .await
            .map_err(|error| {
                anyhow::anyhow!("mesh native runtime failed to install or load: {error:#}")
            })?;
        ensure_model_downloaded(&request.model_id).await?;
        let identity = identity::ensure_owner_identity()?;
        let mut owners = request.trusted_owner_ids.clone();
        owners.push(identity.owner_id.clone());
        owners.sort();
        owners.dedup();
        let mut builder = serve::EmbeddedServeConfig::builder()
            .model(request.model_id.clone())
            .api_port(DEFAULT_API_PORT)
            .console_port(DEFAULT_CONSOLE_PORT)
            .publish(false)
            .auto_join(false)
            .discovery_mode(MeshDiscoveryMode::Nostr)
            .mesh_name(mesh_name.to_string())
            .startup_timeout(STARTUP_TIMEOUT)
            .console_ui(true)
            .owner_key(identity.keystore_path)
            .owner_required(true)
            .trust_policy(TrustPolicy::Allowlist)
            .trust_owners(owners);
        builder = match transport_policy::iroh_relay_mode()? {
            transport_policy::IrohRelayMode::Disabled => builder.disable_iroh_relays(true),
            transport_policy::IrohRelayMode::Default => builder.disable_iroh_relays(false),
            transport_policy::IrohRelayMode::Custom(urls) => builder
                .disable_iroh_relays(false)
                .iroh_relays(urls.into_iter().map(|url| url.to_string())),
        };
        if let Some(max_vram_gb) = request.max_vram_gb {
            builder = builder.max_vram_gb(max_vram_gb as f64);
        }
        if let Some(join_token) = request.join_token.as_deref() {
            builder = builder.join_token(join_token);
        }
        let handle = serve::start(builder.build()).await?;
        wait_for_inference(&request.model_id).await?;
        Ok(Self {
            handle,
            mode: "serve",
            route_targets: Arc::new(RwLock::new(BTreeMap::from([(
                request.model_id.clone(),
                String::new(),
            )]))),
            model_id: request.model_id,
            max_vram_gb: request.max_vram_gb,
            roster_version: request.roster_version,
        })
    }

    async fn start_client(
        mut request: ClientRequest,
        mesh_name: &str,
        target_fingerprint: String,
    ) -> anyhow::Result<Self> {
        validate_client_request(&mut request)?;
        let join_token = request
            .join_token
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("no live relay member is serving this model"))?;
        mesh_llm_host_runtime::initialize_host_runtime()
            .await
            .map_err(|error| {
                anyhow::anyhow!("mesh native runtime failed to install or load: {error:#}")
            })?;
        let identity = identity::ensure_owner_identity()?;
        let mut owners = request.trusted_owner_ids.clone();
        owners.push(identity.owner_id);
        owners.sort();
        owners.dedup();
        let mut builder = client::EmbeddedClientConfig::builder()
            .api_port(DEFAULT_API_PORT)
            .console_port(DEFAULT_CONSOLE_PORT)
            .publish(false)
            .auto_join(false)
            .discovery_mode(MeshDiscoveryMode::Nostr)
            .mesh_name(mesh_name.to_string())
            .startup_timeout(STARTUP_TIMEOUT)
            .console_ui(true)
            .owner_key(identity.keystore_path)
            .owner_required(true)
            .trust_policy(TrustPolicy::Allowlist)
            .trust_owners(owners)
            .join_token(join_token);
        builder = match transport_policy::iroh_relay_mode()? {
            transport_policy::IrohRelayMode::Disabled => builder.disable_iroh_relays(true),
            transport_policy::IrohRelayMode::Default => builder.disable_iroh_relays(false),
            transport_policy::IrohRelayMode::Custom(urls) => builder
                .disable_iroh_relays(false)
                .iroh_relays(urls.into_iter().map(|url| url.to_string())),
        };
        let handle = client::start(builder.build()).await?;
        wait_for_inference(&request.model_id).await?;
        Ok(Self {
            handle,
            mode: "client",
            route_targets: Arc::new(RwLock::new(BTreeMap::from([(
                request.model_id.clone(),
                target_fingerprint,
            )]))),
            model_id: request.model_id,
            max_vram_gb: None,
            roster_version: request.roster_version,
        })
    }

    async fn status(
        &self,
        desired_enabled: bool,
        progress: Option<MeshDownloadProgress>,
    ) -> NodeStatus {
        let route_targets = self.route_targets.read().await.clone();
        match self.handle.status().await {
            Ok(status) => {
                let payload = &status.payload;
                let endpoint_id = status
                    .invite_token
                    .as_deref()
                    .and_then(|token| transport_policy::validate_advertised_endpoint(token).ok())
                    .map(|validated| validated.endpoint_id);
                let device_name = string_value(payload, "deviceName")
                    .or_else(|| string_value(payload, "device_name"))
                    .or_else(|| string_value(payload, "hostname"))
                    .or_else(|| endpoint_id.as_deref().map(short_endpoint_label));
                NodeStatus {
                    state: if self.mode == "serve" && models_from_status_payload(payload).is_empty()
                    {
                        NodeState::Starting
                    } else {
                        NodeState::Running
                    },
                    mode: Some(self.mode),
                    health: Health {
                        status: HealthStatus::Ok,
                        reason: None,
                    },
                    api_base_url: Some(status.api_base_url),
                    console_url: Some(status.console_url),
                    model_id: Some(self.model_id.clone()),
                    model_name: Some(self.model_id.clone()),
                    max_vram_gb: self.max_vram_gb,
                    endpoint_id: endpoint_id.clone(),
                    device_id: endpoint_id,
                    device_name,
                    desired_enabled,
                    roster_version: Some(self.roster_version.clone()),
                    route_targets: Some(route_targets),
                    progress,
                }
            }
            Err(error) => NodeStatus {
                state: NodeState::Failed,
                mode: Some(self.mode),
                health: Health {
                    status: HealthStatus::Failed,
                    reason: Some(error.to_string()),
                },
                api_base_url: None,
                console_url: None,
                model_id: Some(self.model_id.clone()),
                model_name: Some(self.model_id.clone()),
                max_vram_gb: self.max_vram_gb,
                endpoint_id: None,
                device_id: None,
                device_name: None,
                desired_enabled,
                roster_version: Some(self.roster_version.clone()),
                route_targets: Some(route_targets),
                progress,
            },
        }
    }

    async fn report(&self, reporter_pubkey: &str) -> anyhow::Result<Value> {
        let status = self.handle.status().await?;
        let mut payload = status.payload;
        let models = if self.mode == "serve" {
            models_from_status_payload(&payload)
        } else {
            Vec::new()
        };
        let endpoint_addr = status.invite_token.unwrap_or_default();
        let endpoint_id = if endpoint_addr.is_empty() {
            None
        } else {
            transport_policy::validate_advertised_endpoint(&endpoint_addr)
                .ok()
                .map(|validated| validated.endpoint_id)
        };
        payload["models"] = serde_json::to_value(&models)?;
        payload["serveTargets"] = if endpoint_addr.is_empty() {
            json!([])
        } else {
            Value::Array(
                models
                    .into_iter()
                    .map(|model| {
                        json!({
                            "modelId": model.id,
                            "modelName": model.name,
                            "endpointAddr": endpoint_addr,
                            "endpointId": endpoint_id,
                            "deviceId": endpoint_id,
                        })
                    })
                    .collect(),
            )
        };
        bind_report(reporter_pubkey, &mut payload)?;
        Ok(payload)
    }

    async fn stop(self) -> anyhow::Result<()> {
        match tokio::time::timeout(STOP_TIMEOUT, self.handle.stop()).await {
            Ok(result) => result,
            Err(_) => anyhow::bail!("timed out waiting for shared compute to stop"),
        }
    }

    async fn dial(&self, join_token: &str) -> anyhow::Result<()> {
        let validated = transport_policy::validate_advertised_endpoint(join_token)?;
        self.handle.join_token(validated.join_token).await
    }
}

async fn status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<NodeStatus>> {
    authorize(&state, &headers)?;
    Ok(Json(snapshot(&state).await))
}

async fn model_catalog(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<(HeaderMap, Json<catalog::MeshModelCatalog>)> {
    authorize(&state, &headers)?;
    let catalog = tokio::task::spawn_blocking(catalog::model_catalog)
        .await
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "model catalog is unavailable",
            )
        })?;
    Ok((no_store_headers(), Json(catalog)))
}

async fn installed_models(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    authorize(&state, &headers)?;
    let models = tokio::task::spawn_blocking(scan_installed_models)
        .await
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "installed models are unavailable",
            )
        })?;
    Ok((no_store_headers(), Json(json!({ "models": models }))))
}

async fn serving_usage(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<(HeaderMap, Json<usage::MeshServingUsage>)> {
    authorize(&state, &headers)?;
    let slot = state.slot.lock().await;
    let value = match &*slot {
        RuntimeSlot::Running(runtime) => runtime
            .handle
            .status()
            .await
            .map(|status| usage::serving_usage_from_payload(&status.payload))
            .unwrap_or_default(),
        _ => usage::MeshServingUsage::default(),
    };
    Ok((no_store_headers(), Json(value)))
}

async fn status_report(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    authorize(&state, &headers)?;
    let slot = state.slot.lock().await;
    let payload = match &*slot {
        RuntimeSlot::Running(runtime) => {
            runtime.report(&state.reporter_pubkey).await.map_err(|_| {
                api_error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "shared compute status is unavailable",
                )
            })?
        }
        RuntimeSlot::Starting(_)
        | RuntimeSlot::StartingClient(_)
        | RuntimeSlot::Failed { .. }
        | RuntimeSlot::FailedClient { .. }
        | RuntimeSlot::Off => stopped_report(&state.reporter_pubkey).map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "shared compute identity is unavailable",
            )
        })?,
    };
    Ok((no_store_headers(), Json(payload)))
}

async fn start(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<(StatusCode, Json<NodeStatus>)> {
    authorize(&state, &headers)?;
    let mut request: StartRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid request body"))?;
    validate_start_request(&mut request)
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, &error.to_string()))?;
    let client_runtime = {
        let mut slot = state.slot.lock().await;
        match &*slot {
            RuntimeSlot::Running(runtime) if runtime.mode == "client" => {
                match std::mem::replace(&mut *slot, RuntimeSlot::Off) {
                    RuntimeSlot::Running(runtime) => Some(runtime),
                    _ => None,
                }
            }
            RuntimeSlot::StartingClient(_) => {
                return Err(api_error(
                    StatusCode::CONFLICT,
                    "shared compute client is still starting",
                ));
            }
            RuntimeSlot::FailedClient { .. } | RuntimeSlot::Off => None,
            RuntimeSlot::Starting(_) | RuntimeSlot::Running(_) | RuntimeSlot::Failed { .. } => {
                return Err(api_error(
                    StatusCode::CONFLICT,
                    "shared compute is already running",
                ));
            }
        }
    };
    if let Some(runtime) = client_runtime {
        runtime.stop().await.map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "shared compute client did not stop cleanly",
            )
        })?;
    }
    {
        let mut slot = state.slot.lock().await;
        match &*slot {
            RuntimeSlot::Off | RuntimeSlot::Failed { .. } | RuntimeSlot::FailedClient { .. } => {}
            RuntimeSlot::Starting(_) => {
                return Ok((
                    StatusCode::ACCEPTED,
                    Json(snapshot_locked(&state, &slot).await),
                ));
            }
            RuntimeSlot::StartingClient(_) | RuntimeSlot::Running(_) => {
                return Err(api_error(
                    StatusCode::CONFLICT,
                    "shared compute is already running",
                ));
            }
        }
        *slot = RuntimeSlot::Starting(request.clone());
    }
    if let Ok(mut progress) = state.progress.write() {
        *progress = None;
    }
    let config = PersistedConfig {
        enabled: true,
        model_id: request.model_id.clone(),
        max_vram_gb: request.max_vram_gb,
    };
    save_config(&state.data_dir, &config).await.map_err(|_| {
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "could not save shared compute configuration",
        )
    })?;
    *state.persisted.write().await = config;
    let launch_state = Arc::clone(&state);
    let mesh_name = state.mesh_name.clone();
    tokio::spawn(async move {
        let result = MeshRuntime::start(request.clone(), &mesh_name).await;
        let mut slot = launch_state.slot.lock().await;
        if !matches!(&*slot, RuntimeSlot::Starting(active) if same_request(active, &request)) {
            if let Ok(runtime) = result {
                let _ = runtime.stop().await;
            }
            return;
        }
        *slot = match result {
            Ok(runtime) => RuntimeSlot::Running(runtime),
            Err(error) => {
                tracing::warn!(%error, "shared compute start failed");
                RuntimeSlot::Failed {
                    request,
                    error: format!("{error:#}"),
                }
            }
        };
    });
    Ok((StatusCode::ACCEPTED, Json(snapshot(&state).await)))
}

async fn ensure_client(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<NodeStatus>> {
    authorize(&state, &headers)?;
    let mut request: ClientRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid request body"))?;
    let target_fingerprint = request
        .join_token
        .as_deref()
        .map(join_token_fingerprint)
        .unwrap_or_default();
    validate_client_request(&mut request)
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, &error.to_string()))?;

    let stale_client = {
        let mut slot = state.slot.lock().await;
        match &*slot {
            RuntimeSlot::Running(runtime)
                if runtime.mode == "serve" || runtime.roster_version == request.roster_version =>
            {
                if let Some(join_token) = request.join_token.as_deref() {
                    runtime.dial(join_token).await.map_err(|error| {
                        api_error(
                            StatusCode::SERVICE_UNAVAILABLE,
                            &format!("shared compute could not join the serving member: {error}"),
                        )
                    })?;
                }
                let route_targets = Arc::clone(&runtime.route_targets);
                drop(slot);
                wait_for_inference(&request.model_id)
                    .await
                    .map_err(|error| {
                        api_error(
                            StatusCode::SERVICE_UNAVAILABLE,
                            &format!("shared compute inference is not ready: {error}"),
                        )
                    })?;
                route_targets
                    .write()
                    .await
                    .insert(request.model_id.clone(), target_fingerprint);
                return Ok(Json(snapshot(&state).await));
            }
            RuntimeSlot::Running(_) => match std::mem::replace(&mut *slot, RuntimeSlot::Off) {
                RuntimeSlot::Running(runtime) => Some(runtime),
                _ => None,
            },
            RuntimeSlot::Starting(_) | RuntimeSlot::StartingClient(_) => {
                return Err(api_error(
                    StatusCode::CONFLICT,
                    "shared compute is still starting",
                ));
            }
            RuntimeSlot::Failed { .. } => {
                return Err(api_error(
                    StatusCode::CONFLICT,
                    "the configured shared-compute server is unavailable",
                ));
            }
            RuntimeSlot::FailedClient { .. } | RuntimeSlot::Off => None,
        }
    };
    if let Some(runtime) = stale_client {
        runtime.stop().await.map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "stale shared compute client did not stop cleanly",
            )
        })?;
    }
    if request.join_token.is_none() {
        return Err(api_error(
            StatusCode::CONFLICT,
            "no live relay member is serving this model",
        ));
    }

    {
        let mut slot = state.slot.lock().await;
        *slot = RuntimeSlot::StartingClient(request.clone());
    }
    let result =
        MeshRuntime::start_client(request.clone(), &state.mesh_name, target_fingerprint).await;
    let mut slot = state.slot.lock().await;
    if !matches!(&*slot, RuntimeSlot::StartingClient(active) if same_client_request(active, &request))
    {
        if let Ok(runtime) = result {
            let _ = runtime.stop().await;
        }
        return Err(api_error(
            StatusCode::CONFLICT,
            "shared compute changed while the client was starting",
        ));
    }
    *slot = match result {
        Ok(runtime) => RuntimeSlot::Running(runtime),
        Err(error) => {
            let message = format!("{error:#}");
            tracing::warn!(%error, "shared compute client start failed");
            RuntimeSlot::FailedClient {
                request,
                error: message.clone(),
            }
        }
    };
    let snapshot = snapshot_locked(&state, &slot).await;
    if matches!(snapshot.state, NodeState::Failed) {
        return Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            snapshot
                .health
                .reason
                .as_deref()
                .unwrap_or("shared compute client failed to start"),
        ));
    }
    Ok(Json(snapshot))
}

async fn stop(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<NodeStatus>> {
    authorize(&state, &headers)?;
    let runtime = {
        let mut slot = state.slot.lock().await;
        match std::mem::replace(&mut *slot, RuntimeSlot::Off) {
            RuntimeSlot::Starting(request) => {
                *slot = RuntimeSlot::Starting(request);
                return Err(api_error(
                    StatusCode::CONFLICT,
                    "shared compute is still starting",
                ));
            }
            RuntimeSlot::StartingClient(request) => {
                *slot = RuntimeSlot::StartingClient(request);
                return Ok(Json(snapshot_locked(&state, &slot).await));
            }
            RuntimeSlot::Running(runtime) if runtime.mode == "client" => {
                *slot = RuntimeSlot::Running(runtime);
                return Ok(Json(snapshot_locked(&state, &slot).await));
            }
            RuntimeSlot::FailedClient { request, error } => {
                *slot = RuntimeSlot::FailedClient { request, error };
                return Ok(Json(snapshot_locked(&state, &slot).await));
            }
            RuntimeSlot::Running(runtime) => Some(runtime),
            RuntimeSlot::Failed { .. } | RuntimeSlot::Off => None,
        }
    };
    if let Some(runtime) = runtime {
        runtime.stop().await.map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "shared compute did not stop cleanly",
            )
        })?;
    }
    let config = PersistedConfig::default();
    save_config(&state.data_dir, &config).await.map_err(|_| {
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "could not save shared compute configuration",
        )
    })?;
    *state.persisted.write().await = config;
    if let Ok(mut progress) = state.progress.write() {
        *progress = None;
    }
    Ok(Json(snapshot(&state).await))
}

async fn snapshot(state: &AppState) -> NodeStatus {
    let slot = state.slot.lock().await;
    snapshot_locked(state, &slot).await
}

async fn snapshot_locked(state: &AppState, slot: &RuntimeSlot) -> NodeStatus {
    let persisted = state.persisted.read().await.clone();
    let desired_enabled = persisted.enabled;
    let progress = state.progress.read().ok().and_then(|value| value.clone());
    match slot {
        RuntimeSlot::Off => NodeStatus {
            state: NodeState::Off,
            mode: None,
            health: Health {
                status: HealthStatus::Ok,
                reason: None,
            },
            api_base_url: None,
            console_url: None,
            model_id: desired_enabled.then(|| persisted.model_id.clone()),
            model_name: desired_enabled.then(|| persisted.model_id.clone()),
            max_vram_gb: persisted.max_vram_gb,
            endpoint_id: None,
            device_id: None,
            device_name: None,
            desired_enabled,
            roster_version: None,
            route_targets: None,
            progress,
        },
        RuntimeSlot::Starting(request) => NodeStatus {
            state: NodeState::Starting,
            mode: Some("serve"),
            health: Health {
                status: HealthStatus::Degraded,
                reason: Some("preparing shared compute".into()),
            },
            api_base_url: None,
            console_url: None,
            model_id: Some(request.model_id.clone()),
            model_name: Some(request.model_id.clone()),
            max_vram_gb: request.max_vram_gb,
            endpoint_id: None,
            device_id: None,
            device_name: None,
            desired_enabled,
            roster_version: Some(request.roster_version.clone()),
            route_targets: None,
            progress,
        },
        RuntimeSlot::StartingClient(request) => NodeStatus {
            state: NodeState::Starting,
            mode: Some("client"),
            health: Health {
                status: HealthStatus::Degraded,
                reason: Some("connecting to shared compute".into()),
            },
            api_base_url: None,
            console_url: None,
            model_id: Some(request.model_id.clone()),
            model_name: Some(request.model_id.clone()),
            max_vram_gb: None,
            endpoint_id: None,
            device_id: None,
            device_name: None,
            desired_enabled,
            roster_version: Some(request.roster_version.clone()),
            route_targets: None,
            progress: None,
        },
        RuntimeSlot::Running(runtime) => runtime.status(desired_enabled, progress).await,
        RuntimeSlot::Failed { request, error } => NodeStatus {
            state: NodeState::Failed,
            mode: Some("serve"),
            health: Health {
                status: HealthStatus::Failed,
                reason: Some(error.clone()),
            },
            api_base_url: None,
            console_url: None,
            model_id: Some(request.model_id.clone()),
            model_name: Some(request.model_id.clone()),
            max_vram_gb: request.max_vram_gb,
            endpoint_id: None,
            device_id: None,
            device_name: None,
            desired_enabled,
            roster_version: Some(request.roster_version.clone()),
            route_targets: None,
            progress,
        },
        RuntimeSlot::FailedClient { request, error } => NodeStatus {
            state: NodeState::Failed,
            mode: Some("client"),
            health: Health {
                status: HealthStatus::Failed,
                reason: Some(error.clone()),
            },
            api_base_url: None,
            console_url: None,
            model_id: Some(request.model_id.clone()),
            model_name: Some(request.model_id.clone()),
            max_vram_gb: None,
            endpoint_id: None,
            device_id: None,
            device_name: None,
            desired_enabled,
            roster_version: Some(request.roster_version.clone()),
            route_targets: None,
            progress: None,
        },
    }
}

fn validate_start_request(request: &mut StartRequest) -> anyhow::Result<()> {
    request.model_id = request.model_id.trim().to_string();
    if !is_hosted_model_ref(&request.model_id) {
        anyhow::bail!("modelId must be a catalog or Hugging Face model reference");
    }
    request.model_id = catalog::canonical_curated_model_id(&request.model_id).to_string();
    if request.trusted_owner_ids.len() > MAX_TRUSTED_OWNERS {
        anyhow::bail!("too many trusted owners");
    }
    for owner in &mut request.trusted_owner_ids {
        *owner = owner.trim().to_ascii_lowercase();
        validate_hex_id(owner, "trusted owner")?;
    }
    request.trusted_owner_ids.sort();
    request.trusted_owner_ids.dedup();
    validate_hex_id(&request.roster_version, "rosterVersion")?;
    if let Some(max_vram_gb) = request.max_vram_gb {
        if !(1..=1024).contains(&max_vram_gb) {
            anyhow::bail!("maxVramGb must be between 1 and 1024");
        }
    }
    if let Some(token) = request.join_token.as_mut() {
        *token = token.trim().to_string();
        if token.is_empty() || token.len() > MAX_JOIN_TOKEN_BYTES {
            anyhow::bail!("joinToken is invalid");
        }
        *token = transport_policy::validate_advertised_endpoint(token)?.join_token;
    }
    Ok(())
}

fn validate_client_request(request: &mut ClientRequest) -> anyhow::Result<()> {
    request.model_id = request.model_id.trim().to_string();
    if !is_hosted_model_ref(&request.model_id) {
        anyhow::bail!("modelId must be a catalog or Hugging Face model reference");
    }
    request.model_id = catalog::canonical_curated_model_id(&request.model_id).to_string();
    normalize_roster(&mut request.trusted_owner_ids, &request.roster_version)?;
    if let Some(token) = request.join_token.as_mut() {
        *token = token.trim().to_string();
        if token.is_empty() || token.len() > MAX_JOIN_TOKEN_BYTES {
            anyhow::bail!("joinToken is invalid");
        }
        *token = transport_policy::validate_advertised_endpoint(token)?.join_token;
    }
    Ok(())
}

fn normalize_roster(owners: &mut Vec<String>, roster_version: &str) -> anyhow::Result<()> {
    if owners.len() > MAX_TRUSTED_OWNERS {
        anyhow::bail!("too many trusted owners");
    }
    for owner in owners.iter_mut() {
        *owner = owner.trim().to_ascii_lowercase();
        validate_hex_id(owner, "trusted owner")?;
    }
    owners.sort();
    owners.dedup();
    validate_hex_id(roster_version, "rosterVersion")
}

fn is_hosted_model_ref(value: &str) -> bool {
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

fn validate_hex_id(value: &str, field: &str) -> anyhow::Result<()> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        anyhow::bail!("{field} is invalid");
    }
    Ok(())
}

fn same_request(left: &StartRequest, right: &StartRequest) -> bool {
    left.model_id == right.model_id && left.max_vram_gb == right.max_vram_gb
}

fn same_client_request(left: &ClientRequest, right: &ClientRequest) -> bool {
    left.model_id == right.model_id
        && left.join_token == right.join_token
        && left.roster_version == right.roster_version
}

fn join_token_fingerprint(value: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(value.trim().as_bytes()))
}

fn mesh_name_for_relay(relay_url: &str) -> String {
    use sha2::{Digest, Sha256};
    let normalized = url::Url::parse(relay_url.trim())
        .map(|url| url.origin().ascii_serialization())
        .unwrap_or_else(|_| relay_url.trim().trim_end_matches('/').to_ascii_lowercase());
    let digest = hex::encode(Sha256::digest(normalized.as_bytes()));
    format!("buzz-community-{}", &digest[..32])
}

async fn ensure_model_downloaded(model: &str) -> anyhow::Result<()> {
    let wanted = model.replace("@main", "");
    let installed = tokio::task::spawn_blocking(move || {
        mesh_llm_node::models::scan_installed_models(
            mesh_llm_node::models::default_huggingface_cache_dir(),
        )
        .iter()
        .any(|entry| entry.model_ref.replace("@main", "").contains(&wanted))
    })
    .await
    .unwrap_or(false);
    if !installed {
        mesh_llm_host_runtime::models::download_model_ref_with_progress_details(model, true)
            .await
            .map_err(|error| anyhow::anyhow!("downloading {model} failed: {error}"))?;
    }
    Ok(())
}

async fn wait_for_inference(model: &str) -> anyhow::Result<()> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(120);
    let mut last_error = "shared compute is not ready".to_string();
    while tokio::time::Instant::now() < deadline {
        match client
            .post(format!(
                "http://127.0.0.1:{DEFAULT_API_PORT}/v1/chat/completions"
            ))
            .bearer_auth("buzz-mesh-local")
            .json(&json!({
                "model": model,
                "messages": [{"role": "user", "content": "Reply OK"}],
                "max_tokens": 1,
                "stream": false
            }))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => return Ok(()),
            Ok(response) => {
                last_error = format!("HTTP {}", response.status());
            }
            Err(error) => last_error = error.to_string(),
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    anyhow::bail!("model loaded but inference never became ready: {last_error}")
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelOption {
    id: String,
    name: Option<String>,
}

fn models_from_status_payload(payload: &Value) -> Vec<ModelOption> {
    let mut by_id = BTreeMap::<String, Option<String>>::new();
    for key in ["models", "hosted_models"] {
        if let Some(value) = payload.get(key) {
            collect_model_options(value, &mut by_id);
        }
    }
    if let Some(models) = payload
        .get("runtime")
        .and_then(|runtime| runtime.get("models"))
        .and_then(Value::as_array)
    {
        for model in models {
            if model.get("status").and_then(Value::as_str) == Some("ready") {
                collect_model_options(model, &mut by_id);
            }
        }
    }
    by_id
        .into_iter()
        .map(|(id, name)| ModelOption { id, name })
        .collect()
}

fn collect_model_options(value: &Value, out: &mut BTreeMap<String, Option<String>>) {
    match value {
        Value::Object(map) => {
            if let Some(id) = map
                .get("model_id")
                .or_else(|| map.get("modelId"))
                .or_else(|| map.get("model_ref"))
                .or_else(|| map.get("modelRef"))
                .or_else(|| map.get("id"))
                .or_else(|| map.get("name"))
                .and_then(Value::as_str)
            {
                let canonical = id.trim().replace("@main", "");
                if !canonical.is_empty() && !canonical.starts_with("http") {
                    let name = map
                        .get("display_name")
                        .or_else(|| map.get("displayName"))
                        .and_then(Value::as_str)
                        .map(ToString::to_string);
                    out.entry(canonical).or_insert(name);
                }
            } else {
                for child in map.values() {
                    collect_model_options(child, out);
                }
            }
        }
        Value::Array(values) => {
            for child in values {
                collect_model_options(child, out);
            }
        }
        Value::String(id) => {
            let canonical = id.trim().replace("@main", "");
            if !canonical.is_empty() && !canonical.starts_with("http") {
                out.entry(canonical).or_insert(None);
            }
        }
        _ => {}
    }
}

fn scan_installed_models() -> Vec<ModelOption> {
    mesh_llm_node::models::scan_installed_models(
        mesh_llm_node::models::default_huggingface_cache_dir(),
    )
    .into_iter()
    .map(|entry| ModelOption {
        id: entry.model_ref,
        name: None,
    })
    .collect()
}

fn bind_report(reporter_pubkey: &str, payload: &mut Value) -> anyhow::Result<()> {
    let identity = identity::ensure_owner_identity()?;
    let endpoint_tokens = identity::advertised_endpoint_tokens(payload)
        .ok_or_else(|| anyhow::anyhow!("mesh status has malformed serveTargets"))?;
    payload["ownerId"] = Value::String(identity.owner_id.clone());
    payload["ownerVerifyingKey"] = Value::String(identity.verifying_key_hex.clone());
    payload["ownerBindingSig"] = Value::String(identity.sign_member_binding(reporter_pubkey)?);
    payload["ownerEndpointBindingSig"] =
        Value::String(identity.sign_member_endpoint_binding(reporter_pubkey, &endpoint_tokens)?);
    Ok(())
}

fn stopped_report(reporter_pubkey: &str) -> anyhow::Result<Value> {
    let mut payload = json!({ "serveTargets": [], "models": [] });
    bind_report(reporter_pubkey, &mut payload)?;
    Ok(payload)
}

fn string_value(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn short_endpoint_label(endpoint_id: &str) -> String {
    endpoint_id.chars().take(12).collect()
}

fn authorize(state: &AppState, headers: &HeaderMap) -> ApiResult<()> {
    let presented = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or("");
    if presented.len() != state.token.len()
        || presented
            .as_bytes()
            .ct_eq(state.token.as_bytes())
            .unwrap_u8()
            != 1
    {
        return Err(api_error(StatusCode::UNAUTHORIZED, "unauthorized"));
    }
    Ok(())
}

type ApiError = (StatusCode, Json<Value>);
type ApiResult<T> = Result<T, ApiError>;

fn api_error(status: StatusCode, message: &str) -> ApiError {
    (status, Json(json!({ "error": message })))
}

fn no_store_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    headers
}

fn config_path(data_dir: &Path) -> PathBuf {
    data_dir.join("sharing.json")
}

async fn load_config(data_dir: &Path) -> anyhow::Result<PersistedConfig> {
    match tokio::fs::read(config_path(data_dir)).await {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(PersistedConfig::default()),
        Err(error) => Err(error.into()),
    }
}

async fn save_config(data_dir: &Path, config: &PersistedConfig) -> anyhow::Result<()> {
    let path = config_path(data_dir);
    let temporary = data_dir.join("sharing.json.tmp");
    let bytes = serde_json::to_vec_pretty(config)?;
    tokio::fs::write(&temporary, bytes).await?;
    tokio::fs::rename(temporary, path).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(model_id: &str) -> StartRequest {
        StartRequest {
            model_id: model_id.into(),
            max_vram_gb: Some(16),
            join_token: None,
            trusted_owner_ids: vec!["cd".repeat(32)],
            roster_version: "ab".repeat(32),
        }
    }

    fn client_request(model_id: &str) -> ClientRequest {
        ClientRequest {
            model_id: model_id.into(),
            join_token: None,
            trusted_owner_ids: vec!["cd".repeat(32)],
            roster_version: "ab".repeat(32),
        }
    }

    #[test]
    fn rejects_server_local_model_paths_and_urls() {
        for model in [
            "/etc/passwd",
            "file:///tmp/model.gguf",
            "../model.gguf",
            "model.gguf",
            r"C:\\model.gguf",
            "http://169.254.169.254/latest/meta-data",
            "https://attacker.example/model",
            "ftp:attacker.example/model",
            "org/model?download=1",
            "org/model#revision",
            "org/model\nnext",
        ] {
            assert!(validate_start_request(&mut request(model)).is_err());
        }
    }

    #[test]
    fn accepts_catalog_and_hugging_face_references() {
        for model in [
            "Gemma-4-E4B-it-Q4_K_M",
            "unsloth/gemma-4-E4B-it-GGUF:Q4_K_M",
            "hf://meshllm/qwen3-8b@main",
        ] {
            validate_start_request(&mut request(model)).unwrap();
        }
    }

    #[test]
    fn validates_owner_roster_shape_and_limits() {
        let mut value = request("org/model");
        value.trusted_owner_ids = vec!["not-hex".into()];
        assert!(validate_start_request(&mut value).is_err());
        let mut value = request("org/model");
        value.trusted_owner_ids = (0..=MAX_TRUSTED_OWNERS).map(|_| "aa".repeat(32)).collect();
        assert!(validate_start_request(&mut value).is_err());
        let mut value = request("org/model");
        value.roster_version = "not-hex".into();
        assert!(validate_start_request(&mut value).is_err());
    }

    #[test]
    fn client_requests_share_model_and_roster_validation() {
        assert!(validate_client_request(&mut client_request("auto")).is_ok());
        assert!(
            validate_client_request(&mut client_request("unsloth/gemma-4-E4B-it-GGUF:Q4_K_M"))
                .is_ok()
        );
        assert!(validate_client_request(&mut client_request(
            "http://169.254.169.254/latest/meta-data"
        ))
        .is_err());

        let mut invalid_roster = client_request("auto");
        invalid_roster.trusted_owner_ids = vec!["not-hex".into()];
        assert!(validate_client_request(&mut invalid_roster).is_err());
    }

    #[test]
    fn route_fingerprint_detects_target_rotation_without_whitespace_noise() {
        assert_eq!(
            join_token_fingerprint(" token-a "),
            join_token_fingerprint("token-a")
        );
        assert_ne!(
            join_token_fingerprint("token-a"),
            join_token_fingerprint("token-b")
        );
    }
}
