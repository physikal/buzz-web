import {
  Bell,
  BellOff,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Copy,
  FolderInput,
  Plus,
  Settings,
  Star,
  StarOff,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import type { Channel } from "../channel-api";
import type { ChannelSection } from "../use-channel-sections";

type MenuPage = "root" | "copy" | "move";

export type ChannelContextTarget = {
  channel: Channel;
  x: number;
  y: number;
};

export function ChannelContextMenu({
  assignedSectionId,
  muted,
  onAssignSection,
  onClose,
  onCreateSection,
  onMutedChange,
  onOpenSettings,
  onReadChange,
  onStarredChange,
  sections,
  starred,
  target,
  unread,
}: {
  assignedSectionId?: string;
  muted: boolean;
  onAssignSection?: (sectionId: string | null) => void;
  onClose: () => void;
  onCreateSection?: () => void;
  onMutedChange: (muted: boolean) => void;
  onOpenSettings?: () => void;
  onReadChange: () => void;
  onStarredChange?: (starred: boolean) => void;
  sections: ChannelSection[];
  starred: boolean;
  target: ChannelContextTarget | null;
  unread: number;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<MenuPage>("root");
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useEscapeSurface(Boolean(target), onClose);

  useEffect(() => {
    if (!target) return;
    setPage("root");
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      ) {
        onClose();
      }
    };
    window.addEventListener("pointerdown", closeOutside, true);
    return () => window.removeEventListener("pointerdown", closeOutside, true);
  }, [onClose, target]);

  // The menu page changes its dimensions and first focus target.
  // biome-ignore lint/correctness/useExhaustiveDependencies: page intentionally retriggers measurement and focus
  useLayoutEffect(() => {
    if (!target) return;
    const frame = window.requestAnimationFrame(() => {
      const menu = menuRef.current;
      if (!menu) return;
      const margin = 8;
      setPosition({
        left: Math.max(
          margin,
          Math.min(target.x, window.innerWidth - menu.offsetWidth - margin),
        ),
        top: Math.max(
          margin,
          Math.min(target.y, window.innerHeight - menu.offsetHeight - margin),
        ),
      });
      menu.querySelector<HTMLButtonElement>('button[role="menuitem"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [page, target]);

  if (!target) return null;

  const run = (action: () => void) => {
    onClose();
    action();
  };
  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };
  const canMove = Boolean(onAssignSection && onCreateSection);

  return createPortal(
    <div
      aria-label={`Channel actions for ${target.channel.name}`}
      className="fixed z-[70] max-h-[calc(100dvh-1rem)] w-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
      data-testid="channel-context-menu"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" && page !== "root") {
          event.preventDefault();
          setPage("root");
          return;
        }
        handleMenuKeyDown(event);
      }}
      ref={menuRef}
      role="menu"
      style={position}
    >
      {page === "copy" ? (
        <>
          <MenuBack label="Copy" onClick={() => setPage("root")} />
          <MenuItem
            label="Copy channel name"
            onClick={() =>
              run(() => {
                void copyValue(target.channel.name, "Channel name");
              })
            }
          />
          <MenuItem
            label="Copy channel ID"
            onClick={() =>
              run(() => {
                void copyValue(target.channel.id, "Channel ID");
              })
            }
          />
        </>
      ) : page === "move" ? (
        <>
          <MenuBack label="Move to section" onClick={() => setPage("root")} />
          <MenuItem
            active={!assignedSectionId}
            label="Channels"
            onClick={() => run(() => onAssignSection?.(null))}
          />
          {sections.map((section) => (
            <MenuItem
              active={assignedSectionId === section.id}
              icon={section.icon ? <span>{section.icon}</span> : undefined}
              key={section.id}
              label={section.name}
              onClick={() => run(() => onAssignSection?.(section.id))}
            />
          ))}
          <MenuSeparator />
          <MenuItem
            icon={<Plus />}
            label="New section..."
            onClick={() => run(() => onCreateSection?.())}
          />
        </>
      ) : (
        <>
          <MenuItem
            endIcon={<ChevronRight />}
            icon={<Copy />}
            label="Copy"
            onClick={() => setPage("copy")}
          />
          {canMove ? (
            <MenuItem
              endIcon={<ChevronRight />}
              icon={<FolderInput />}
              label="Move to section"
              onClick={() => setPage("move")}
            />
          ) : null}
          <MenuSeparator />
          <MenuItem
            icon={unread ? <CheckCircle2 /> : <CircleDot />}
            label={unread ? "Mark as read" : "Mark unread"}
            onClick={() => run(onReadChange)}
          />
          <MenuItem
            icon={muted ? <Bell /> : <BellOff />}
            label={muted ? "Unmute channel" : "Mute channel"}
            onClick={() => run(() => onMutedChange(!muted))}
          />
          {onStarredChange ? (
            <MenuItem
              icon={starred ? <StarOff /> : <Star />}
              label={starred ? "Unstar channel" : "Star channel"}
              onClick={() => run(() => onStarredChange(!starred))}
            />
          ) : null}
          {onOpenSettings ? (
            <>
              <MenuSeparator />
              <MenuItem
                icon={<Settings />}
                label="Channel settings"
                onClick={() => run(onOpenSettings)}
              />
            </>
          ) : null}
        </>
      )}
    </div>,
    document.body,
  );
}

function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      'button[role="menuitem"]:not(:disabled)',
    ),
  );
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next: number | null = null;
  if (event.key === "ArrowDown") next = (current + 1) % buttons.length;
  if (event.key === "ArrowUp")
    next = (current - 1 + buttons.length) % buttons.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = buttons.length - 1;
  if (next === null || !buttons[next]) return;
  event.preventDefault();
  buttons[next].focus();
}

function MenuBack({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="mb-1 flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-sm font-medium hover:bg-accent focus-visible:bg-accent focus-visible:outline-hidden"
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <ChevronLeft className="h-4 w-4" />
      {label}
    </button>
  );
}

function MenuItem({
  active = false,
  endIcon,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  endIcon?: ReactNode;
  icon?: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "true" : undefined}
      className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-hidden"
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : endIcon}
    </button>
  );
}

function MenuSeparator() {
  return <hr className="my-1 h-px border-0 bg-border" />;
}
