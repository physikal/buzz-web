import { encodeBase64Url, randomBytes } from "./encoding";

type PrfExtensionResults = {
  prf?: {
    enabled?: boolean;
    results?: { first?: ArrayBuffer };
  };
};

type PrfExtensions = AuthenticationExtensionsClientInputs & {
  prf: { eval: { first: ArrayBuffer } };
};

export type PasskeyMaterial = {
  credentialId: string;
  material: ArrayBuffer;
  kdfSalt: string;
  prfInput: string;
};

export class PasskeyUnavailableError extends Error {
  constructor(
    message = "This browser or passkey does not support secure vault encryption.",
  ) {
    super(message);
    this.name = "PasskeyUnavailableError";
  }
}

function ensurePasskeys(): void {
  if (!window.isSecureContext || !window.PublicKeyCredential) {
    throw new PasskeyUnavailableError(
      "Owner passkeys require HTTPS and a browser with WebAuthn support.",
    );
  }
}

async function fixedPrfInput(): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("Buzz owner vault PRF input v1"),
    ),
  );
}

function prfResult(credential: PublicKeyCredential): ArrayBuffer | null {
  const outputs = credential.getClientExtensionResults() as PrfExtensionResults;
  return outputs.prf?.results?.first ?? null;
}

async function evaluatePrf(
  credentialId: ArrayBuffer,
  prfInput: Uint8Array<ArrayBuffer>,
): Promise<ArrayBuffer> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId: window.location.hostname,
      allowCredentials: [{ id: credentialId, type: "public-key" }],
      userVerification: "required",
      timeout: 120_000,
      extensions: {
        prf: { eval: { first: prfInput.buffer } },
      } as PrfExtensions,
    },
  })) as PublicKeyCredential | null;
  const material = assertion ? prfResult(assertion) : null;
  if (!assertion || !material) throw new PasskeyUnavailableError();
  return material;
}

export async function createVaultPasskey(): Promise<PasskeyMaterial> {
  ensurePasskeys();
  const prfInput = await fixedPrfInput();
  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { id: window.location.hostname, name: "Buzz" },
      user: {
        id: randomBytes(32),
        name: `owner@${window.location.hostname}`,
        displayName: "Buzz owner",
      },
      challenge: randomBytes(32),
      pubKeyCredParams: [{ alg: -7, type: "public-key" }],
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      attestation: "none",
      timeout: 120_000,
      extensions: {
        prf: { eval: { first: prfInput.buffer } },
      } as PrfExtensions,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("Passkey creation was cancelled.");

  const outputs = credential.getClientExtensionResults() as PrfExtensionResults;
  if (outputs.prf?.enabled !== true) throw new PasskeyUnavailableError();
  const material =
    prfResult(credential) ?? (await evaluatePrf(credential.rawId, prfInput));
  return {
    credentialId: encodeBase64Url(credential.rawId),
    material,
    kdfSalt: encodeBase64Url(randomBytes(32)),
    prfInput: encodeBase64Url(prfInput),
  };
}

export async function unlockVaultPasskey(): Promise<{
  credentialId: string;
  material: ArrayBuffer;
}> {
  ensurePasskeys();
  const prfInput = await fixedPrfInput();
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId: window.location.hostname,
      userVerification: "required",
      timeout: 120_000,
      extensions: {
        prf: { eval: { first: prfInput.buffer } },
      } as PrfExtensions,
    },
  })) as PublicKeyCredential | null;
  const material = assertion ? prfResult(assertion) : null;
  if (!assertion) throw new Error("Passkey unlock was cancelled.");
  if (!material) throw new PasskeyUnavailableError();
  return {
    credentialId: encodeBase64Url(assertion.rawId),
    material,
  };
}
