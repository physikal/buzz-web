import { KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import {
  getNip07PublicKey,
  hasNip07Provider,
  Nip07UnavailableError,
} from "@/shared/lib/nostr-signer";
import { Button } from "@/shared/ui/button";

export function OwnerConnection({
  onConnected,
}: {
  onConnected: (pubkey: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function connect() {
    setPending(true);
    setError(null);
    try {
      onConnected(await getNip07PublicKey());
    } catch (cause) {
      setError(
        cause instanceof Nip07UnavailableError
          ? "No Nostr signer was found in this browser. Install a NIP-07 signer, add your owner key to it, then reload Buzz."
          : cause instanceof Error
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
          Use the owner key for this relay to manage its server-hosted agents.
        </p>
        <Button className="mt-6 w-full" disabled={pending} onClick={connect}>
          <KeyRound />
          {pending ? "Waiting for signer…" : "Connect owner key"}
        </Button>
        <div className="mt-4 flex items-start gap-2 text-left text-xs leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Your private key stays in your signer. Buzz receives signed
            approval, never the key itself.
          </p>
        </div>
        {!hasNip07Provider() ? (
          <p className="mt-4 text-xs text-muted-foreground">
            A NIP-07 browser signer is required.
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
