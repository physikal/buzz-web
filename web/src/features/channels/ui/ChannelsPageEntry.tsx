import { useState } from "react";

import { OwnerConnection } from "@/features/agents/ui/OwnerConnection";
import { lockOwnerVault } from "@/features/owner-vault/lib/vault-worker-client";
import type { ChannelAction } from "../channel-actions";
import { ChannelsWorkspace } from "./ChannelsPage";

export function ChannelsPage({
  initialAction,
  initialChannelId,
  initialMessageId,
}: {
  initialAction?: ChannelAction;
  initialChannelId?: string;
  initialMessageId?: string;
} = {}) {
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(null);
  if (!ownerPubkey) return <OwnerConnection onConnected={setOwnerPubkey} />;
  return (
    <ChannelsWorkspace
      initialAction={initialAction}
      initialChannelId={initialChannelId}
      initialMessageId={initialMessageId}
      ownerPubkey={ownerPubkey}
      onDisconnect={() => {
        void lockOwnerVault();
        setOwnerPubkey(null);
      }}
    />
  );
}
