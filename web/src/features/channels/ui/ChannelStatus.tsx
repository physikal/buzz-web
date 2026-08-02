import { truncatePubkey } from "@/shared/lib/pubkey";

export function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function TypingLine({
  pubkeys,
  profiles,
}: {
  pubkeys: string[];
  profiles: Map<string, { displayName: string | null }>;
}) {
  if (!pubkeys.length) return null;
  const names = pubkeys.map(
    (pubkey) => profiles.get(pubkey)?.displayName || truncatePubkey(pubkey),
  );
  const label =
    names.length === 1
      ? `${names[0]} is typing…`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing…`
        : `${names[0]}, ${names[1]}, and ${names.length - 2} others are typing…`;
  return (
    <p className="px-5 pt-2 text-xs text-muted-foreground" role="status">
      {label}
    </p>
  );
}
