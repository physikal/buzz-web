//! One-shot stable secret generation for the container deployment.

use std::{fs, io::Write, path::Path};

use anyhow::Context;
use nostr::{Keys, ToBech32};

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

    let owner_secret_path = Path::new(&owner_dir).join("owner_nsec");
    let (owner_keys, owner_created) = if owner_secret_path.exists() {
        let secret = fs::read_to_string(&owner_secret_path)
            .with_context(|| format!("read {}", owner_secret_path.display()))?;
        (Keys::parse(secret.trim())?, false)
    } else {
        let keys = Keys::generate();
        write_new_secret(&owner_secret_path, &keys.secret_key().to_bech32()?)?;
        (keys, true)
    };
    let owner_public_path = Path::new(&service_dir).join("owner_pubkey");
    write_replace_secret(&owner_public_path, &owner_keys.public_key().to_hex())?;

    if owner_created {
        println!("BUZZ_OWNER_NSEC={}", owner_keys.secret_key().to_bech32()?);
        println!("Import this key into a NIP-07 signer, then protect the bootstrap logs.");
    } else {
        println!("Buzz secrets already exist; no keys were rotated.");
    }
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
