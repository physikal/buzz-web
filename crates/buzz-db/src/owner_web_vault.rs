//! Passkey-wrapped owner-key vault persistence.

use buzz_core::CommunityId;
use sqlx::{PgPool, Row};

use crate::Result;

/// Fixed-size encrypted wrapper fields accepted during owner setup.
pub struct NewOwnerWebWrapper<'a> {
    /// HKDF salt used after the passkey PRF or recovery secret.
    pub kdf_salt: &'a [u8],
    /// AES-256-GCM nonce.
    pub nonce: &'a [u8],
    /// AES-256-GCM ciphertext containing the 32-byte Nostr secret.
    pub ciphertext: &'a [u8],
}

/// Passkey credential and encrypted wrapper accepted during setup.
pub struct NewOwnerWebCredential<'a> {
    /// Raw WebAuthn credential identifier.
    pub credential_id: &'a [u8],
    /// User-visible device label.
    pub label: &'a str,
    /// Input evaluated by the WebAuthn PRF extension.
    pub prf_input: &'a [u8],
    /// Encrypted wrapper fields.
    pub wrapper: NewOwnerWebWrapper<'a>,
}

/// Outcome of an atomic deployment-owner claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimOwnerWebVaultResult {
    /// The vault was created and the caller is now the owner.
    Claimed,
    /// This community already has a browser owner vault.
    AlreadyClaimed,
    /// A legacy owner exists and does not match the signing key.
    OwnerMismatch,
}

/// Public claim state for one community.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerWebVaultStatus {
    /// Current relay owner, when one has been configured or claimed.
    pub owner_pubkey: Option<String>,
    /// Whether an encrypted browser vault exists.
    pub vault_ready: bool,
}

/// One passkey-wrapped Nostr owner key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerWebCredential {
    /// Relay owner public key bound into the wrapper additional data.
    pub owner_pubkey: String,
    /// Input evaluated by the WebAuthn PRF extension.
    pub prf_input: Vec<u8>,
    /// HKDF salt used to derive the AES wrapping key.
    pub kdf_salt: Vec<u8>,
    /// AES-256-GCM nonce.
    pub nonce: Vec<u8>,
    /// Authenticated ciphertext containing the Nostr secret.
    pub ciphertext: Vec<u8>,
}

/// Recovery-code-wrapped Nostr owner key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerWebRecovery {
    /// Relay owner public key bound into the wrapper additional data.
    pub owner_pubkey: String,
    /// HKDF salt used to derive the AES wrapping key.
    pub kdf_salt: Vec<u8>,
    /// AES-256-GCM nonce.
    pub nonce: Vec<u8>,
    /// Authenticated ciphertext containing the Nostr secret.
    pub ciphertext: Vec<u8>,
}

/// Return the current owner and browser-vault state.
pub async fn status(pool: &PgPool, community: CommunityId) -> Result<OwnerWebVaultStatus> {
    let row = sqlx::query(
        "SELECT (SELECT pubkey FROM relay_members \
                    WHERE community_id = $1 AND role = 'owner' \
                    ORDER BY created_at LIMIT 1) AS owner_pubkey, \
                EXISTS(SELECT 1 FROM owner_web_vaults WHERE community_id = $1) AS vault_ready",
    )
    .bind(community.as_uuid())
    .fetch_one(pool)
    .await?;
    Ok(OwnerWebVaultStatus {
        owner_pubkey: row.try_get("owner_pubkey")?,
        vault_ready: row.try_get("vault_ready")?,
    })
}

/// Claim an unowned community, or enroll a matching legacy owner, and create
/// its first encrypted browser credential in one transaction.
pub async fn claim(
    pool: &PgPool,
    community: CommunityId,
    owner_pubkey: &str,
    recovery: NewOwnerWebWrapper<'_>,
    credential: NewOwnerWebCredential<'_>,
) -> Result<ClaimOwnerWebVaultResult> {
    let owner_pubkey = owner_pubkey.to_ascii_lowercase();
    let mut tx = pool.begin().await?;

    // Lock the community row even when it has no owner yet. This serializes two
    // first-claim requests without relying on a row that does not exist.
    sqlx::query("SELECT id FROM communities WHERE id = $1 FOR UPDATE")
        .bind(community.as_uuid())
        .fetch_one(&mut *tx)
        .await?;

    let vault_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM owner_web_vaults WHERE community_id = $1)")
            .bind(community.as_uuid())
            .fetch_one(&mut *tx)
            .await?;
    if vault_exists {
        tx.rollback().await?;
        return Ok(ClaimOwnerWebVaultResult::AlreadyClaimed);
    }

    let owners: Vec<String> = sqlx::query_scalar(
        "SELECT pubkey FROM relay_members WHERE community_id = $1 AND role = 'owner' FOR UPDATE",
    )
    .bind(community.as_uuid())
    .fetch_all(&mut *tx)
    .await?;
    if !owners.is_empty() && (owners.len() != 1 || owners[0] != owner_pubkey) {
        tx.rollback().await?;
        return Ok(ClaimOwnerWebVaultResult::OwnerMismatch);
    }

    if owners.is_empty() {
        sqlx::query(
            "INSERT INTO relay_members (community_id, pubkey, role, added_by) \
             VALUES ($1, $2, 'owner', NULL)",
        )
        .bind(community.as_uuid())
        .bind(&owner_pubkey)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        "INSERT INTO owner_web_vaults \
         (community_id, owner_pubkey, recovery_kdf_salt, recovery_nonce, recovery_ciphertext) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(community.as_uuid())
    .bind(&owner_pubkey)
    .bind(recovery.kdf_salt)
    .bind(recovery.nonce)
    .bind(recovery.ciphertext)
    .execute(&mut *tx)
    .await?;

    insert_credential(&mut tx, community, credential).await?;
    tx.commit().await?;
    Ok(ClaimOwnerWebVaultResult::Claimed)
}

async fn insert_credential(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community: CommunityId,
    credential: NewOwnerWebCredential<'_>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO owner_web_credentials \
         (community_id, credential_id, label, prf_input, kdf_salt, wrap_nonce, wrapped_nsec) \
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(community.as_uuid())
    .bind(credential.credential_id)
    .bind(credential.label)
    .bind(credential.prf_input)
    .bind(credential.wrapper.kdf_salt)
    .bind(credential.wrapper.nonce)
    .bind(credential.wrapper.ciphertext)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Add a passkey wrapper after an owner has unlocked through recovery.
pub async fn add_credential(
    pool: &PgPool,
    community: CommunityId,
    owner_pubkey: &str,
    credential: NewOwnerWebCredential<'_>,
) -> Result<bool> {
    let mut tx = pool.begin().await?;
    let matches_owner: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM owner_web_vaults \
         WHERE community_id = $1 AND owner_pubkey = $2)",
    )
    .bind(community.as_uuid())
    .bind(owner_pubkey.to_ascii_lowercase())
    .fetch_one(&mut *tx)
    .await?;
    if !matches_owner {
        tx.rollback().await?;
        return Ok(false);
    }
    insert_credential(&mut tx, community, credential).await?;
    tx.commit().await?;
    Ok(true)
}

/// Load one passkey wrapper by its opaque credential identifier.
pub async fn credential(
    pool: &PgPool,
    community: CommunityId,
    credential_id: &[u8],
) -> Result<Option<OwnerWebCredential>> {
    let row = sqlx::query(
        "SELECT v.owner_pubkey, c.prf_input, c.kdf_salt, c.wrap_nonce, c.wrapped_nsec \
         FROM owner_web_credentials c \
         JOIN owner_web_vaults v ON v.community_id = c.community_id \
         WHERE c.community_id = $1 AND c.credential_id = $2",
    )
    .bind(community.as_uuid())
    .bind(credential_id)
    .fetch_optional(pool)
    .await?;
    row.map(|row| {
        Ok(OwnerWebCredential {
            owner_pubkey: row.try_get("owner_pubkey")?,
            prf_input: row.try_get("prf_input")?,
            kdf_salt: row.try_get("kdf_salt")?,
            nonce: row.try_get("wrap_nonce")?,
            ciphertext: row.try_get("wrapped_nsec")?,
        })
    })
    .transpose()
}

/// Load the recovery-code wrapper for the community owner.
pub async fn recovery(pool: &PgPool, community: CommunityId) -> Result<Option<OwnerWebRecovery>> {
    let row = sqlx::query(
        "SELECT owner_pubkey, recovery_kdf_salt, recovery_nonce, recovery_ciphertext \
         FROM owner_web_vaults WHERE community_id = $1",
    )
    .bind(community.as_uuid())
    .fetch_optional(pool)
    .await?;
    row.map(|row| {
        Ok(OwnerWebRecovery {
            owner_pubkey: row.try_get("owner_pubkey")?,
            kdf_salt: row.try_get("recovery_kdf_salt")?,
            nonce: row.try_get("recovery_nonce")?,
            ciphertext: row.try_get("recovery_ciphertext")?,
        })
    })
    .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    const TEST_DB_URL: &str = "postgres://buzz:buzz_dev@localhost:5432/buzz";

    async fn setup() -> (PgPool, CommunityId) {
        let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
            .or_else(|_| std::env::var("DATABASE_URL"))
            .unwrap_or_else(|_| TEST_DB_URL.to_owned());
        let pool = PgPool::connect(&database_url)
            .await
            .expect("connect to test DB");
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(id)
            .bind(format!("owner-vault-test-{}.example", id.simple()))
            .execute(&pool)
            .await
            .expect("insert test community");
        (pool, CommunityId::from_uuid(id))
    }

    fn new_credential<'a>(id: &'a [u8; 32]) -> NewOwnerWebCredential<'a> {
        NewOwnerWebCredential {
            credential_id: id,
            label: "Test passkey",
            prf_input: &[1; 32],
            wrapper: NewOwnerWebWrapper {
                kdf_salt: &[2; 32],
                nonce: &[3; 12],
                ciphertext: &[4; 48],
            },
        }
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn first_claim_is_atomic_and_cannot_be_replaced() {
        let (pool, community) = setup().await;
        let owner = "ab".repeat(32);
        let credential_id = [9; 32];
        let result = claim(
            &pool,
            community,
            &owner,
            NewOwnerWebWrapper {
                kdf_salt: &[5; 32],
                nonce: &[6; 12],
                ciphertext: &[7; 48],
            },
            new_credential(&credential_id),
        )
        .await
        .expect("claim owner vault");
        assert_eq!(result, ClaimOwnerWebVaultResult::Claimed);

        let status = status(&pool, community).await.expect("read status");
        assert_eq!(status.owner_pubkey.as_deref(), Some(owner.as_str()));
        assert!(status.vault_ready);
        assert_eq!(
            credential(&pool, community, &credential_id)
                .await
                .expect("read credential")
                .expect("credential exists")
                .ciphertext,
            vec![4; 48],
        );
        assert_eq!(
            recovery(&pool, community)
                .await
                .expect("read recovery")
                .expect("recovery exists")
                .ciphertext,
            vec![7; 48],
        );

        let second = claim(
            &pool,
            community,
            &"cd".repeat(32),
            NewOwnerWebWrapper {
                kdf_salt: &[5; 32],
                nonce: &[6; 12],
                ciphertext: &[7; 48],
            },
            new_credential(&[8; 32]),
        )
        .await
        .expect("second claim outcome");
        assert_eq!(second, ClaimOwnerWebVaultResult::AlreadyClaimed);
    }
}
