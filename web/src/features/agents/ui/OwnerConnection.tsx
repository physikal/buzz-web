import { ExternalLink, KeyRound, ShieldCheck } from "lucide-react";
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
          ? "No Nostr signer was found. Install a signer below, import your owner key, then reload Buzz."
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
          <div className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-3 text-left text-xs leading-5 text-muted-foreground">
            <p>
              Install the open-source Alby signer from the official browser
              store, then verify the publisher is <strong>Alby</strong> before
              importing your owner key.
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 font-medium">
              <a
                className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
                href="https://chromewebstore.google.com/detail/alby/iokeahhehimjnekafflcihljlcjccdbe"
                rel="noreferrer"
                target="_blank"
              >
                Chrome, Edge, or Brave <ExternalLink className="h-3 w-3" />
              </a>
              <a
                className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
                href="https://addons.mozilla.org/firefox/addon/alby/"
                rel="noreferrer"
                target="_blank"
              >
                Firefox <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
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
