import { KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { addOwnerCredential } from "../lib/owner-vault-api";
import { createVaultPasskey } from "../lib/passkey";
import { wrapOwnerVault } from "../lib/vault-worker-client";

export function OwnerPasskeysPanel() {
  const [label, setLabel] = useState("Additional passkey");
  const [pending, setPending] = useState(false);

  async function addPasskey() {
    const trimmedLabel = label.trim();
    if (!trimmedLabel || trimmedLabel.length > 120) return;
    setPending(true);
    try {
      const passkey = await createVaultPasskey();
      const wrapper = await wrapOwnerVault(passkey.material, passkey.kdfSalt);
      await addOwnerCredential({
        credential_id: passkey.credentialId,
        label: trimmedLabel,
        prf_input: passkey.prfInput,
        ...wrapper,
      });
      setLabel("Additional passkey");
      toast.success("Passkey added");
    } catch (error) {
      toast.error("Could not add passkey", {
        description:
          error instanceof Error ? error.message : "Passkey setup failed.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="owner-passkeys-heading"
      className="mt-8 rounded-md border p-4"
    >
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-5 w-5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold" id="owner-passkeys-heading">
            Owner passkeys
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Add another device or password manager without exposing your owner
            key.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Passkey label"
          disabled={pending}
          maxLength={120}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Button
          disabled={pending || !label.trim()}
          onClick={() => void addPasskey()}
          type="button"
          variant="outline"
        >
          <Plus />
          {pending ? "Adding…" : "Add passkey"}
        </Button>
      </div>
    </section>
  );
}
