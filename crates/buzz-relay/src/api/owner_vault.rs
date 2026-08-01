//! One-time browser owner claim and passkey-wrapped vault retrieval.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use buzz_db::owner_web_vault::{
    ClaimOwnerWebVaultResult, NewOwnerWebCredential, NewOwnerWebWrapper,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use super::{api_error, bridge};
use crate::state::AppState;

const MAX_CREDENTIAL_ID_BYTES: usize = 1024;
const MAX_LABEL_LEN: usize = 120;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClaimOwnerRequest {
    token: String,
    credential: CredentialRequest,
    recovery: WrapperRequest,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AddCredentialRequest {
    credential: CredentialRequest,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
/// Opaque credential selector sent after the browser chooses a passkey.
pub struct UnlockRequest {
    credential_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CredentialRequest {
    credential_id: String,
    label: String,
    prf_input: String,
    kdf_salt: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WrapperRequest {
    kdf_salt: String,
    nonce: String,
    ciphertext: String,
}

struct DecodedCredential {
    credential_id: Vec<u8>,
    label: String,
    prf_input: [u8; 32],
    kdf_salt: [u8; 32],
    nonce: [u8; 12],
    ciphertext: [u8; 48],
}

struct DecodedWrapper {
    kdf_salt: [u8; 32],
    nonce: [u8; 12],
    ciphertext: [u8; 48],
}

async fn deployment_tenant(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<buzz_core::TenantContext, (StatusCode, Json<Value>)> {
    let raw_host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let tenant = crate::tenant::bind_community(&state.db, raw_host)
        .await
        .map_err(|_| api_error(StatusCode::NOT_FOUND, "community not found"))?;
    let deployment_host = crate::tenant::relay_url_authority(&state.config.relay_url);
    if tenant.host() != deployment_host {
        return Err(api_error(StatusCode::NOT_FOUND, "community not found"));
    }
    Ok(tenant)
}

/// Return enough public state for the browser to choose setup or unlock.
pub async fn status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let tenant = deployment_tenant(&state, &headers).await?;
    let status = state
        .db
        .owner_web_vault_status(tenant.community())
        .await
        .map_err(|error| {
            tracing::error!(%error, "owner web vault status failed");
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        })?;
    Ok(Json(json!({
        "claimed": status.owner_pubkey.is_some(),
        "vault_ready": status.vault_ready,
        "owner_pubkey": status.owner_pubkey,
        "claim_enabled": claim_is_current(&state),
    })))
}

/// Consume the deployment claim token and atomically create the first vault.
pub async fn claim(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let tenant = deployment_tenant(&state, &headers).await?;
    let request: ClaimOwnerRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid request body"))?;
    let expected_hash = state
        .config
        .owner_claim_token_hash
        .as_ref()
        .ok_or_else(|| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "browser owner setup is not configured",
            )
        })?;
    if !claim_is_current(&state) {
        return Err(api_error(
            StatusCode::UNAUTHORIZED,
            "owner setup link expired; redeploy to create a new link",
        ));
    }
    if request.token.len() != 64 || !request.token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(api_error(StatusCode::UNAUTHORIZED, "invalid setup token"));
    }
    let provided_hash: [u8; 32] = Sha256::digest(request.token.as_bytes()).into();
    if !bool::from(provided_hash.ct_eq(expected_hash)) {
        return Err(api_error(StatusCode::UNAUTHORIZED, "invalid setup token"));
    }

    let expected_url =
        bridge::nip98_expected_url(&state.config.relay_url, &tenant, "/api/owner/claim");
    let (owner, event_id) = bridge::verify_bridge_auth_with_options(
        &headers,
        "POST",
        &expected_url,
        Some(&body),
        true,
        true,
    )?;
    bridge::check_nip98_replay(&state, &tenant, event_id).await?;

    let credential = decode_credential(request.credential)?;
    let recovery = decode_wrapper(request.recovery)?;
    let result = state
        .db
        .claim_owner_web_vault(
            tenant.community(),
            &owner.to_hex(),
            NewOwnerWebWrapper {
                kdf_salt: &recovery.kdf_salt,
                nonce: &recovery.nonce,
                ciphertext: &recovery.ciphertext,
            },
            as_new_credential(&credential),
        )
        .await
        .map_err(|error| {
            tracing::error!(%error, "owner web vault claim failed");
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "owner setup failed")
        })?;
    match result {
        ClaimOwnerWebVaultResult::Claimed => Ok((
            StatusCode::CREATED,
            Json(json!({ "owner_pubkey": owner.to_hex() })),
        )),
        ClaimOwnerWebVaultResult::AlreadyClaimed => Err(api_error(
            StatusCode::CONFLICT,
            "this Buzz server has already been claimed",
        )),
        ClaimOwnerWebVaultResult::OwnerMismatch => Err(api_error(
            StatusCode::FORBIDDEN,
            "the imported key is not the current relay owner",
        )),
    }
}

/// Return one opaque passkey wrapper after the browser selects a credential.
pub async fn unlock(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<UnlockRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let tenant = deployment_tenant(&state, &headers).await?;
    let credential_id = decode_bounded(&request.credential_id, 16, MAX_CREDENTIAL_ID_BYTES)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid credential id"))?;
    let wrapper = state
        .db
        .owner_web_credential(tenant.community(), &credential_id)
        .await
        .map_err(|error| {
            tracing::error!(%error, "owner web credential lookup failed");
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        })?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "passkey is not registered"))?;
    Ok(Json(json!({
        "owner_pubkey": wrapper.owner_pubkey,
        "prf_input": encode(&wrapper.prf_input),
        "kdf_salt": encode(&wrapper.kdf_salt),
        "nonce": encode(&wrapper.nonce),
        "ciphertext": encode(&wrapper.ciphertext),
    })))
}

/// Return the opaque recovery wrapper. The recovery secret never reaches the relay.
pub async fn recovery(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let tenant = deployment_tenant(&state, &headers).await?;
    let wrapper = state
        .db
        .owner_web_recovery(tenant.community())
        .await
        .map_err(|error| {
            tracing::error!(%error, "owner web recovery lookup failed");
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        })?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "owner vault not found"))?;
    Ok(Json(json!({
        "owner_pubkey": wrapper.owner_pubkey,
        "kdf_salt": encode(&wrapper.kdf_salt),
        "nonce": encode(&wrapper.nonce),
        "ciphertext": encode(&wrapper.ciphertext),
    })))
}

/// Register another passkey wrapper after recovery or owner-approved pairing.
pub async fn add_credential(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let (tenant, owner) = super::agents::authorize_owner(
        &state,
        &headers,
        "POST",
        "/api/owner/credentials",
        Some(&body),
        true,
    )
    .await?;
    let request: AddCredentialRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid request body"))?;
    let credential = decode_credential(request.credential)?;
    let inserted = state
        .db
        .add_owner_web_credential(
            tenant.community(),
            &owner.to_hex(),
            as_new_credential(&credential),
        )
        .await
        .map_err(|error| {
            tracing::warn!(%error, "owner web credential insert failed");
            api_error(StatusCode::CONFLICT, "passkey is already registered")
        })?;
    if !inserted {
        return Err(api_error(StatusCode::FORBIDDEN, "owner access required"));
    }
    Ok((StatusCode::CREATED, Json(json!({ "registered": true }))))
}

fn decode_credential(
    request: CredentialRequest,
) -> Result<DecodedCredential, (StatusCode, Json<Value>)> {
    let label = request.label.trim();
    if label.is_empty() || label.len() > MAX_LABEL_LEN {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid passkey label"));
    }
    Ok(DecodedCredential {
        credential_id: decode_bounded(&request.credential_id, 16, MAX_CREDENTIAL_ID_BYTES)
            .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid credential id"))?,
        label: label.to_owned(),
        prf_input: decode_exact(&request.prf_input)
            .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid PRF input"))?,
        kdf_salt: decode_exact(&request.kdf_salt)
            .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid KDF salt"))?,
        nonce: decode_exact(&request.nonce)
            .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid vault nonce"))?,
        ciphertext: decode_exact(&request.ciphertext)
            .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid vault ciphertext"))?,
    })
}

fn decode_wrapper(request: WrapperRequest) -> Result<DecodedWrapper, (StatusCode, Json<Value>)> {
    Ok(DecodedWrapper {
        kdf_salt: decode_exact(&request.kdf_salt)
            .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid recovery KDF salt"))?,
        nonce: decode_exact(&request.nonce)
            .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid recovery nonce"))?,
        ciphertext: decode_exact(&request.ciphertext)
            .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid recovery ciphertext"))?,
    })
}

fn as_new_credential(credential: &DecodedCredential) -> NewOwnerWebCredential<'_> {
    NewOwnerWebCredential {
        credential_id: &credential.credential_id,
        label: &credential.label,
        prf_input: &credential.prf_input,
        wrapper: NewOwnerWebWrapper {
            kdf_salt: &credential.kdf_salt,
            nonce: &credential.nonce,
            ciphertext: &credential.ciphertext,
        },
    }
}

fn decode_exact<const N: usize>(value: &str) -> Result<[u8; N], ()> {
    decode_bounded(value, N, N)?.try_into().map_err(|_| ())
}

fn decode_bounded(value: &str, min: usize, max: usize) -> Result<Vec<u8>, ()> {
    let decoded = URL_SAFE_NO_PAD.decode(value).map_err(|_| ())?;
    (decoded.len() >= min && decoded.len() <= max)
        .then_some(decoded)
        .ok_or(())
}

fn encode(value: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(value)
}

fn claim_is_current(state: &AppState) -> bool {
    let Some(expires_at) = state.config.owner_claim_expires_at else {
        return false;
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(u64::MAX);
    state.config.owner_claim_token_hash.is_some() && now < expires_at
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_decoder_rejects_wrong_size_and_padding() {
        assert_eq!(decode_exact::<32>(&encode(&[7; 32])), Ok([7; 32]));
        assert!(decode_exact::<32>(&encode(&[7; 31])).is_err());
        assert!(decode_exact::<32>("not+padded=").is_err());
    }
}
