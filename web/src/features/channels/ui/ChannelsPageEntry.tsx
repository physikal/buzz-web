import { useState } from "react";

import { OwnerConnection } from "@/features/agents/ui/OwnerConnection";
import { lockOwnerVault } from "@/features/owner-vault/lib/vault-worker-client";
import type { ChannelAction } from "../channel-actions";
import type {
  ProfilePanelTab,
  ProfilePanelView,
} from "@/features/profile/profile-panel-state";
import { ChannelsWorkspace } from "./ChannelsPage";

export function ChannelsPage({
  initialAction,
  initialChannelId,
  initialMessageId,
  initialProfilePubkey,
  initialProfileTab,
  initialProfileView,
  onProfileTabChange,
  onProfileViewChange,
}: {
  initialAction?: ChannelAction;
  initialChannelId?: string;
  initialMessageId?: string;
  initialProfilePubkey?: string;
  initialProfileTab?: ProfilePanelTab;
  initialProfileView?: ProfilePanelView;
  onProfileTabChange?: (tab: ProfilePanelTab) => void;
  onProfileViewChange?: (view: ProfilePanelView) => void;
} = {}) {
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(null);
  if (!ownerPubkey) return <OwnerConnection onConnected={setOwnerPubkey} />;
  return (
    <ChannelsWorkspace
      initialAction={initialAction}
      initialChannelId={initialChannelId}
      initialMessageId={initialMessageId}
      initialProfilePubkey={initialProfilePubkey}
      initialProfileTab={initialProfileTab}
      initialProfileView={initialProfileView}
      onProfileTabChange={onProfileTabChange}
      onProfileViewChange={onProfileViewChange}
      ownerPubkey={ownerPubkey}
      onDisconnect={() => {
        void lockOwnerVault();
        setOwnerPubkey(null);
      }}
    />
  );
}
