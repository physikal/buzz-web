import { Outlet, createRootRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ReminderNotifier } from "@/features/reminders/ui/ReminderNotifier";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(null);

  useEffect(() => {
    const connected = (event: Event) => {
      const pubkey = (event as CustomEvent<unknown>).detail;
      if (typeof pubkey === "string" && /^[0-9a-f]{64}$/.test(pubkey)) {
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

  return (
    <div className="flex min-h-dvh flex-col">
      <ReminderNotifier ownerPubkey={ownerPubkey} />
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
