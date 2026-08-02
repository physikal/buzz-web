import { Hash, LayoutList, MessageCircle } from "lucide-react";

import type { Channel } from "../channel-api";

export function ChannelIcon({ type }: { type?: Channel["channelType"] }) {
  if (type === "forum") return <LayoutList className="h-4 w-4" />;
  if (type === "dm") return <MessageCircle className="h-4 w-4" />;
  return <Hash className="h-4 w-4" />;
}
