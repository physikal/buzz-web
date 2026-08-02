import {
  Copy,
  EllipsisVertical,
  Link2,
  MailCheck,
  MailOpen,
} from "lucide-react";
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import { Button } from "@/shared/ui/button";
import type { ChannelMessage } from "../channel-api";

export function MessageMoreActions({
  channelId,
  message,
  unread,
  onMarkRead,
  onMarkUnread,
}: {
  channelId: string;
  message: ChannelMessage;
  unread: boolean;
  onMarkRead: () => void;
  onMarkUnread: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>();
  useEscapeSurface(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !menu.current?.contains(target))
        setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const placeMenu = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const menuHeight = menu.current?.offsetHeight ?? 0;
      if (!anchor || !menuHeight) return;
      const gap = 4;
      const margin = 8;
      const width = menu.current?.offsetWidth ?? 176;
      const fitsBelow =
        anchor.bottom + gap + menuHeight <= window.innerHeight - margin;
      setPosition({
        left: Math.min(
          Math.max(margin, anchor.right - width),
          window.innerWidth - width - margin,
        ),
        top: fitsBelow
          ? anchor.bottom + gap
          : Math.max(margin, anchor.top - gap - menuHeight),
      });
    };
    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [open]);

  const copy = async (value: string, messageText: string) => {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(value);
      toast.success(messageText);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };
  const copyLink = () => {
    const url = new URL("/channels", window.location.origin);
    url.searchParams.set("channel", channelId);
    url.searchParams.set("message", message.id);
    void copy(url.toString(), "Link copied");
  };

  return (
    <div className="relative" ref={root}>
      <Button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More actions"
        onClick={() => setOpen((current) => !current)}
        ref={trigger}
        size="icon"
        variant="ghost"
      >
        <EllipsisVertical />
      </Button>
      {open
        ? createPortal(
            <div
              className="fixed z-50 w-44 rounded-md border bg-popover p-1 shadow-lg"
              ref={menu}
              role="menu"
              style={{
                ...position,
                visibility: position ? "visible" : "hidden",
              }}
            >
              <MenuAction
                icon={<Copy />}
                label="Copy message"
                onClick={() => void copy(message.content, "Message copied")}
              />
              <MenuAction
                icon={<Link2 />}
                label="Copy link"
                onClick={copyLink}
              />
              <MenuAction
                icon={unread ? <MailCheck /> : <MailOpen />}
                label={unread ? "Mark read" : "Mark unread"}
                onClick={() => {
                  if (unread) onMarkRead();
                  else onMarkUnread();
                  setOpen(false);
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function MenuAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex h-9 w-full items-center gap-2 rounded px-2 text-sm hover:bg-accent"
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      {label}
    </button>
  );
}
