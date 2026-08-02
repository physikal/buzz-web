import {
  Copy,
  EllipsisVertical,
  Link2,
  MailCheck,
  MailOpen,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  useEscapeSurface(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
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
        size="icon"
        variant="ghost"
      >
        <EllipsisVertical />
      </Button>
      {open ? (
        <div
          className="absolute right-0 bottom-9 z-30 w-44 rounded-md border bg-popover p-1 shadow-lg"
          role="menu"
        >
          <MenuAction
            icon={<Copy />}
            label="Copy message"
            onClick={() => void copy(message.content, "Message copied")}
          />
          <MenuAction icon={<Link2 />} label="Copy link" onClick={copyLink} />
          <MenuAction
            icon={unread ? <MailCheck /> : <MailOpen />}
            label={unread ? "Mark read" : "Mark unread"}
            onClick={() => {
              if (unread) onMarkRead();
              else onMarkUnread();
              setOpen(false);
            }}
          />
        </div>
      ) : null}
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
