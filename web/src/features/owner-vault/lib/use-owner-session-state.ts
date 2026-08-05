import { useEffect, useState } from "react";

const OWNER_PUBKEY_PATTERN = /^[0-9a-f]{64}$/;

export function useOwnerSessionState(initialOwnerPubkey: string | null = null) {
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(
    initialOwnerPubkey,
  );

  useEffect(() => {
    const connected = (event: Event) => {
      const pubkey = (event as CustomEvent<unknown>).detail;
      if (typeof pubkey === "string" && OWNER_PUBKEY_PATTERN.test(pubkey)) {
        setOwnerPubkey(pubkey);
      }
    };
    const disconnected = () => setOwnerPubkey(null);

    window.addEventListener("buzz-web:owner-connected", connected);
    window.addEventListener("buzz-web:owner-disconnected", disconnected);
    return () => {
      window.removeEventListener("buzz-web:owner-connected", connected);
      window.removeEventListener("buzz-web:owner-disconnected", disconnected);
    };
  }, []);

  return [ownerPubkey, setOwnerPubkey] as const;
}
