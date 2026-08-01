use std::{path::PathBuf, sync::Arc, time::Duration};

use buzz_agent_host::{decrypt_secret, parse_envelope_key, runtime_command};
use buzz_core::CommunityId;
use buzz_db::{managed_agent_host::ManagedAgentLease, Db, DbConfig};
use tokio::{process::Command, task::JoinSet};
use tracing::{error, info, warn};
use uuid::Uuid;
use zeroize::Zeroizing;

mod auth_control;

const MAX_RUNTIME_LOG_LINE_BYTES: usize = 8 * 1024;

const LEASE_SECONDS: i64 = 15;
const RENEW_INTERVAL: Duration = Duration::from_secs(5);

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "buzz_agent_host=info".into()),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL")?;
    let relay_url = std::env::var("BUZZ_RELAY_URL")?;
    let envelope_key = parse_envelope_key(&std::env::var("BUZZ_AGENT_SECRET_KEY")?)?;
    let data_dir = PathBuf::from(
        std::env::var("BUZZ_AGENT_DATA_DIR").unwrap_or_else(|_| "/data/agents".into()),
    );
    let runtime_path = std::env::var("BUZZ_AGENT_RUNTIME_PATH")
        .unwrap_or_else(|_| "/usr/local/bin:/usr/bin:/bin".into());
    let max_agents = std::env::var("BUZZ_AGENT_HOST_MAX_AGENTS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(8)
        .clamp(1, 64);
    tokio::fs::create_dir_all(&data_dir).await?;

    let db = Db::new(&DbConfig {
        database_url,
        max_connections: 5,
        min_connections: 1,
        ..DbConfig::default()
    })
    .await?;
    let control_bind = std::env::var("BUZZ_AGENT_HOST_CONTROL_BIND")
        .unwrap_or_else(|_| "0.0.0.0:8090".into())
        .parse()?;
    let control_db = db.clone();
    let control_dir = data_dir.clone();
    let control_path = runtime_path.clone();
    let control_token = buzz_agent_host::derive_control_token(&envelope_key);
    let runtime_logs = auth_control::RuntimeLogStore::default();
    let control_logs = runtime_logs.clone();
    tokio::spawn(async move {
        if let Err(error) = auth_control::serve(
            control_bind,
            control_db,
            control_token,
            control_dir,
            control_path,
            control_logs,
        )
        .await
        {
            error!(%error, "agent authentication control port stopped");
        }
    });
    let runner_id = Uuid::new_v4();
    let mut tasks = JoinSet::new();
    info!(%runner_id, max_agents, "agent host ready");

    loop {
        while tasks.len() < max_agents {
            let Some(lease) = db
                .claim_managed_agent_host(runner_id, LEASE_SECONDS)
                .await?
            else {
                break;
            };
            let task_db = db.clone();
            let task_relay = relay_url.clone();
            let task_dir = data_dir.clone();
            let task_path = runtime_path.clone();
            let task_logs = runtime_logs.clone();
            tasks.spawn(async move {
                run_agent(
                    task_db,
                    runner_id,
                    lease,
                    envelope_key,
                    task_relay,
                    task_dir,
                    task_path,
                    task_logs,
                )
                .await;
            });
        }

        tokio::select! {
            result = tasks.join_next(), if !tasks.is_empty() => {
                if let Some(Err(join_error)) = result {
                    error!(error = %join_error, "agent supervisor task panicked");
                }
            }
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
            _ = tokio::signal::ctrl_c() => {
                info!("agent host shutting down");
                tasks.abort_all();
                while tasks.join_next().await.is_some() {}
                return Ok(());
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_agent(
    db: Db,
    runner_id: Uuid,
    lease: ManagedAgentLease,
    envelope_key: [u8; 32],
    relay_url: String,
    data_dir: PathBuf,
    runtime_path: String,
    runtime_logs: auth_control::RuntimeLogStore,
) {
    let record = lease.record;
    let community = CommunityId::from_uuid(record.community_id);
    let runtime = match runtime_command(&record.runtime) {
        Some(runtime) => runtime,
        None => {
            release_error(&db, community, &record, runner_id, "unsupported runtime").await;
            return;
        }
    };
    let secret = match decrypt_secret(
        &envelope_key,
        record.community_id,
        record.id,
        &lease.secret_nonce,
        &lease.secret_ciphertext,
    ) {
        Ok(secret) => secret,
        Err(error) => {
            warn!(agent_id = %record.id, "agent secret could not be decrypted");
            release_error(&db, community, &record, runner_id, &error.to_string()).await;
            return;
        }
    };

    let sandbox_uid = match u32::try_from(record.sandbox_uid) {
        Ok(uid) => uid,
        Err(error) => {
            release_error(&db, community, &record, runner_id, &error.to_string()).await;
            return;
        }
    };
    let workdir = data_dir.join(record.id.to_string());
    if let Err(error) = prepare_workdir(&workdir, sandbox_uid).await {
        release_error(&db, community, &record, runner_id, &error.to_string()).await;
        return;
    }

    let mut command = Command::new("buzz-acp");
    command
        .env_clear()
        .env("PATH", &runtime_path)
        .env("HOME", &workdir)
        .env("BUZZ_PRIVATE_KEY", &secret.private_key_nsec)
        .env("BUZZ_RELAY_URL", &relay_url)
        .env("BUZZ_ACP_AGENT_COMMAND", runtime.command)
        .env("BUZZ_ACP_AGENT_ARGS", runtime.args.join(","))
        .env("BUZZ_ACP_AGENT_OWNER", &record.owner_pubkey)
        .env("BUZZ_ACP_SYSTEM_PROMPT", &record.system_prompt)
        .env("BUZZ_ACP_RESPOND_TO", &record.respond_to)
        .env(
            "BUZZ_ACP_RESPOND_TO_ALLOWLIST",
            record.respond_to_allowlist.join(","),
        )
        .env("BUZZ_ACP_RELAY_OBSERVER", "true")
        .current_dir(&workdir)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if let Some(model) = &record.model {
        command.env("BUZZ_ACP_MODEL", model);
    }
    for (name, value) in &secret.env {
        if buzz_agent_host::allowed_secret_env_name(name) {
            command.env(name, value);
        }
    }
    #[cfg(unix)]
    {
        command.process_group(0);
        command.uid(sandbox_uid).gid(sandbox_uid);
    }

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            release_error(
                &db,
                community,
                &record,
                runner_id,
                &format!("spawn failed: {error}"),
            )
            .await;
            return;
        }
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    runtime_logs.reset(record.community_id, record.id).await;
    let mut redactions = Zeroizing::new(Vec::with_capacity(secret.env.len() + 1));
    redactions.push(secret.private_key_nsec.clone());
    redactions.extend(
        secret
            .env
            .values()
            .filter(|value| !value.is_empty())
            .cloned(),
    );
    redactions.sort_by_key(|value| std::cmp::Reverse(value.len()));
    let redactions = Arc::new(redactions);
    let mut stdout_task = stdout.map(|reader| {
        tokio::spawn(pump_runtime_output(
            reader,
            runtime_logs.clone(),
            record.community_id,
            record.id,
            "stdout",
            Arc::clone(&redactions),
        ))
    });
    let mut stderr_task = stderr.map(|reader| {
        tokio::spawn(pump_runtime_output(
            reader,
            runtime_logs.clone(),
            record.community_id,
            record.id,
            "stderr",
            redactions,
        ))
    });
    let pid = child.id().map(i64::from);
    info!(agent_id = %record.id, agent = %record.agent_pubkey, ?pid, "agent started");

    let mut ticker = tokio::time::interval(RENEW_INTERVAL);
    loop {
        tokio::select! {
            status = child.wait() => {
                let message = match status {
                    Ok(status) => format!("agent exited with {status}"),
                    Err(error) => format!("agent wait failed: {error}"),
                };
                release_error(&db, community, &record, runner_id, &message).await;
                if let Some(task) = stdout_task.take() { let _ = task.await; }
                if let Some(task) = stderr_task.take() { let _ = task.await; }
                break;
            }
            _ = ticker.tick() => {
                let renewed = db.renew_managed_agent_lease(
                    community,
                    record.id,
                    runner_id,
                    record.lease_epoch,
                    LEASE_SECONDS,
                    "running",
                    pid,
                ).await.unwrap_or(false);
                if !renewed {
                    warn!(agent_id = %record.id, "agent lease lost or stop requested");
                    terminate_child(&mut child).await;
                    let _ = db.release_managed_agent_lease(
                        community,
                        record.id,
                        runner_id,
                        record.lease_epoch,
                        "stopped",
                        None,
                    ).await;
                    if let Some(task) = stdout_task.take() { let _ = task.await; }
                    if let Some(task) = stderr_task.take() { let _ = task.await; }
                    break;
                }
            }
        }
    }
}

async fn pump_runtime_output<R: tokio::io::AsyncRead + Unpin>(
    mut reader: R,
    logs: auth_control::RuntimeLogStore,
    community: Uuid,
    id: Uuid,
    stream: &'static str,
    redactions: Arc<Zeroizing<Vec<String>>>,
) {
    use tokio::io::AsyncReadExt as _;

    let mut chunk = [0u8; 2048];
    let mut line = Vec::new();
    let mut overflow = false;
    loop {
        let count = match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        for byte in &chunk[..count] {
            if *byte == b'\n' {
                flush_runtime_line(
                    &logs,
                    community,
                    id,
                    stream,
                    &mut line,
                    overflow,
                    redactions.as_slice(),
                )
                .await;
                overflow = false;
            } else if !overflow {
                if line.len() < MAX_RUNTIME_LOG_LINE_BYTES {
                    line.push(*byte);
                } else {
                    line.clear();
                    overflow = true;
                }
            }
        }
    }
    if overflow || !line.is_empty() {
        flush_runtime_line(
            &logs,
            community,
            id,
            stream,
            &mut line,
            overflow,
            redactions.as_slice(),
        )
        .await;
    }
}

#[allow(clippy::too_many_arguments)]
async fn flush_runtime_line(
    logs: &auth_control::RuntimeLogStore,
    community: Uuid,
    id: Uuid,
    stream: &str,
    line: &mut Vec<u8>,
    overflow: bool,
    redactions: &[String],
) {
    let value = if overflow {
        "[line omitted: exceeds 8192 bytes]".to_owned()
    } else {
        auth_control::sanitize_terminal(&String::from_utf8_lossy(line))
    };
    line.clear();
    let value = redact_runtime_line(value, redactions);
    logs.append(community, id, stream, &value).await;
}

fn redact_runtime_line(mut value: String, redactions: &[String]) -> String {
    for secret in redactions {
        if !secret.is_empty() {
            value = value.replace(secret, "[REDACTED]");
        }
    }
    value
}

#[cfg(test)]
mod runtime_log_tests {
    use super::*;

    #[test]
    fn runtime_log_redaction_replaces_every_known_secret() {
        let value = redact_runtime_line(
            "key=sk-secret identity=nsec-secret safe".into(),
            &["sk-secret".into(), "nsec-secret".into()],
        );
        assert_eq!(value, "key=[REDACTED] identity=[REDACTED] safe");
    }

    #[test]
    fn runtime_log_redaction_ignores_empty_values() {
        assert_eq!(redact_runtime_line("safe".into(), &[String::new()]), "safe");
    }
}

#[cfg(unix)]
async fn prepare_workdir(path: &std::path::Path, sandbox_uid: u32) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt as _;

    tokio::fs::create_dir_all(path).await?;
    let ownership = format!("{sandbox_uid}:{sandbox_uid}");
    let status = Command::new("/usr/bin/chown")
        .env_clear()
        .arg("-R")
        .arg("--no-dereference")
        .arg(ownership)
        .arg(path)
        .status()
        .await?;
    if !status.success() {
        anyhow::bail!("could not isolate agent data directory");
    }
    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).await?;
    Ok(())
}

#[cfg(not(unix))]
async fn prepare_workdir(_path: &std::path::Path, _sandbox_uid: u32) -> anyhow::Result<()> {
    anyhow::bail!("the centralized agent host requires a Unix runtime")
}

async fn release_error(
    db: &Db,
    community: CommunityId,
    record: &buzz_db::managed_agent_host::ManagedAgentHostRecord,
    runner_id: Uuid,
    message: &str,
) {
    let redacted: String = message.chars().take(500).collect();
    let _ = db
        .release_managed_agent_lease(
            community,
            record.id,
            runner_id,
            record.lease_epoch,
            "error",
            Some(&redacted),
        )
        .await;
}

async fn terminate_child(child: &mut tokio::process::Child) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        let _ = nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(-(pid as i32)),
            nix::sys::signal::Signal::SIGTERM,
        );
        if tokio::time::timeout(Duration::from_secs(5), child.wait())
            .await
            .is_ok()
        {
            return;
        }
    }
    let _ = child.kill().await;
}
