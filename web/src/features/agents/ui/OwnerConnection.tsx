import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import { decodeBase64Url } from "@/features/owner-vault/lib/encoding";
import {
  getOwnerVaultStatus,
  getPasskeyWrapper,
  getRecoveryWrapper,
  type OwnerVaultStatus,
} from "@/features/owner-vault/lib/owner-vault-api";
import { unlockVaultPasskey } from "@/features/owner-vault/lib/passkey";
import {
  getUnlockedOwnerPublicKey,
  hasUnlockedOwnerVault,
  unlockOwnerVault,
} from "@/features/owner-vault/lib/vault-worker-client";
import { getBrowserOwnerPublicKey } from "@/shared/lib/nostr-signer";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export function OwnerConnection({
  onConnected,
}: {
  onConnected: (pubkey: string) => void;
}) {
  const [status, setStatus] = useState<OwnerVaultStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const connected = useCallback(
    (pubkey: string) => {
      window.dispatchEvent(
        new CustomEvent("buzz-web:owner-connected", { detail: pubkey }),
      );
      onConnected(pubkey);
    },
    [onConnected],
  );

  useEffect(() => {
    if (hasUnlockedOwnerVault()) {
      getUnlockedOwnerPublicKey()
        .then(connected)
        .catch(() => undefined);
      setLoading(false);
      return;
    }
    getOwnerVaultStatus()
      .then(setStatus)
      .catch((cause) => {
        setError(
          cause instanceof Error ? cause.message : "Could not connect to Buzz.",
        );
      })
      .finally(() => setLoading(false));
  }, [connected]);

  async function unlock() {
    setPending(true);
    setError(null);
    try {
      const passkey = await unlockVaultPasskey();
      const wrapper = await getPasskeyWrapper(passkey.credentialId);
      const pubkey = await unlockOwnerVault({
        material: passkey.material,
        expectedPubkey: wrapper.owner_pubkey,
        wrapper,
      });
      connected(pubkey);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not unlock the owner vault.",
      );
    } finally {
      setPending(false);
    }
  }

  async function unlockWithRecovery() {
    setPending(true);
    setError(null);
    try {
      const encoded = recoveryCode.trim().replace(/^buzz-recovery-v1_/, "");
      const recoverySecret = decodeBase64Url(encoded);
      if (recoverySecret.length !== 32)
        throw new Error("Invalid recovery code.");
      const recovery = await getRecoveryWrapper();
      const pubkey = await unlockOwnerVault({
        material: recoverySecret.buffer,
        expectedPubkey: recovery.owner_pubkey,
        wrapper: recovery,
      });
      connected(pubkey);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not recover the owner vault.",
      );
    } finally {
      setPending(false);
    }
  }

  async function connectExternalSigner() {
    setPending(true);
    setError(null);
    try {
      connected(await getBrowserOwnerPublicKey());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not connect the owner key.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
      <section className="w-full max-w-md text-center">
        <div
          className="mx-auto h-16 w-16 overflow-hidden bg-black"
          style={{ borderRadius: "22.37%" }}
        >
          <img alt="Buzz" className="h-full w-full" src={buzzAppIcon} />
        </div>
        <h1 className="mt-6 text-2xl font-semibold">Connect to Buzz</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Unlock the owner key to manage this server&apos;s centralized agents.
        </p>

        {loading ? (
          <p className="mt-6 text-sm text-muted-foreground">Checking server…</p>
        ) : status?.vault_ready ? (
          !showRecovery ? (
            <>
              <Button
                className="mt-6 w-full"
                disabled={pending}
                onClick={unlock}
              >
                <KeyRound />
                {pending ? "Waiting for passkey…" : "Unlock with passkey"}
              </Button>
              <Button
                className="mt-2 w-full"
                disabled={pending}
                variant="ghost"
                onClick={() => setShowRecovery(true)}
              >
                <LockKeyhole />
                Use password manager or recovery code
              </Button>
            </>
          ) : (
            <form
              className="mt-6 text-left"
              onSubmit={(event) => {
                event.preventDefault();
                void unlockWithRecovery();
              }}
            >
              <label
                className="text-sm font-medium"
                htmlFor="owner-recovery-code"
              >
                Vault unlock code
              </label>
              <input
                autoComplete="username"
                name="username"
                readOnly
                type="hidden"
                value={`owner@${window.location.hostname}`}
              />
              <Input
                autoComplete="current-password"
                className="mt-2 font-mono"
                id="owner-recovery-code"
                name="password"
                placeholder="buzz-recovery-v1_…"
                spellCheck={false}
                type="password"
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value)}
              />
              <Button
                className="mt-3 w-full"
                disabled={pending || recoveryCode.trim().length === 0}
                type="submit"
              >
                <KeyRound />
                {pending ? "Unlocking…" : "Unlock Buzz"}
              </Button>
              <Button
                className="mt-2 w-full"
                disabled={pending}
                variant="ghost"
                onClick={() => setShowRecovery(false)}
                type="button"
              >
                Back
              </Button>
            </form>
          )
        ) : (
          <div className="mt-6 rounded-md border border-border bg-muted/40 px-3 py-3 text-left text-sm leading-6">
            <p>
              {status?.claimed
                ? "This relay uses a legacy owner key. Open the owner setup URL from the latest bootstrap log to protect it with a passkey."
                : "Open the one-time owner setup URL from the Dokploy bootstrap log."}
            </p>
            {status?.claimed ? (
              <Button
                className="mt-3 w-full"
                disabled={pending}
                variant="outline"
                onClick={connectExternalSigner}
              >
                <KeyRound />
                Use existing browser signer
              </Button>
            ) : null}
          </div>
        )}

        <div className="mt-4 flex items-start gap-2 text-left text-xs leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            The relay stores only an encrypted vault. Unlock with a PRF passkey
            or the high-entropy code saved in your password manager.
          </p>
        </div>
        {error ? (
          <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
