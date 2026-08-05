import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, LockKeyhole, Settings, Smile } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { getOwnerProfile } from "@/features/settings/settings-api";
import { PresenceDot } from "@/features/presence/PresenceDot";
import { usePresenceSession } from "@/features/presence/presence-session";
import type { PresenceStatus } from "@/features/presence/presence-api";
import { SetStatusDialog } from "@/features/user-status/SetStatusDialog";
import { StatusEmoji } from "@/features/user-status/StatusEmoji";
import { useOwnerStatus } from "@/features/user-status/use-owner-status";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import { truncatePubkey } from "@/shared/lib/pubkey";

const STATUSES: PresenceStatus[] = ["online", "away", "offline"];

function presenceLabel(status: PresenceStatus) {
  return status.slice(0, 1).toUpperCase() + status.slice(1);
}

const MENU_ITEM =
  "flex min-h-9 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0";

export function SidebarOwnerProfileMenu({
  onLock,
  ownerPubkey,
}: {
  onLock: () => void;
  ownerPubkey: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const presence = usePresenceSession();
  const ownerStatus = useOwnerStatus(ownerPubkey);
  const profileQuery = useQuery({
    queryKey: ["owner-profile", ownerPubkey],
    queryFn: () => getOwnerProfile(ownerPubkey),
  });
  const profile = profileQuery.data;
  const displayName = profile?.displayName || truncatePubkey(ownerPubkey);
  const initials = displayName.slice(0, 2).toUpperCase();

  useEscapeSurface(menuOpen, () => {
    setPresenceOpen(false);
    setMenuOpen(false);
  });

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !containerRef.current?.contains(target)) {
        setPresenceOpen(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOutside, true);
    return () => window.removeEventListener("pointerdown", closeOutside, true);
  }, [menuOpen]);

  const selectPresence = async (status: PresenceStatus) => {
    try {
      await presence.setStatus(status);
      setPresenceOpen(false);
      setMenuOpen(false);
    } catch (error) {
      toast.error("Could not update presence", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <>
      <div className="relative" ref={containerRef}>
        <button
          aria-expanded={menuOpen}
          aria-label={`Open profile menu for ${displayName}`}
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent"
          data-testid="sidebar-profile-card"
          onClick={() => {
            setPresenceOpen(false);
            setMenuOpen((value) => !value);
          }}
          type="button"
        >
          <span className="relative shrink-0">
            {profile?.avatarUrl ? (
              <img
                alt=""
                className="h-8 w-8 rounded-md object-cover"
                src={profile.avatarUrl}
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar-accent text-xs font-semibold">
                {initials}
              </span>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-sidebar bg-sidebar">
              <PresenceDot status={presence.currentStatus} />
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-sidebar-foreground">
              {displayName}
            </span>
            <span className="flex min-w-0 items-center text-xs text-muted-foreground">
              {ownerStatus.status?.emoji ? (
                <StatusEmoji
                  className="mr-1 h-4 w-4 shrink-0 text-xs"
                  customEmoji={ownerStatus.customEmoji}
                  value={ownerStatus.status.emoji}
                />
              ) : null}
              <span className="truncate">
                {ownerStatus.status?.text || "Buzz owner"}
              </span>
            </span>
          </span>
        </button>

        {menuOpen ? (
          <div
            className="absolute bottom-12 left-0 z-40 w-[280px] rounded-md border bg-popover p-1 shadow-xl"
            data-testid="profile-popover"
            role="menu"
          >
            <div className="flex items-center gap-2 px-3 py-2">
              {profile?.avatarUrl ? (
                <img
                  alt=""
                  className="h-8 w-8 rounded-md object-cover"
                  src={profile.avatarUrl}
                />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-xs font-semibold">
                  {initials}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{displayName}</p>
                <button
                  className="mt-0.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium hover:bg-accent"
                  data-testid="profile-popover-presence-trigger"
                  disabled={presence.isPending}
                  onClick={() => setPresenceOpen((value) => !value)}
                  type="button"
                >
                  {presenceLabel(presence.currentStatus)}
                </button>
              </div>
            </div>

            {presenceOpen ? (
              <div
                aria-label="Presence status"
                className="px-1 pb-1"
                role="menu"
              >
                {STATUSES.map((status) => (
                  <button
                    className={MENU_ITEM}
                    data-testid={`profile-popover-status-${status}`}
                    disabled={presence.isPending}
                    key={status}
                    onClick={() => void selectPresence(status)}
                    role="menuitem"
                    type="button"
                  >
                    <PresenceDot status={status} />
                    <span className="flex-1">{presenceLabel(status)}</span>
                    {presence.currentStatus === status ? <Check /> : null}
                  </button>
                ))}
              </div>
            ) : null}

            <button
              className={`${MENU_ITEM} border border-border/60`}
              data-testid="profile-popover-set-status"
              onClick={() => {
                setPresenceOpen(false);
                setMenuOpen(false);
                setStatusOpen(true);
              }}
              role="menuitem"
              type="button"
            >
              <Smile />
              {ownerStatus.status ? (
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  {ownerStatus.status.emoji ? (
                    <StatusEmoji
                      className="h-5 w-5 shrink-0 text-base"
                      customEmoji={ownerStatus.customEmoji}
                      value={ownerStatus.status.emoji}
                    />
                  ) : null}
                  <span className="truncate">{ownerStatus.status.text}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Update your status
                </span>
              )}
            </button>

            <div className="my-1 h-px bg-border" />
            <Link
              className={MENU_ITEM}
              data-testid="profile-popover-settings"
              onClick={() => setMenuOpen(false)}
              role="menuitem"
              to="/settings"
            >
              <Settings />
              <span className="flex-1">Settings</span>
            </Link>
            <button
              className={MENU_ITEM}
              data-testid="profile-popover-lock"
              onClick={() => {
                setMenuOpen(false);
                onLock();
              }}
              role="menuitem"
              type="button"
            >
              <LockKeyhole />
              <span>Lock Buzz</span>
            </button>
          </div>
        ) : null}
      </div>

      <SetStatusDialog
        customEmoji={ownerStatus.customEmoji}
        hasExistingStatus={Boolean(ownerStatus.status)}
        initialEmoji={ownerStatus.status?.emoji ?? ""}
        initialText={ownerStatus.status?.text ?? ""}
        onClear={() => ownerStatus.setStatus("", "")}
        onClose={() => setStatusOpen(false)}
        onSave={ownerStatus.setStatus}
        open={statusOpen}
        pending={ownerStatus.isPending}
      />
    </>
  );
}
