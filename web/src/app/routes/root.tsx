import {
  Outlet,
  createRootRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { Suspense, useEffect } from "react";

import {
  CHANNEL_ACTION_EVENT,
  type ChannelAction,
} from "@/features/channels/channel-actions";
import { ChannelNotifier } from "@/features/channels/ui/ChannelNotifier";
import { hasUnlockedOwnerVault } from "@/features/owner-vault/lib/vault-worker-client";
import { useOwnerSessionState } from "@/features/owner-vault/lib/use-owner-session-state";
import { ReminderNotifier } from "@/features/reminders/ui/ReminderNotifier";
import { PresenceSessionProvider } from "@/features/presence/presence-session";
import {
  SidebarVisibilityProvider,
  useSidebarVisibility,
} from "@/shared/hooks/use-sidebar-visibility";
import {
  hasPrimaryShortcutModifier,
  isMacPlatform,
} from "@/shared/lib/keyboard-shortcuts";
import { hasActiveEscapeSurface } from "@/shared/hooks/use-escape-surface";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <SidebarVisibilityProvider>
      <RootLayoutContent />
    </SidebarVisibilityProvider>
  );
}

function RootLayoutContent() {
  const [ownerPubkey] = useOwnerSessionState();
  const sidebar = useSidebarVisibility();
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  useEffect(() => {
    const openChannelAction = (action: ChannelAction) => {
      if (pathname === "/channels") {
        window.dispatchEvent(
          new CustomEvent(CHANNEL_ACTION_EVENT, { detail: action }),
        );
        return;
      }
      void navigate({ to: "/channels", search: { action } });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!hasUnlockedOwnerVault()) return;
      if (event.defaultPrevented || event.repeat) return;
      if (
        event.key === "Escape" &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        if (hasActiveEscapeSurface()) return;
        if (pathname === "/settings") {
          event.preventDefault();
          void navigate({ to: "/channels" });
        }
        return;
      }
      const mac = isMacPlatform();
      const primary = hasPrimaryShortcutModifier(event);
      if (
        !mac &&
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        event.preventDefault();
        if (event.key === "ArrowLeft") window.history.back();
        else window.history.forward();
        return;
      }
      if (!primary || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "s" && !event.shiftKey) {
        event.preventDefault();
        sidebar.toggle();
      } else if (key === "[" && !event.shiftKey) {
        event.preventDefault();
        window.history.back();
      } else if (key === "]" && !event.shiftKey) {
        event.preventDefault();
        window.history.forward();
      } else if (key === "," && !event.shiftKey) {
        event.preventDefault();
        void navigate({ to: "/settings" });
      } else if (key === "a" && event.shiftKey) {
        event.preventDefault();
        void navigate({ to: "/" });
      } else if (key === "k") {
        event.preventDefault();
        openChannelAction(event.shiftKey ? "dm" : "search");
      } else if (key === "n" && event.shiftKey) {
        event.preventDefault();
        openChannelAction("create");
      } else if (key === "o" && event.shiftKey) {
        event.preventDefault();
        openChannelAction("browse");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, pathname, sidebar]);

  return (
    <PresenceSessionProvider
      key={ownerPubkey ?? "locked"}
      ownerPubkey={ownerPubkey}
    >
      <div className="flex min-h-dvh flex-col">
        <ChannelNotifier ownerPubkey={ownerPubkey} />
        <ReminderNotifier ownerPubkey={ownerPubkey} />
        <main className="flex flex-1 flex-col">
          <Suspense
            fallback={
              <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </PresenceSessionProvider>
  );
}
