#![deny(unsafe_code)]
//! Shared types and secret envelope used by the Buzz agent control plane.

use std::{collections::BTreeMap, sync::OnceLock};

use chacha20poly1305::{
    aead::{Aead, Payload},
    ChaCha20Poly1305, KeyInit, Nonce,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

/// Secret material made available only to one agent process.
#[derive(Debug, Serialize, Deserialize)]
pub struct AgentSecretPayload {
    /// Agent Nostr identity.
    pub private_key_nsec: String,
    /// Provider credentials and other runtime-specific secrets.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

impl Zeroize for AgentSecretPayload {
    fn zeroize(&mut self) {
        self.private_key_nsec.zeroize();
        for (mut name, mut value) in std::mem::take(&mut self.env) {
            name.zeroize();
            value.zeroize();
        }
    }
}

/// Encrypted secret columns persisted by the control plane.
pub struct EncryptedAgentSecret {
    /// Random ChaCha20-Poly1305 nonce.
    pub nonce: [u8; 12],
    /// Authenticated ciphertext.
    pub ciphertext: Vec<u8>,
}

/// Parse the deployment envelope key from exactly 64 hexadecimal characters.
pub fn parse_envelope_key(value: &str) -> anyhow::Result<[u8; 32]> {
    let bytes = hex::decode(value.trim())?;
    bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("BUZZ_AGENT_SECRET_KEY must be exactly 32 bytes of hex"))
}

/// Derive a domain-separated bearer token for the private host control port.
pub fn derive_control_token(key: &[u8; 32]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"buzz-agent-host-control:v1\0");
    hasher.update(key);
    hex::encode(hasher.finalize())
}

/// Domain-separated token passed to the unprivileged shared-compute child.
/// Compromise of that child does not reveal the agent secret-envelope key.
pub fn derive_mesh_control_token(key: &[u8; 32]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"buzz-mesh-host-control:v1\0");
    hasher.update(key);
    hex::encode(hasher.finalize())
}

/// Fixed vendor CLI command used for subscription authentication.
pub fn subscription_auth_command(runtime: &str) -> Option<(&'static str, &'static [&'static str])> {
    match runtime {
        "codex" => Some(("codex", &["login", "--device-auth"])),
        "claude" => Some(("claude", &["auth", "login", "--claudeai"])),
        _ => None,
    }
}

fn aad(community_id: Uuid, agent_id: Uuid) -> String {
    format!("buzz-agent-secret:v1:{community_id}:{agent_id}")
}

/// Encrypt an agent secret, binding it to the tenant and immutable record id.
pub fn encrypt_secret(
    key: &[u8; 32],
    community_id: Uuid,
    agent_id: Uuid,
    secret: AgentSecretPayload,
) -> anyhow::Result<EncryptedAgentSecret> {
    let secret = Zeroizing::new(secret);
    let plaintext = Zeroizing::new(serde_json::to_vec(&*secret)?);
    let nonce: [u8; 12] = rand::random();
    let cipher = ChaCha20Poly1305::new(key.into());
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext.as_slice(),
                aad: aad(community_id, agent_id).as_bytes(),
            },
        )
        .map_err(|_| anyhow::anyhow!("agent secret encryption failed"))?;
    Ok(EncryptedAgentSecret { nonce, ciphertext })
}

/// Decrypt an agent secret after a runner has acquired its fenced lease.
pub fn decrypt_secret(
    key: &[u8; 32],
    community_id: Uuid,
    agent_id: Uuid,
    nonce: &[u8],
    ciphertext: &[u8],
) -> anyhow::Result<Zeroizing<AgentSecretPayload>> {
    if nonce.len() != 12 {
        anyhow::bail!("invalid agent secret nonce");
    }
    let cipher = ChaCha20Poly1305::new(key.into());
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: ciphertext,
                    aad: aad(community_id, agent_id).as_bytes(),
                },
            )
            .map_err(|_| anyhow::anyhow!("agent secret decryption failed"))?,
    );
    let decoded = serde_json::from_slice(plaintext.as_slice())?;
    Ok(Zeroizing::new(decoded))
}

const CUSTOM_RUNTIME_CATALOG_ENV: &str = "BUZZ_AGENT_RUNTIME_CATALOG_JSON";
const MAX_CUSTOM_RUNTIMES: usize = 32;

/// One write-only credential field declared by the deployment operator.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RuntimeSecretField {
    /// Environment variable passed to the installed harness.
    pub env: String,
    /// Human-readable prompt shown in owner-only configuration UI.
    pub label: String,
    /// Whether a new agent must provide this credential.
    #[serde(default = "default_true")]
    pub required: bool,
}

/// Safe runtime metadata returned to an authenticated owner.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct PublicRuntimeCatalogEntry {
    pub id: String,
    pub label: String,
    pub source: &'static str,
    pub supports_model: bool,
    pub model_required: bool,
    pub supports_subscription: bool,
    pub supports_arguments: bool,
    pub secret_fields: Vec<RuntimeSecretField>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct OperatorRuntimeDefinition {
    id: String,
    label: String,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    allow_owner_args: bool,
    #[serde(default)]
    model_env: Option<String>,
    #[serde(default)]
    model_required: bool,
    #[serde(default)]
    secret_fields: Vec<RuntimeSecretField>,
}

const fn default_true() -> bool {
    true
}

/// Runtime command selected from the server-side catalog.
pub struct RuntimeCommand {
    /// ACP adapter executable.
    pub command: String,
    /// ACP adapter arguments.
    pub args: Vec<String>,
    /// Optional harness-specific model environment variable.
    pub model_env: Option<String>,
    /// Write-only environment names accepted for this runtime.
    pub secret_fields: Vec<RuntimeSecretField>,
    /// Whether this runtime was supplied by the deployment operator.
    pub custom: bool,
    /// Whether an owner may append bounded arguments to the fixed command.
    pub allow_owner_args: bool,
}

/// Resolve a remotely configurable runtime without accepting an executable path.
pub fn runtime_command(runtime: &str) -> Option<RuntimeCommand> {
    match runtime {
        "buzz-agent" => Some(RuntimeCommand {
            command: "buzz-agent".into(),
            args: vec![],
            model_env: Some("BUZZ_AGENT_MODEL".into()),
            secret_fields: vec![],
            custom: false,
            allow_owner_args: true,
        }),
        "codex" => Some(RuntimeCommand {
            command: "codex-acp".into(),
            args: vec![],
            model_env: None,
            secret_fields: vec![],
            custom: false,
            allow_owner_args: true,
        }),
        "claude" => Some(RuntimeCommand {
            command: "claude-agent-acp".into(),
            args: vec![],
            model_env: None,
            secret_fields: vec![],
            custom: false,
            allow_owner_args: true,
        }),
        _ => operator_runtime_definitions()
            .ok()?
            .iter()
            .find(|entry| entry.id == runtime)
            .map(|entry| RuntimeCommand {
                command: entry.command.clone(),
                args: entry.args.clone(),
                model_env: entry.model_env.clone(),
                secret_fields: entry.secret_fields.clone(),
                custom: true,
                allow_owner_args: entry.allow_owner_args,
            }),
    }
}

/// Return browser-safe metadata. Commands and fixed arguments never cross the
/// host/browser trust boundary.
pub fn public_runtime_catalog() -> anyhow::Result<Vec<PublicRuntimeCatalogEntry>> {
    let mut entries = vec![
        PublicRuntimeCatalogEntry {
            id: "buzz-agent".into(),
            label: "Buzz Agent".into(),
            source: "built-in",
            supports_model: true,
            model_required: true,
            supports_subscription: false,
            supports_arguments: true,
            secret_fields: vec![],
        },
        PublicRuntimeCatalogEntry {
            id: "codex".into(),
            label: "Codex".into(),
            source: "built-in",
            supports_model: true,
            model_required: false,
            supports_subscription: true,
            supports_arguments: true,
            secret_fields: vec![],
        },
        PublicRuntimeCatalogEntry {
            id: "claude".into(),
            label: "Claude Code".into(),
            source: "built-in",
            supports_model: true,
            model_required: false,
            supports_subscription: true,
            supports_arguments: true,
            secret_fields: vec![],
        },
    ];
    entries.extend(
        operator_runtime_definitions()?
            .iter()
            .map(|entry| PublicRuntimeCatalogEntry {
                id: entry.id.clone(),
                label: entry.label.clone(),
                source: "operator",
                supports_model: entry.model_env.is_some(),
                model_required: entry.model_required,
                supports_subscription: false,
                supports_arguments: entry.allow_owner_args,
                secret_fields: entry.secret_fields.clone(),
            }),
    );
    Ok(entries)
}

/// Whether this runtime may receive a named write-only credential.
pub fn runtime_allows_secret_env(runtime: &str, name: &str) -> bool {
    if !runtime_command(runtime).is_some_and(|definition| definition.custom) {
        return allowed_secret_env_name(name);
    }
    runtime_command(runtime).is_some_and(|definition| {
        definition
            .secret_fields
            .iter()
            .any(|field| field.env == name)
    })
}

/// Whether the operator catalog requires a model for this runtime.
pub fn runtime_model_required(runtime: &str) -> bool {
    operator_runtime_definitions()
        .ok()
        .and_then(|entries| entries.iter().find(|entry| entry.id == runtime))
        .is_some_and(|entry| entry.model_required)
}

static OPERATOR_RUNTIME_DEFINITIONS: OnceLock<Result<Vec<OperatorRuntimeDefinition>, String>> =
    OnceLock::new();

fn operator_runtime_definitions() -> anyhow::Result<&'static [OperatorRuntimeDefinition]> {
    match OPERATOR_RUNTIME_DEFINITIONS.get_or_init(|| {
        let raw = std::env::var(CUSTOM_RUNTIME_CATALOG_ENV).unwrap_or_default();
        parse_operator_runtime_catalog(&raw).map_err(|error| error.to_string())
    }) {
        Ok(entries) => Ok(entries),
        Err(error) => anyhow::bail!("invalid {CUSTOM_RUNTIME_CATALOG_ENV}: {error}"),
    }
}

fn parse_operator_runtime_catalog(raw: &str) -> anyhow::Result<Vec<OperatorRuntimeDefinition>> {
    if raw.trim().is_empty() {
        return Ok(vec![]);
    }
    let entries: Vec<OperatorRuntimeDefinition> = serde_json::from_str(raw)?;
    if entries.len() > MAX_CUSTOM_RUNTIMES {
        anyhow::bail!("too many custom runtimes");
    }
    let mut ids = std::collections::BTreeSet::new();
    for entry in &entries {
        if !valid_runtime_id(&entry.id)
            || matches!(entry.id.as_str(), "buzz-agent" | "codex" | "claude")
            || !ids.insert(entry.id.as_str())
            || entry.label.trim().is_empty()
            || entry.label.len() > 80
            || !valid_command_name(&entry.command)
            || entry.args.len() > 32
            || entry
                .args
                .iter()
                .any(|arg| arg.is_empty() || arg.len() > 1024 || arg.contains(['\0', ',']))
            || entry.secret_fields.len() > 16
            || entry.model_required && entry.model_env.is_none()
        {
            anyhow::bail!("invalid custom runtime definition");
        }
        if entry
            .model_env
            .as_deref()
            .is_some_and(|name| !valid_custom_model_env(name))
        {
            anyhow::bail!("invalid custom runtime model environment");
        }
        let mut secret_names = std::collections::BTreeSet::new();
        for field in &entry.secret_fields {
            if !valid_custom_secret_env(&field.env)
                || !secret_names.insert(field.env.as_str())
                || field.label.trim().is_empty()
                || field.label.len() > 80
                || entry.model_env.as_deref() == Some(field.env.as_str())
            {
                anyhow::bail!("invalid custom runtime credential field");
            }
        }
    }
    Ok(entries)
}

fn valid_runtime_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || (index > 0 && matches!(byte, b'-' | b'_'))
        })
}

fn valid_command_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'-' | b'_' | b'.' | b'+'))
        })
}

fn safe_custom_env_base(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_uppercase() || (index > 0 && byte.is_ascii_digit()) || byte == b'_'
        })
        && ![
            "BUZZ_",
            "DATABASE",
            "POSTGRES",
            "REDIS",
            "AWS_",
            "DOCKER_",
            "CONTAINER_",
            "KUBERNETES_",
            "LD_",
            "DYLD_",
            "NODE_",
            "PYTHON",
            "RUST",
            "CARGO_",
            "GIT_",
            "SSH_",
            "SSL_",
            "HTTP_",
            "HTTPS_",
            "ALL_PROXY",
            "NO_PROXY",
        ]
        .iter()
        .any(|prefix| value.starts_with(prefix))
        && !matches!(
            value,
            "PATH" | "HOME" | "SHELL" | "USER" | "TMPDIR" | "TERM"
        )
}

fn valid_custom_secret_env(value: &str) -> bool {
    safe_custom_env_base(value)
        && ["_API_KEY", "_TOKEN", "_SECRET", "_PASSWORD"]
            .iter()
            .any(|suffix| value.ends_with(suffix))
}

fn valid_custom_model_env(value: &str) -> bool {
    safe_custom_env_base(value) && value.ends_with("_MODEL")
}

/// Map one validated, non-secret runtime setting to its fixed environment key.
/// The relay and host both consume this catalog so an accepted setting can
/// never drift into a different spawn-time capability.
pub fn runtime_config_env_name(
    runtime: &str,
    provider: Option<&str>,
    key: &str,
) -> Option<&'static str> {
    if runtime != "buzz-agent" {
        return None;
    }
    match key {
        "thinking_effort" => Some("BUZZ_AGENT_THINKING_EFFORT"),
        "max_rounds" => Some("BUZZ_AGENT_MAX_ROUNDS"),
        "max_output_tokens" => Some("BUZZ_AGENT_MAX_OUTPUT_TOKENS"),
        "max_context_tokens" => Some("BUZZ_AGENT_MAX_CONTEXT_TOKENS"),
        "api_mode" if provider == Some("openai") => Some("OPENAI_COMPAT_API"),
        "api_version" if provider == Some("anthropic") => Some("ANTHROPIC_API_VERSION"),
        "databricks_host" if matches!(provider, Some("databricks" | "databricks_v2")) => {
            Some("DATABRICKS_HOST")
        }
        "base_url" => match provider {
            Some("anthropic") => Some("ANTHROPIC_BASE_URL"),
            Some("openai") => Some("OPENAI_COMPAT_BASE_URL"),
            Some("openrouter") => Some("OPENROUTER_BASE_URL"),
            _ => None,
        },
        _ => None,
    }
}

/// Accept only provider configuration needed by the packaged harnesses.
pub fn allowed_secret_env_name(name: &str) -> bool {
    matches!(
        name,
        "ANTHROPIC_API_KEY"
            | "ANTHROPIC_MODEL"
            | "ANTHROPIC_BASE_URL"
            | "ANTHROPIC_API_VERSION"
            | "CLAUDE_CODE_OAUTH_TOKEN"
            | "OPENAI_API_KEY"
            | "OPENAI_COMPAT_API_KEY"
            | "OPENAI_COMPAT_MODEL"
            | "OPENAI_COMPAT_BASE_URL"
            | "OPENAI_COMPAT_API"
            | "OPENROUTER_API_KEY"
            | "OPENROUTER_MODEL"
            | "OPENROUTER_BASE_URL"
            | "DATABRICKS_HOST"
            | "DATABRICKS_MODEL"
            | "DATABRICKS_TOKEN"
    )
}

/// Read-only compatibility for envelopes created before provider became a
/// normalized database field. The relay never accepts this name on new writes.
pub fn legacy_secret_env_name(name: &str) -> bool {
    name == "BUZZ_AGENT_PROVIDER"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_round_trip_is_bound_to_record() {
        let key = [7u8; 32];
        let community = Uuid::new_v4();
        let agent = Uuid::new_v4();
        let secret = AgentSecretPayload {
            private_key_nsec: "nsec-test".into(),
            env: BTreeMap::from([("OPENAI_API_KEY".into(), "secret".into())]),
        };
        let encrypted = encrypt_secret(&key, community, agent, secret).unwrap();
        let decrypted = decrypt_secret(
            &key,
            community,
            agent,
            &encrypted.nonce,
            &encrypted.ciphertext,
        )
        .unwrap();
        assert_eq!(decrypted.private_key_nsec, "nsec-test");
        assert!(decrypt_secret(
            &key,
            community,
            Uuid::new_v4(),
            &encrypted.nonce,
            &encrypted.ciphertext
        )
        .is_err());
    }

    #[test]
    fn reserved_environment_is_rejected() {
        assert!(allowed_secret_env_name("OPENAI_API_KEY"));
        assert!(!allowed_secret_env_name("BUZZ_AGENT_PROVIDER"));
        assert!(legacy_secret_env_name("BUZZ_AGENT_PROVIDER"));
        assert!(!allowed_secret_env_name("DATABASE_URL"));
        assert!(!allowed_secret_env_name("BUZZ_ACP_SYSTEM_PROMPT"));
        assert!(!allowed_secret_env_name("NODE_OPTIONS"));
        assert!(!allowed_secret_env_name("LD_PRELOAD"));
        assert!(!allowed_secret_env_name("lowercase"));
    }

    #[test]
    fn normalized_runtime_config_has_a_fixed_catalog() {
        assert_eq!(
            runtime_config_env_name("buzz-agent", Some("anthropic"), "thinking_effort"),
            Some("BUZZ_AGENT_THINKING_EFFORT")
        );
        assert_eq!(
            runtime_config_env_name("buzz-agent", Some("openai"), "base_url"),
            Some("OPENAI_COMPAT_BASE_URL")
        );
        assert_eq!(
            runtime_config_env_name("buzz-agent", Some("databricks_v2"), "databricks_host"),
            Some("DATABRICKS_HOST")
        );
        assert_eq!(
            runtime_config_env_name("codex", None, "thinking_effort"),
            None
        );
        assert_eq!(
            runtime_config_env_name("buzz-agent", Some("anthropic"), "LD_PRELOAD"),
            None
        );
    }

    #[test]
    fn operator_runtime_catalog_is_strict_and_hides_spawn_details() {
        let parsed = parse_operator_runtime_catalog(
            r#"[{
                "id":"gemini",
                "label":"Gemini",
                "command":"gemini-acp",
                "args":["serve"],
                "model_env":"GEMINI_MODEL",
                "model_required":true,
                "secret_fields":[{"env":"GEMINI_API_KEY","label":"Gemini API key"}]
            }]"#,
        )
        .unwrap();
        assert_eq!(parsed[0].command, "gemini-acp");
        assert_eq!(parsed[0].secret_fields[0].required, true);
        assert!(!parsed[0].allow_owner_args);

        let public = PublicRuntimeCatalogEntry {
            id: parsed[0].id.clone(),
            label: parsed[0].label.clone(),
            source: "operator",
            supports_model: true,
            model_required: true,
            supports_subscription: false,
            supports_arguments: parsed[0].allow_owner_args,
            secret_fields: parsed[0].secret_fields.clone(),
        };
        let encoded = serde_json::to_string(&public).unwrap();
        assert!(!public.supports_arguments);
        assert!(!encoded.contains("gemini-acp"));
        assert!(!encoded.contains("serve"));
    }

    #[test]
    fn operator_runtime_catalog_rejects_spawn_and_environment_injection() {
        for definition in [
            r#"[{"id":"evil","label":"Evil","command":"/bin/sh"}]"#,
            r#"[{"id":"evil","label":"Evil","command":"agent","args":["--flag,second"]}]"#,
            r#"[{"id":"evil","label":"Evil","command":"agent","secret_fields":[{"env":"LD_PRELOAD","label":"Loader"}]}]"#,
            r#"[{"id":"evil","label":"Evil","command":"agent","secret_fields":[{"env":"BUZZ_AGENT_API_KEY","label":"Internal"}]}]"#,
            r#"[{"id":"evil","label":"Evil","command":"agent","model_env":"NODE_MODEL"}]"#,
            r#"[{"id":"codex","label":"Override","command":"other"}]"#,
        ] {
            assert!(
                parse_operator_runtime_catalog(definition).is_err(),
                "accepted {definition}"
            );
        }
    }
}
