import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  listPresence,
  listUserStatuses,
  sendPresence,
  subscribePresence,
  type PresenceStatus,
} from "./presence-api";

const HEARTBEAT_MS = 60_000;
const IDLE_MS = 10 * 60_000;

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

  usePresencePublisher();

  return {
    presence: presenceQuery.data ?? new Map<string, PresenceStatus>(),
    userStatuses: statusQuery.data ?? new Map(),
  };
}

function usePresencePublisher() {
  const [automaticStatus, setAutomaticStatus] =
    useState<PresenceStatus>("online");
  const lastActivityRef = useRef(Date.now());
  const publishedRef = useRef<PresenceStatus | null>(null);
  const statusRef = useRef<PresenceStatus>(automaticStatus);

  useEffect(() => {
    statusRef.current = automaticStatus;
    if (publishedRef.current !== automaticStatus) {
      publishedRef.current = automaticStatus;
      void sendPresence(automaticStatus).catch(() => {});
    }
  }, [automaticStatus]);

  useEffect(() => {
    const publish = (status: PresenceStatus) => {
      publishedRef.current = status;
      void sendPresence(status).catch(() => {});
    };
    const publishCurrent = () => publish(statusRef.current);
    const recordActivity = () => {
      lastActivityRef.current = Date.now();
      setAutomaticStatus("online");
    };
    const reevaluate = () => {
      setAutomaticStatus(
        Date.now() - lastActivityRef.current >= IDLE_MS ? "away" : "online",
      );
    };
    const handleVisibility = () => {
      if (!document.hidden) recordActivity();
    };
    const handleExit = () => publish("offline");

    publishCurrent();
    const heartbeat = window.setInterval(publishCurrent, HEARTBEAT_MS);
    const idleTick = window.setInterval(reevaluate, 30_000);
    window.addEventListener("keydown", recordActivity, { capture: true });
    window.addEventListener("pointerdown", recordActivity, { capture: true });
    window.addEventListener("focus", recordActivity);
    window.addEventListener("pagehide", handleExit);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(heartbeat);
      window.clearInterval(idleTick);
      window.removeEventListener("keydown", recordActivity, { capture: true });
      window.removeEventListener("pointerdown", recordActivity, {
        capture: true,
      });
      window.removeEventListener("focus", recordActivity);
      window.removeEventListener("pagehide", handleExit);
      document.removeEventListener("visibilitychange", handleVisibility);
      publish("offline");
    };
  }, []);
}
