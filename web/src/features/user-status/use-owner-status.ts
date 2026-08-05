import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { getCustomEmoji } from "@/features/settings/custom-emoji-api";
import {
  getUserStatus,
  setUserStatus,
  type UserStatus,
} from "@/features/settings/settings-api";

export function useOwnerStatus(ownerPubkey: string) {
  const queryClient = useQueryClient();
  const [localStatus, setLocalStatus] = useState<UserStatus | null | undefined>(
    undefined,
  );
  const statusQuery = useQuery({
    queryKey: ["user-status", ownerPubkey],
    queryFn: () => getUserStatus(ownerPubkey),
  });
  const customEmojiQuery = useQuery({
    queryKey: ["custom-emoji", ownerPubkey],
    queryFn: () => getCustomEmoji(ownerPubkey),
  });

  useEffect(() => setLocalStatus(statusQuery.data ?? null), [statusQuery.data]);

  const mutation = useMutation({
    mutationFn: ({ text, emoji }: { text: string; emoji: string }) =>
      setUserStatus(text, emoji),
    onSuccess: async (_, input) => {
      const nextStatus =
        input.text || input.emoji
          ? {
              text: input.text,
              emoji: input.emoji,
              updatedAt: Math.floor(Date.now() / 1_000),
            }
          : null;
      setLocalStatus(nextStatus);
      queryClient.setQueryData(["user-status", ownerPubkey], nextStatus);
      await queryClient.invalidateQueries({ queryKey: ["user-statuses"] });
      toast.success(nextStatus ? "Status updated" : "Status cleared");
    },
    onError: (error) =>
      toast.error("Could not update status", { description: error.message }),
  });

  return {
    customEmoji: customEmojiQuery.data?.community ?? [],
    isLoading: statusQuery.isLoading,
    isPending: mutation.isPending,
    setStatus: (text: string, emoji: string) =>
      mutation.mutateAsync({ text, emoji }),
    status:
      localStatus === undefined ? (statusQuery.data ?? null) : localStatus,
  };
}
