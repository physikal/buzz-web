import { Bot, Copy, MessageCircle, UserMinus, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import type { UserProfile } from "@/features/channels/channel-api";
import type {
  PresenceStatus,
  UserStatus,
} from "@/features/presence/presence-api";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import { Button } from "@/shared/ui/button";

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

export function UserProfileDialog({
  pubkey,
  ownerPubkey,
  profile,
  agentName,
  presence = "offline",
  userStatus,
  onClose,
  onMessage,
  following,
  followPending = false,
  onToggleFollow,
}: {
  pubkey: string | null;
  ownerPubkey: string;
  profile?: UserProfile;
  agentName?: string;
  presence?: PresenceStatus;
  userStatus?: UserStatus;
  onClose: () => void;
  onMessage: (pubkey: string) => void;
  following?: boolean;
  followPending?: boolean;
  onToggleFollow?: () => void;
}) {
  useEscapeSurface(Boolean(pubkey), onClose);
  if (!pubkey) return null;
  const displayName =
    agentName ??
    profile?.displayName ??
    (pubkey === ownerPubkey ? "You" : truncatePubkey(pubkey));
  return (
    <div
      aria-label={`${displayName} profile`}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-lg bg-background p-5 shadow-2xl">
        <header className="flex items-start gap-4">
          <div className="relative shrink-0">
            {profile?.avatarUrl ? (
              <img
                alt=""
                className="h-16 w-16 rounded-md object-cover"
                src={profile.avatarUrl}
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-md bg-muted text-xl font-semibold">
                {displayName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-background">
              <PresenceDot status={presence} />
            </span>
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{displayName}</h2>
              {agentName ? (
                <Bot
                  aria-label="Agent"
                  className="h-4 w-4 text-muted-foreground"
                />
              ) : null}
            </div>
            <p className="mt-1 capitalize text-xs text-muted-foreground">
              {presence}
            </p>
            {profile?.nip05Handle ? (
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {profile.nip05Handle}
              </p>
            ) : null}
            {userStatus ? (
              <p className="mt-2 break-words text-sm">
                {userStatus.emoji ? `${userStatus.emoji} ` : ""}
                {userStatus.text}
              </p>
            ) : null}
          </div>
          <Button
            aria-label="Close"
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        {profile?.about ? (
          <p className="mt-5 whitespace-pre-wrap text-sm text-muted-foreground">
            {profile.about}
          </p>
        ) : null}
        <button
          className="mt-5 flex w-full items-center gap-2 rounded-md border p-3 text-left hover:bg-muted"
          onClick={async () => {
            await navigator.clipboard.writeText(pubkey);
            toast.success("Public key copied");
          }}
          type="button"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium">Public key</span>
            <span className="block truncate font-mono text-xs text-muted-foreground">
              {pubkey}
            </span>
          </span>
          <Copy className="h-4 w-4 shrink-0" />
        </button>
        {pubkey !== ownerPubkey ? (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {onToggleFollow ? (
              <Button
                disabled={followPending}
                onClick={onToggleFollow}
                variant="outline"
              >
                {following ? <UserMinus /> : <UserPlus />}
                {following ? "Unfollow" : "Follow"}
              </Button>
            ) : null}
            <Button
              className={onToggleFollow ? undefined : "col-span-2"}
              onClick={() => onMessage(pubkey)}
            >
              <MessageCircle />
              Message
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
