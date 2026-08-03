import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { truncatePubkey } from "@/shared/lib/pubkey";
import { openDm, sendChannelMessage, type UserProfile } from "./channel-api";
import { buildWaveMessageContent } from "./wave-message";

export function useProfileMessaging({
  ownerPubkey,
  profiles,
  onOpenChannel,
  onCloseNewMessage,
  onCloseProfile,
}: {
  ownerPubkey: string;
  profiles: Map<string, UserProfile>;
  onOpenChannel: (channelId: string) => void;
  onCloseNewMessage: () => void;
  onCloseProfile: () => void;
}) {
  const queryClient = useQueryClient();
  const refreshChannels = () =>
    queryClient.invalidateQueries({ queryKey: ["channels", ownerPubkey] });
  const dmMutation = useMutation({
    mutationFn: openDm,
    onSuccess: async (channelId) => {
      await refreshChannels();
      onOpenChannel(channelId);
      onCloseNewMessage();
    },
    onError: (error) =>
      toast.error("Could not open direct message", {
        description: error.message,
      }),
  });
  const waveMutation = useMutation({
    mutationFn: async (pubkey: string) => {
      const channelId = await openDm([pubkey]);
      const senderName =
        profiles.get(ownerPubkey)?.displayName?.trim() ||
        truncatePubkey(ownerPubkey);
      await sendChannelMessage({
        channelId,
        content: buildWaveMessageContent(senderName),
      });
      return channelId;
    },
    onSuccess: async (channelId) => {
      await Promise.all([
        refreshChannels(),
        queryClient.invalidateQueries({
          queryKey: ["channel-messages", channelId],
        }),
      ]);
      onOpenChannel(channelId);
      onCloseProfile();
    },
    onError: (error) =>
      toast.error("Could not send wave", { description: error.message }),
  });

  return { dmMutation, waveMutation };
}
