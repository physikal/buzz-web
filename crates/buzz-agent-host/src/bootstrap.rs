//! One-shot stable secret generation for the container deployment.

use std::{
    fs,
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::Context;
use nostr::Keys;
use sha2::{Digest, Sha256};

fn main() -> anyhow::Result<()> {
    let service_dir = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "/run/buzz-secrets".into());
    let owner_dir = std::env::args()
        .nth(2)
        .unwrap_or_else(|| "/run/buzz-owner".into());
    create_private_dir(Path::new(&service_dir))?;
    create_private_dir(Path::new(&owner_dir))?;

    for name in [
        "postgres_password",
        "redis_password",
        "s3_access_key",
        "s3_secret_key",
        "relay_private_key",
        "git_hook_hmac_secret",
        "agent_envelope_key",
    ] {
        ensure_random_hex(Path::new(&service_dir).join(name))?;
    }

    // Preserve existing deployments that already use the desktop/NIP-07 owner
    // key. Fresh web deployments claim ownership in the browser instead, so
    // the server never creates or handles their Nostr secret.
    let owner_secret_path = Path::new(&owner_dir).join("owner_nsec");
    if owner_secret_path.exists() {
        let secret = fs::read_to_string(&owner_secret_path)
            .with_context(|| format!("read {}", owner_secret_path.display()))?;
        let owner_keys = Keys::parse(secret.trim())?;
        write_replace_secret(
            &Path::new(&service_dir).join("owner_pubkey"),
            &owner_keys.public_key().to_hex(),
        )?;
    }

    let claim_token_path = Path::new(&owner_dir).join("owner_claim_token");
    let claim_issued_path = Path::new(&owner_dir).join("owner_claim_issued_at");
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    let previous_issued_at = fs::read_to_string(&claim_issued_path)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok());
    let claim_issued_at = if claim_token_path.exists()
        && previous_issued_at.is_some_and(|issued| now < issued.saturating_add(86_400))
    {
        previous_issued_at.expect("checked as some")
    } else {
        write_replace_secret(&claim_token_path, &hex::encode(rand::random::<[u8; 32]>()))?;
        write_replace_secret(&claim_issued_path, &now.to_string())?;
        now
    };
    let claim_token = fs::read_to_string(&claim_token_path)
        .with_context(|| format!("read {}", claim_token_path.display()))?;
    let claim_token = claim_token.trim();
    let claim_hash = hex::encode(Sha256::digest(claim_token.as_bytes()));
    write_replace_secret(
        &Path::new(&service_dir).join("owner_claim_token_hash"),
        &claim_hash,
    )?;
    write_replace_secret(
        &Path::new(&service_dir).join("owner_claim_expires_at"),
        &claim_issued_at.saturating_add(86_400).to_string(),
    )?;

    let domain = std::env::var("BUZZ_DOMAIN").unwrap_or_else(|_| "<BUZZ_DOMAIN>".into());
    println!("BUZZ_OWNER_SETUP_URL=https://{domain}/agents/setup#{claim_token}");
    println!(
        "Open this one-time URL to create the owner passkey, then protect the bootstrap logs."
    );
    Ok(())
}

fn create_private_dir(path: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(path).with_context(|| format!("create {}", path.display()))?;
    set_private_permissions(path, true)
}

fn ensure_random_hex(path: impl AsRef<Path>) -> anyhow::Result<()> {
    let path = path.as_ref();
    if path.exists() {
        return Ok(());
    }
    write_new_secret(path, &hex::encode(rand::random::<[u8; 32]>()))
}

fn write_new_secret(path: &Path, value: &str) -> anyhow::Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .with_context(|| format!("create {}", path.display()))?;
    file.write_all(value.as_bytes())?;
    file.write_all(b"\n")?;
    set_private_permissions(path, false)
}

fn write_replace_secret(path: &Path, value: &str) -> anyhow::Result<()> {
    let temp = path.with_extension("tmp");
    if temp.exists() {
        fs::remove_file(&temp)?;
    }
    write_new_secret(&temp, value)?;
    fs::rename(&temp, path).with_context(|| format!("replace {}", path.display()))?;
    Ok(())
}

#[cfg(unix)]
fn set_private_permissions(path: &Path, directory: bool) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mode = if directory { 0o700 } else { 0o600 };
    fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_private_permissions(_path: &Path, _directory: bool) -> anyhow::Result<()> {
    Ok(())
}
