import type { PresenceStatus } from "./presence-api";

export function PresenceDot({ status }: { status: PresenceStatus }) {
  return (
    <span
      aria-label={status}
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        status === "online"
          ? "bg-emerald-500"
          : status === "away"
            ? "bg-amber-500"
            : "bg-muted-foreground/35"
      }`}
      role="img"
    />
  );
}
