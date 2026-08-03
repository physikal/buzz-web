import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { HuddleStartTarget } from "@/features/huddles/use-huddle";
import { truncatePubkey } from "@/shared/lib/pubkey";
import {
  type Channel,
  openDm,
  sendChannelMessage,
  type UserProfile,
} from "./channel-api";
import { buildWaveMessageContent } from "./wave-message";

export function useProfileMessaging({
  ownerPubkey,
  profiles,
  onOpenChannel,
  onCloseNewMessage,
  onCloseProfile,
  onStartHuddle,
}: {
  ownerPubkey: string;
  profiles: Map<string, UserProfile>;
  onOpenChannel: (channelId: string) => void;
  onCloseNewMessage: () => void;
  onCloseProfile: () => void;
  onStartHuddle: (
    agentPubkeys: string[],
    target: HuddleStartTarget,
  ) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const channelsKey = ["channels", ownerPubkey] as const;
  const refreshChannels = () =>
    queryClient.invalidateQueries({ queryKey: channelsKey });
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
  const huddleMutation = useMutation({
    mutationFn: async ({
      pubkey,
      agentPubkeys,
    }: {
      pubkey: string;
      agentPubkeys: string[];
    }) => {
      const channelId = await openDm([pubkey]);
      await refreshChannels();
      const channelName =
        queryClient
          .getQueryData<Channel[]>(channelsKey)
          ?.find((channel) => channel.id === channelId)?.name ??
        "Direct message";
      onOpenChannel(channelId);
      await onStartHuddle(agentPubkeys, { channelId, channelName });
      return channelId;
    },
    onSuccess: () => onCloseProfile(),
    onError: (error) =>
      toast.error("Could not start huddle", { description: error.message }),
  });
  const openProfileDm = (pubkey: string) => {
    dmMutation.mutate([pubkey]);
    onCloseProfile();
  };

  return { dmMutation, huddleMutation, openProfileDm, waveMutation };
}
