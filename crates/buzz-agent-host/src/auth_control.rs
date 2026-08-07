//! Private, bearer-authenticated control port for vendor subscription login.

use std::{
    collections::HashMap,
    net::SocketAddr,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};

use axum::{
    body::Bytes,
    extract::{Path as AxumPath, State},
    http::{header, HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use buzz_agent_host::subscription_auth_command;
use buzz_core::CommunityId;
use buzz_db::{managed_agent_host::ManagedAgentHostRecord, Db};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{ChildStdin, Command},
    sync::{oneshot, Mutex, RwLock},
};
use uuid::Uuid;

const MAX_OUTPUT_BYTES: usize = 32 * 1024;
const MAX_RUNTIME_LOG_BYTES: usize = 128 * 1024;
const MAX_INPUT_BYTES: usize = 4096;
const LOGIN_TIMEOUT: Duration = Duration::from_secs(15 * 60);

type SessionKey = (Uuid, Uuid);

#[derive(Clone, Default)]
pub struct RuntimeLogStore {
    logs: Arc<RwLock<HashMap<SessionKey, RuntimeLog>>>,
}

#[derive(Clone, Default, Serialize)]
pub struct RuntimeLog {
    output: String,
    truncated: bool,
}

impl RuntimeLogStore {
    pub async fn reset(&self, community: Uuid, id: Uuid) {
        self.logs
            .write()
            .await
            .insert((community, id), RuntimeLog::default());
    }

    pub async fn append(&self, community: Uuid, id: Uuid, stream: &str, value: &str) {
        let mut logs = self.logs.write().await;
        let log = logs.entry((community, id)).or_default();
        log.output.push('[');
        log.output.push_str(stream);
        log.output.push_str("] ");
        log.output.push_str(value);
        if !value.ends_with('\n') {
            log.output.push('\n');
        }
        if log.output.len() > MAX_RUNTIME_LOG_BYTES {
            let mut start = log.output.len() - MAX_RUNTIME_LOG_BYTES;
            while !log.output.is_char_boundary(start) {
                start += 1;
            }
            log.output.drain(..start);
            log.truncated = true;
        }
    }

    async fn snapshot(&self, community: Uuid, id: Uuid) -> RuntimeLog {
        self.logs
            .read()
            .await
            .get(&(community, id))
            .cloned()
            .unwrap_or_default()
    }
}

#[derive(Clone)]
pub struct AuthControlState {
    db: Db,
    token: Arc<String>,
    mesh_token: Arc<String>,
    data_dir: PathBuf,
    runtime_path: Arc<String>,
    sessions: Arc<RwLock<HashMap<SessionKey, Arc<AuthSession>>>>,
    runtime_logs: RuntimeLogStore,
}

struct AuthSession {
    snapshot: RwLock<AuthSnapshot>,
    stdin: Mutex<Option<ChildStdin>>,
    cancel: Mutex<Option<oneshot::Sender<()>>>,
}

#[derive(Clone, Serialize)]
pub struct AuthSnapshot {
    state: &'static str,
    connected: bool,
    needs_input: bool,
    output: String,
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthInput {
    value: String,
}

pub async fn serve(
    bind: SocketAddr,
    db: Db,
    token: String,
    mesh_token: String,
    data_dir: PathBuf,
    runtime_path: String,
    runtime_logs: RuntimeLogStore,
) -> anyhow::Result<()> {
    let state = AuthControlState {
        db,
        token: Arc::new(token),
        mesh_token: Arc::new(mesh_token),
        data_dir,
        runtime_path: Arc::new(runtime_path),
        sessions: Arc::new(RwLock::new(HashMap::new())),
        runtime_logs,
    };
    let router = Router::new()
        .route(
            "/v1/agents/{community}/{id}/auth",
            get(status).post(start).delete(cancel),
        )
        .route("/v1/agents/{community}/{id}/auth/input", post(input))
        .route("/v1/agents/{community}/{id}/logs", get(runtime_log))
        .route("/v1/compute/status", get(compute_status))
        .route("/v1/compute/catalog", get(compute_catalog))
        .route("/v1/compute/models", get(compute_models))
        .route("/v1/compute/usage", get(compute_usage))
        .route("/v1/compute/report", get(compute_report))
        .route("/v1/compute/start", post(compute_start))
        .route("/v1/compute/ensure-client", post(compute_ensure_client))
        .route("/v1/compute/stop", post(compute_stop))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(%bind, "agent authentication control port ready");
    axum::serve(listener, router).await?;
    Ok(())
}

type ControlResponse = (StatusCode, HeaderMap, Json<serde_json::Value>);

async fn compute_status(
    State(state): State<AuthControlState>,
    headers: HeaderMap,
) -> Result<ControlResponse, (StatusCode, Json<serde_json::Value>)> {
    authorize(&state, &headers)?;
    proxy_compute(&state, reqwest::Method::GET, "status", None).await
}

async fn compute_catalog(
    State(state): State<AuthControlState>,
    headers: HeaderMap,
) -> Result<ControlResponse, (StatusCode, Json<serde_json::Value>)> {
    authorize(&state, &headers)?;
    proxy_compute(&state, reqwest::Method::GET, "catalog", None).await
}

async fn compute_models(
    State(state): State<AuthControlState>,
    headers: HeaderMap,
) -> Result<ControlResponse, (StatusCode, Json<serde_json::Value>)> {
    authorize(&state, &headers)?;
    proxy_compute(&state, reqwest::Method::GET, "models", None).await
}

async fn compute_usage(
    State(state): State<AuthControlState>,
    headers: HeaderMap,
) -> Result<ControlResponse, (StatusCode, Json<serde_json::Value>)> {
    authorize(&state, &headers)?;
    proxy_compute(&state, reqwest::Method::GET, "usage", None).await
}

async fn compute_report(
    State(state): State<AuthControlState>,
    headers: HeaderMap,
) -> Result<ControlResponse, (StatusCode, Json<serde_json::Value>)> {
    authorize(&state, &headers)?;
    proxy_compute(&state, reqwest::Method::GET, "report", None).await
}

async fn compute_start(
    State(state): State<AuthControlState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<ControlResponse, (StatusCode, Json<serde_json::Value>)> {
    authorize(&state, &headers)?;
    if body.len() > 128 * 1024 {
        return Err(error(StatusCode::PAYLOAD_TOO_LARGE, "request is too large"));
    }
    proxy_compute(&state, reqwest::Method::POST, "start", Some(body)).await
}

async fn compute_ensure_client(
    State(state): State<AuthControlState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<ControlResponse, (StatusCode, Json<serde_json::Value>)> {
    authorize(&state, &headers)?;
    if body.len() > 128 * 1024 {
        return Err(error(StatusCode::PAYLOAD_TOO_LARGE, "request is too large"));
    }
    proxy_compute(&state, reqwest::Method::POST, "ensure-client", Some(body)).await
}

async fn compute_stop(
    State(state): State<AuthControlState>,
    headers: HeaderMap,
) -> Result<ControlResponse, (StatusCode, Json<serde_json::Value>)> {
    authorize(&state, &headers)?;
    proxy_compute(&state, reqwest::Method::POST, "stop", Some(Bytes::new())).await
}

async fn proxy_compute(
    state: &AuthControlState,
    method: reqwest::Method,
    action: &'static str,
    body: Option<Bytes>,
) -> Result<ControlResponse, (StatusCode, Json<serde_json::Value>)> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10 * 60))
        .build()
        .map_err(|_| {
            error(
                StatusCode::SERVICE_UNAVAILABLE,
                "shared compute is unavailable",
            )
        })?;
    let mut request = client
        .request(method, format!("http://127.0.0.1:8091/v1/compute/{action}"))
        .bearer_auth(state.mesh_token.as_str())
        .header(reqwest::header::ACCEPT, "application/json");
    if let Some(body) = body {
        request = request
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body);
    }
    let response = request.send().await.map_err(|_| {
        error(
            StatusCode::SERVICE_UNAVAILABLE,
            "shared compute is unavailable",
        )
    })?;
    let status =
        StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let bytes = response.bytes().await.map_err(|_| {
        error(
            StatusCode::BAD_GATEWAY,
            "shared compute returned an invalid response",
        )
    })?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err(error(
            StatusCode::BAD_GATEWAY,
            "shared compute response is too large",
        ));
    }
    let value = serde_json::from_slice(&bytes).map_err(|_| {
        error(
            StatusCode::BAD_GATEWAY,
            "shared compute returned an invalid response",
        )
    })?;
    let mut response_headers = HeaderMap::new();
    response_headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    Ok((status, response_headers, Json(value)))
}

async fn runtime_log(
    State(state): State<AuthControlState>,
    AxumPath((community, id)): AxumPath<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<RuntimeLog>), (StatusCode, Json<serde_json::Value>)> {
    authorize(&state, &headers)?;
    let _ = load_agent(&state, community, id).await?;
    let mut response_headers = HeaderMap::new();
    response_headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    Ok((
        response_headers,
        Json(state.runtime_logs.snapshot(community, id).await),
    ))
}

async fn status(
    State(state): State<AuthControlState>,
    AxumPath((community, id)): AxumPath<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<AuthSnapshot>, (StatusCode, Json<serde_json::Value>)> {
    authorize(&state, &headers)?;
    let record = load_agent(&state, community, id).await?;
    require_subscription(&record)?;
    if let Some(session) = state.sessions.read().await.get(&(community, id)).cloned() {
        return Ok(Json(session.snapshot.read().await.clone()));
    }
    let connected = login_status(&state, &record).await;
    Ok(Json(AuthSnapshot {
        state: if connected {
            "connected"
        } else {
            "disconnected"
        },
        connected,
        needs_input: false,
        output: String::new(),
        error: None,
    }))
}

async fn start(
    State(state): State<AuthControlState>,
    AxumPath((community, id)): AxumPath<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<AuthSnapshot>, (StatusCode, Json<serde_json::Value>)> {
    authorize(&state, &headers)?;
    let record = load_agent(&state, community, id).await?;
    require_subscription(&record)?;
    if record.desired_state != "stopped" || record.observed_state != "stopped" {
        return Err(error(
            StatusCode::CONFLICT,
            "agent must be fully stopped before authentication",
        ));
    }
    let Some((program, args)) = subscription_auth_command(&record.runtime) else {
        return Err(error(
            StatusCode::CONFLICT,
            "runtime does not support subscription login",
        ));
    };
    let key = (community, id);
    if let Some(existing) = state.sessions.read().await.get(&key).cloned() {
        if existing.snapshot.read().await.state == "waiting" {
            return Ok(Json(existing.snapshot.read().await.clone()));
        }
    }

    let uid = u32::try_from(record.sandbox_uid)
        .map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "invalid agent sandbox"))?;
    let workdir = state.data_dir.join(id.to_string());
    super::prepare_workdir(&workdir, uid).await.map_err(|_| {
        error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "could not prepare agent sandbox",
        )
    })?;

    let mut command = Command::new(program);
    command
        .args(args)
        .env_clear()
        .env("PATH", state.runtime_path.as_str())
        .env("HOME", &workdir)
        .current_dir(&workdir)
        .kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        command.process_group(0).uid(uid).gid(uid);
    }
    let mut child = command.spawn().map_err(|_| {
        error(
            StatusCode::SERVICE_UNAVAILABLE,
            "could not start authentication",
        )
    })?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (cancel_tx, cancel_rx) = oneshot::channel();
    let session = Arc::new(AuthSession {
        snapshot: RwLock::new(AuthSnapshot {
            state: "waiting",
            connected: false,
            needs_input: record.runtime == "claude",
            output: String::new(),
            error: None,
        }),
        stdin: Mutex::new(stdin),
        cancel: Mutex::new(Some(cancel_tx)),
    });
    state.sessions.write().await.insert(key, session.clone());

    let stdout_task = stdout.map(|reader| tokio::spawn(pump_output(reader, session.clone())));
    let stderr_task = stderr.map(|reader| tokio::spawn(pump_output(reader, session.clone())));
    tokio::spawn(run_login(
        child,
        cancel_rx,
        session.clone(),
        stdout_task,
        stderr_task,
    ));
    let snapshot = session.snapshot.read().await.clone();
    Ok(Json(snapshot))
}

async fn input(
    State(state): State<AuthControlState>,
    AxumPath((community, id)): AxumPath<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(input): Json<AuthInput>,
) -> Result<Json<AuthSnapshot>, (StatusCode, Json<serde_json::Value>)> {
    authorize(&state, &headers)?;
    let record = load_agent(&state, community, id).await?;
    require_subscription(&record)?;
    if input.value.is_empty()
        || input.value.len() > MAX_INPUT_BYTES
        || input.value.contains(['\r', '\n'])
    {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "invalid authentication input",
        ));
    }
    let session = state
        .sessions
        .read()
        .await
        .get(&(community, id))
        .cloned()
        .ok_or_else(|| error(StatusCode::CONFLICT, "authentication is not running"))?;
    let mut stdin = session.stdin.lock().await;
    let stdin = stdin
        .as_mut()
        .ok_or_else(|| error(StatusCode::CONFLICT, "authentication does not accept input"))?;
    stdin
        .write_all(format!("{}\n", input.value).as_bytes())
        .await
        .map_err(|_| {
            error(
                StatusCode::BAD_GATEWAY,
                "could not send authentication input",
            )
        })?;
    let snapshot = session.snapshot.read().await.clone();
    Ok(Json(snapshot))
}

async fn cancel(
    State(state): State<AuthControlState>,
    AxumPath((community, id)): AxumPath<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<AuthSnapshot>, (StatusCode, Json<serde_json::Value>)> {
    authorize(&state, &headers)?;
    let record = load_agent(&state, community, id).await?;
    require_subscription(&record)?;
    let session = state
        .sessions
        .read()
        .await
        .get(&(community, id))
        .cloned()
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "authentication is not running"))?;
    if let Some(cancel) = session.cancel.lock().await.take() {
        let _ = cancel.send(());
    }
    let mut snapshot = session.snapshot.write().await;
    snapshot.state = "cancelled";
    snapshot.needs_input = false;
    snapshot.output.clear();
    snapshot.error = None;
    Ok(Json(snapshot.clone()))
}

async fn load_agent(
    state: &AuthControlState,
    community: Uuid,
    id: Uuid,
) -> Result<ManagedAgentHostRecord, (StatusCode, Json<serde_json::Value>)> {
    let record = state
        .db
        .get_managed_agent_host(CommunityId::from_uuid(community), id)
        .await
        .map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "agent lookup failed"))?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "agent not found"))?;
    Ok(record)
}

fn require_subscription(
    record: &ManagedAgentHostRecord,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if record.credential_mode != "subscription" {
        return Err(error(
            StatusCode::CONFLICT,
            "agent does not use subscription login",
        ));
    }
    Ok(())
}

fn authorize(
    state: &AuthControlState,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let supplied = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or("");
    if supplied
        .as_bytes()
        .ct_eq(state.token.as_bytes())
        .unwrap_u8()
        != 1
    {
        return Err(error(StatusCode::UNAUTHORIZED, "unauthorized"));
    }
    Ok(())
}

async fn login_status(state: &AuthControlState, record: &ManagedAgentHostRecord) -> bool {
    let uid = match u32::try_from(record.sandbox_uid) {
        Ok(uid) => uid,
        Err(_) => return false,
    };
    let workdir = state.data_dir.join(record.id.to_string());
    if !Path::new(&workdir).exists() {
        return false;
    }
    let (program, args): (&str, &[&str]) = match record.runtime.as_str() {
        "codex" => ("codex", &["login", "status"]),
        "claude" => ("claude", &["auth", "status", "--json"]),
        _ => return false,
    };
    let mut command = Command::new(program);
    command
        .args(args)
        .env_clear()
        .env("PATH", state.runtime_path.as_str())
        .env("HOME", &workdir)
        .current_dir(&workdir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    command.uid(uid).gid(uid);
    matches!(
        tokio::time::timeout(Duration::from_secs(10), command.status()).await,
        Ok(Ok(status)) if status.success()
    )
}

async fn run_login(
    mut child: tokio::process::Child,
    cancel: oneshot::Receiver<()>,
    session: Arc<AuthSession>,
    stdout_task: Option<tokio::task::JoinHandle<()>>,
    stderr_task: Option<tokio::task::JoinHandle<()>>,
) {
    let outcome = tokio::select! {
        status = child.wait() => status.map(|status| status.success()).map_err(|error| error.to_string()),
        _ = cancel => {
            super::terminate_child(&mut child).await;
            Err("Authentication cancelled.".into())
        }
        _ = tokio::time::sleep(LOGIN_TIMEOUT) => {
            super::terminate_child(&mut child).await;
            Err("Authentication timed out.".into())
        }
    };
    if let Some(task) = stdout_task {
        let _ = task.await;
    }
    if let Some(task) = stderr_task {
        let _ = task.await;
    }
    *session.stdin.lock().await = None;
    let mut snapshot = session.snapshot.write().await;
    snapshot.needs_input = false;
    match outcome {
        Ok(true) => {
            snapshot.state = "connected";
            snapshot.connected = true;
            snapshot.output.clear();
            snapshot.error = None;
        }
        Ok(false) => {
            snapshot.state = "failed";
            snapshot.error = Some("Vendor authentication did not complete.".into());
        }
        Err(message) => {
            if snapshot.state != "cancelled" {
                snapshot.state = "failed";
            }
            snapshot.error = Some(message);
        }
    }
}

async fn pump_output<R: AsyncRead + Unpin>(mut reader: R, session: Arc<AuthSession>) {
    let mut buffer = [0u8; 2048];
    loop {
        let count = match reader.read(&mut buffer).await {
            Ok(0) | Err(_) => return,
            Ok(count) => count,
        };
        let chunk = sanitize_terminal(&String::from_utf8_lossy(&buffer[..count]));
        let mut snapshot = session.snapshot.write().await;
        snapshot.output.push_str(&chunk);
        if snapshot.output.len() > MAX_OUTPUT_BYTES {
            let keep: String = snapshot
                .output
                .chars()
                .rev()
                .take(MAX_OUTPUT_BYTES)
                .collect::<String>()
                .chars()
                .rev()
                .collect();
            snapshot.output = keep;
        }
    }
}

pub(crate) fn sanitize_terminal(value: &str) -> String {
    enum EscapeState {
        Normal,
        Escape,
        Csi,
        Osc,
        OscEscape,
    }
    let mut output = String::with_capacity(value.len());
    let mut state = EscapeState::Normal;
    for ch in value.chars() {
        match state {
            EscapeState::Normal if ch == '\u{1b}' => state = EscapeState::Escape,
            EscapeState::Normal if ch == '\r' => output.push('\n'),
            EscapeState::Normal if ch == '\n' || ch == '\t' || !ch.is_control() => {
                output.push(ch);
            }
            EscapeState::Normal => {}
            EscapeState::Escape if ch == '[' => state = EscapeState::Csi,
            EscapeState::Escape if ch == ']' => state = EscapeState::Osc,
            EscapeState::Escape => state = EscapeState::Normal,
            EscapeState::Csi if ('@'..='~').contains(&ch) => state = EscapeState::Normal,
            EscapeState::Csi => {}
            EscapeState::Osc if ch == '\u{7}' => state = EscapeState::Normal,
            EscapeState::Osc if ch == '\u{1b}' => state = EscapeState::OscEscape,
            EscapeState::Osc => {}
            EscapeState::OscEscape if ch == '\\' => state = EscapeState::Normal,
            EscapeState::OscEscape => state = EscapeState::Osc,
        }
    }
    output
}

fn error(status: StatusCode, message: &str) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({ "error": message })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_output_drops_escape_and_control_sequences() {
        let value = sanitize_terminal(
            "\u{1b}[31mCode\u{1b}[0m\r\n\u{1b}]8;;https://example.com\u{7}link\u{1b}]8;;\u{7}\u{0}safe",
        );
        assert_eq!(value, "Code\n\nlinksafe");
    }

    #[test]
    fn terminal_output_preserves_login_urls_and_device_codes() {
        let value = sanitize_terminal(
            "\u{1b}[94mhttps://auth.openai.com/codex/device\u{1b}[0m\n\u{1b}[94m3T0M-X5R95\u{1b}[0m",
        );
        assert_eq!(value, "https://auth.openai.com/codex/device\n3T0M-X5R95");
    }

    #[tokio::test]
    async fn runtime_logs_are_bounded_and_tenant_scoped() {
        let store = RuntimeLogStore::default();
        let community_a = Uuid::new_v4();
        let community_b = Uuid::new_v4();
        let agent = Uuid::new_v4();
        store.reset(community_a, agent).await;
        store
            .append(
                community_a,
                agent,
                "stdout",
                &"x".repeat(MAX_RUNTIME_LOG_BYTES),
            )
            .await;

        let snapshot = store.snapshot(community_a, agent).await;
        assert!(snapshot.truncated);
        assert!(snapshot.output.len() <= MAX_RUNTIME_LOG_BYTES);
        assert!(store.snapshot(community_b, agent).await.output.is_empty());
    }
}
