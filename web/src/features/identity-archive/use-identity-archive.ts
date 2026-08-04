import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import {
  archiveIdentity,
  listArchivedIdentities,
  unarchiveIdentity,
} from "./identity-archive-api";

export const archivedIdentitiesQueryKey = ["archived-identities"] as const;

export function useArchivedIdentities(enabled = true) {
  return useQuery({
    enabled,
    queryKey: archivedIdentitiesQueryKey,
    queryFn: listArchivedIdentities,
    refetchInterval: 30_000,
    staleTime: 30_000,
  });
}

export function archivedIdentityPredicate(
  archivedPubkeys: string[],
  ownerPubkey: string,
) {
  const self = ownerPubkey.toLowerCase();
  const archived = new Set(
    archivedPubkeys.map((pubkey) => pubkey.toLowerCase()),
  );
  return (pubkey: string) => {
    const normalized = pubkey.toLowerCase();
    return normalized !== self && archived.has(normalized);
  };
}

export function useArchivedIdentityPredicate(ownerPubkey: string) {
  const query = useArchivedIdentities(Boolean(ownerPubkey));
  return useMemo(
    () => archivedIdentityPredicate(query.data?.archived ?? [], ownerPubkey),
    [ownerPubkey, query.data],
  );
}

export type IdentityArchiveActions = {
  canArchive: boolean;
  isArchived: boolean | undefined;
  isPending: boolean;
  archive: () => void;
  unarchive: () => void;
};

export function useIdentityArchive(
  targetPubkey: string | null,
  ownerPubkey: string,
): IdentityArchiveActions {
  const queryClient = useQueryClient();
  const query = useArchivedIdentities(Boolean(targetPubkey && ownerPubkey));
  const normalized = targetPubkey?.trim().toLowerCase() ?? "";
  const canArchive = /^[0-9a-f]{64}$/.test(normalized);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: archivedIdentitiesQueryKey });
  const archiveMutation = useMutation({
    mutationFn: archiveIdentity,
    onSuccess: async () => {
      await refresh();
      toast.success("Archived on this relay");
    },
    onError: (error) =>
      toast.error("Archive failed", { description: error.message }),
  });
  const unarchiveMutation = useMutation({
    mutationFn: unarchiveIdentity,
    onSuccess: async () => {
      await refresh();
      toast.success("Unarchived on this relay");
    },
    onError: (error) =>
      toast.error("Unarchive failed", { description: error.message }),
  });
  const archive = useCallback(() => {
    if (canArchive) archiveMutation.mutate(normalized);
  }, [archiveMutation, canArchive, normalized]);
  const unarchive = useCallback(() => {
    if (canArchive) unarchiveMutation.mutate(normalized);
  }, [canArchive, normalized, unarchiveMutation]);
  return {
    canArchive,
    isArchived: query.data
      ? query.data.archived.includes(normalized)
      : undefined,
    isPending: archiveMutation.isPending || unarchiveMutation.isPending,
    archive,
    unarchive,
  };
}
