#![deny(unsafe_code)]
//! Shared types and secret envelope used by the Buzz agent control plane.

use std::collections::BTreeMap;

use chacha20poly1305::{
    aead::{Aead, Payload},
    ChaCha20Poly1305, KeyInit, Nonce,
};
use serde::{Deserialize, Serialize};
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

/// Runtime command selected from the fixed server-side catalog.
pub struct RuntimeCommand {
    /// ACP adapter executable.
    pub command: &'static str,
    /// ACP adapter arguments.
    pub args: &'static [&'static str],
}

/// Resolve a remotely configurable runtime without accepting an executable path.
pub fn runtime_command(runtime: &str) -> Option<RuntimeCommand> {
    match runtime {
        "buzz-agent" => Some(RuntimeCommand {
            command: "buzz-agent",
            args: &[],
        }),
        "codex" => Some(RuntimeCommand {
            command: "codex-acp",
            args: &[],
        }),
        "claude" => Some(RuntimeCommand {
            command: "claude-agent-acp",
            args: &[],
        }),
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
            | "BUZZ_AGENT_PROVIDER"
            | "BUZZ_AGENT_MODEL"
    )
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
        assert!(allowed_secret_env_name("BUZZ_AGENT_PROVIDER"));
        assert!(!allowed_secret_env_name("DATABASE_URL"));
        assert!(!allowed_secret_env_name("BUZZ_ACP_SYSTEM_PROMPT"));
        assert!(!allowed_secret_env_name("NODE_OPTIONS"));
        assert!(!allowed_secret_env_name("LD_PRELOAD"));
        assert!(!allowed_secret_env_name("lowercase"));
    }
}
