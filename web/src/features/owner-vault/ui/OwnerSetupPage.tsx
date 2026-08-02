import { useNavigate } from "@tanstack/react-router";
import { Check, Copy, KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { encodeBase64Url, randomBytes } from "../lib/encoding";
import { claimOwnerVault, getOwnerVaultStatus } from "../lib/owner-vault-api";
import { createVaultPasskey } from "../lib/passkey";
import { createOwnerVault, lockOwnerVault } from "../lib/vault-worker-client";

export function OwnerSetupPage({ claimToken }: { claimToken: string }) {
  const navigate = useNavigate();
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(null);
  const [vaultReady, setVaultReady] = useState(false);
  const [claimEnabled, setClaimEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [existingNsec, setExistingNsec] = useState("");
  const [backupPassword, setBackupPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOwnerVaultStatus()
      .then((status) => {
        setOwnerPubkey(status.owner_pubkey);
        setVaultReady(status.vault_ready);
        setClaimEnabled(status.claim_enabled);
      })
      .catch((cause) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load owner setup.",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  async function setUpOwner() {
    setPending(true);
    setError(null);
    try {
      if (!/^[0-9a-fA-F]{64}$/.test(claimToken)) {
        throw new Error(
          "Open the complete owner setup URL from the bootstrap log.",
        );
      }
      const passkey = await createVaultPasskey();
      const recoverySecret = randomBytes(32);
      const displayRecovery = `buzz-recovery-v1_${encodeBase64Url(recoverySecret)}`;
      const recoveryKdfSalt = encodeBase64Url(randomBytes(32));
      const ownerKey = existingNsec.trim();
      const encryptedBackup = ownerKey.toLowerCase().startsWith("ncryptsec1");
      const vault = await createOwnerVault({
        nsec: ownerPubkey && !encryptedBackup ? ownerKey : undefined,
        ncryptsec: ownerPubkey && encryptedBackup ? ownerKey : undefined,
        backupPassword: encryptedBackup ? backupPassword : undefined,
        passkeyMaterial: passkey.material,
        passkeyKdfSalt: passkey.kdfSalt,
        recoveryMaterial: recoverySecret.buffer,
        recoveryKdfSalt,
      });
      if (ownerPubkey && vault.pubkey !== ownerPubkey) {
        throw new Error(
          "This key does not match the owner of this Buzz server.",
        );
      }
      await claimOwnerVault({
        token: claimToken,
        credential: {
          credential_id: passkey.credentialId,
          label: "Primary passkey",
          prf_input: passkey.prfInput,
          ...vault.credential,
        },
        recovery: vault.recovery,
      });
      setRecoveryCode(displayRecovery);
    } catch (cause) {
      await lockOwnerVault().catch(() => undefined);
      setError(
        cause instanceof Error
          ? cause.message
          : "Owner setup did not complete.",
      );
    } finally {
      setPending(false);
    }
  }

  if (recoveryCode) {
    return (
      <SetupShell>
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600">
          <Check className="h-5 w-5" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold">Owner passkey created</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Store this vault unlock code in a password manager or separately from
          the server. It also works on browsers whose passkey provider does not
          support encrypted vaults.
        </p>
        <div className="mt-5 rounded-md border border-border bg-muted/40 p-3 text-left">
          <input
            autoComplete="username"
            name="username"
            readOnly
            type="hidden"
            value={`owner@${window.location.hostname}`}
          />
          <input
            aria-label="Vault unlock code"
            autoComplete="new-password"
            className="block w-full break-all bg-transparent font-mono text-sm leading-6 outline-none"
            name="password"
            readOnly
            type="password"
            value={recoveryCode}
          />
          <Button
            className="mt-3 w-full"
            type="button"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(recoveryCode);
              setCopied(true);
            }}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy recovery code"}
          </Button>
        </div>
        <label className="mt-4 flex items-start gap-3 text-left text-sm leading-5">
          <input
            checked={recoverySaved}
            className="mt-0.5 h-4 w-4"
            type="checkbox"
            onChange={(event) => setRecoverySaved(event.target.checked)}
          />
          <span>I saved this vault unlock code somewhere secure.</span>
        </label>
        <Button
          className="mt-5 w-full"
          disabled={!recoverySaved}
          onClick={() => navigate({ to: "/channels" })}
        >
          Open Buzz
        </Button>
      </SetupShell>
    );
  }

  return (
    <SetupShell>
      <h1 className="mt-6 text-2xl font-semibold">Set up this Buzz server</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Create an owner passkey using a compatible secure sign-in provider.
      </p>

      {loading ? (
        <p className="mt-6 text-sm text-muted-foreground">Checking server…</p>
      ) : vaultReady ? (
        <>
          <p className="mt-6 rounded-md border border-border bg-muted/40 px-3 py-3 text-left text-sm">
            This Buzz server already has an owner passkey.
          </p>
          <Button
            className="mt-4 w-full"
            onClick={() => navigate({ to: "/channels" })}
          >
            Continue to Buzz
          </Button>
        </>
      ) : (
        <>
          {ownerPubkey ? (
            <div className="mt-5 text-left">
              <label
                className="text-sm font-medium"
                htmlFor="existing-owner-key"
              >
                Existing owner key
              </label>
              <Input
                autoComplete="off"
                className="mt-2 font-mono"
                id="existing-owner-key"
                placeholder="nsec1… or ncryptsec1…"
                spellCheck={false}
                type="password"
                value={existingNsec}
                onChange={(event) => {
                  setExistingNsec(event.target.value);
                  setBackupPassword("");
                }}
              />
              <label className="mt-2 inline-flex cursor-pointer text-xs font-medium text-primary hover:underline">
                Choose a backup file
                <input
                  accept=".key,.ncryptsec,text/plain"
                  className="hidden"
                  type="file"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    if (file.size > 10_000) {
                      setError("That owner backup file is too large.");
                      return;
                    }
                    setExistingNsec((await file.text()).trim());
                    setBackupPassword("");
                    setError(null);
                  }}
                />
              </label>
              {existingNsec.trim().toLowerCase().startsWith("ncryptsec1") ? (
                <label
                  className="mt-4 block text-sm font-medium"
                  htmlFor="existing-owner-backup-password"
                >
                  Backup password
                  <Input
                    autoComplete="current-password"
                    className="mt-2"
                    id="existing-owner-backup-password"
                    maxLength={256}
                    type="password"
                    value={backupPassword}
                    onChange={(event) => setBackupPassword(event.target.value)}
                  />
                </label>
              ) : null}
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                This relay already has an owner. The key or encrypted backup is
                sent directly to the local signing worker and is not uploaded.
              </p>
            </div>
          ) : null}
          <Button
            className="mt-5 w-full"
            disabled={
              pending ||
              !claimEnabled ||
              !/^[0-9a-fA-F]{64}$/.test(claimToken) ||
              (ownerPubkey !== null && existingNsec.trim().length === 0) ||
              (existingNsec.trim().toLowerCase().startsWith("ncryptsec1") &&
                backupPassword.length === 0)
            }
            onClick={setUpOwner}
          >
            <KeyRound />
            {pending ? "Creating owner passkey…" : "Create owner passkey"}
          </Button>
          <div className="mt-4 flex items-start gap-2 text-left text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Buzz stores an encrypted owner vault. Your passkey secret and
              plaintext Nostr key stay on this device.
            </p>
          </div>
        </>
      )}

      {error ? (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </SetupShell>
  );
}

function SetupShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
      <section className="w-full max-w-md text-center">
        <div
          className="mx-auto h-16 w-16 overflow-hidden bg-black"
          style={{ borderRadius: "22.37%" }}
        >
          <img alt="Buzz" className="h-full w-full" src={buzzAppIcon} />
        </div>
        {children}
      </section>
    </main>
  );
}
