import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import {
  listPresence,
  listUserStatuses,
  subscribePresence,
  type PresenceStatus,
} from "./presence-api";

export function useWorkspacePresence(pubkeys: string[]) {
  const queryClient = useQueryClient();
  const key = [...new Set(pubkeys.map((value) => value.toLowerCase()))]
    .sort()
    .join(",");
  const normalized = useMemo(() => (key ? key.split(",") : []), [key]);
  const presenceKey = useMemo(() => ["presence", key] as const, [key]);
  const presenceQuery = useQuery({
    queryKey: presenceKey,
    queryFn: () => listPresence(normalized),
    enabled: normalized.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const statusQuery = useQuery({
    queryKey: ["user-statuses", key],
    queryFn: () => listUserStatuses(normalized),
    enabled: normalized.length > 0,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  useEffect(() => {
    return subscribePresence(normalized, (pubkey, status) => {
      queryClient.setQueryData<Map<string, PresenceStatus>>(
        presenceKey,
        (current) => new Map(current ?? []).set(pubkey, status),
      );
    });
  }, [normalized, presenceKey, queryClient]);

  return {
    presence: presenceQuery.data ?? new Map<string, PresenceStatus>(),
    userStatuses: statusQuery.data ?? new Map(),
  };
}
