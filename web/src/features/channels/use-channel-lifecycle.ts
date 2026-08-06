import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";

import {
  type Channel,
  type ChannelLifecycleAction,
  mutateChannelLifecycle,
} from "@/features/channels/channel-api";

export function useChannelLifecycle({
  onRemoveSelected,
  ownerPubkey,
  selectedChannelId,
}: {
  onRemoveSelected: () => void;
  ownerPubkey: string;
  selectedChannelId: string | null;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: mutateChannelLifecycle,
    onMutate: async (input) => {
      if (input.action !== "hide") return undefined;
      const queryKey = ["channels", ownerPubkey] as const;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Channel[]>(queryKey);
      queryClient.setQueryData<Channel[]>(queryKey, (channels = []) =>
        channels.filter((channel) => channel.id !== input.channelId),
      );
      return { previous, queryKey };
    },
    onSuccess: async (_, input) => {
      if (selectedChannelId === input.channelId) onRemoveSelected();
      await queryClient.invalidateQueries({
        queryKey: ["channels", ownerPubkey],
      });
    },
    onError: (error: Error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
      toast.error("Could not update channel membership", {
        description: error.message,
      });
    },
  });
  const mutateLifecycle = useCallback(
    (input: { action: ChannelLifecycleAction; channelId: string }) =>
      mutation.mutateAsync(input).then(() => undefined),
    [mutation],
  );
  const mutateSelected = useCallback(
    (action: Exclude<ChannelLifecycleAction, "hide">) =>
      selectedChannelId
        ? mutateLifecycle({ action, channelId: selectedChannelId })
        : Promise.resolve(),
    [mutateLifecycle, selectedChannelId],
  );

  return {
    archiveSelected: () => void mutateSelected("archive"),
    deleteSelected: () => mutateSelected("delete"),
    leaveSelected: () => mutateSelected("leave"),
    mutateLifecycle,
    pending: mutation.isPending,
  };
}
