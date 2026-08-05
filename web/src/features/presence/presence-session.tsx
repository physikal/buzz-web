import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { sendPresence } from "./presence-api";
import type { PresenceStatus } from "./presence-api";

const HEARTBEAT_MS = 60_000;
const IDLE_MS = 10 * 60_000;
const ACTIVITY_THROTTLE_MS = 1_000;
const STORAGE_PREFIX = "buzz-web:presence-preference.v1";

type PresencePreference = "auto" | "away" | "offline";

type PresenceSession = {
  currentStatus: PresenceStatus;
  isPending: boolean;
  setStatus: (status: PresenceStatus) => Promise<void>;
};

const PresenceSessionContext = createContext<PresenceSession>({
  currentStatus: "offline",
  isPending: false,
  setStatus: async () => {},
});

function storageKey(pubkey: string) {
  return `${STORAGE_PREFIX}:${pubkey}`;
}

function readPreference(pubkey: string): PresencePreference {
  if (!pubkey) return "auto";
  const value = window.localStorage.getItem(storageKey(pubkey));
  return value === "away" || value === "offline" ? value : "auto";
}

function writePreference(pubkey: string, value: PresencePreference) {
  if (!pubkey) return;
  window.localStorage.setItem(storageKey(pubkey), value);
}

export function PresenceSessionProvider({
  children,
  ownerPubkey,
}: {
  children: React.ReactNode;
  ownerPubkey: string | null;
}) {
  const normalizedPubkey = ownerPubkey?.trim().toLowerCase() ?? "";
  const [automaticStatus, setAutomaticStatus] =
    useState<PresenceStatus>("online");
  const [preference, setPreference] = useState<PresencePreference>(() =>
    readPreference(normalizedPubkey),
  );
  const [isPending, setIsPending] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const lastPublishedRef = useRef<PresenceStatus | null>(null);

  useEffect(() => {
    setPreference(readPreference(normalizedPubkey));
    setAutomaticStatus("online");
    lastActivityRef.current = Date.now();
    lastPublishedRef.current = null;
  }, [normalizedPubkey]);

  const currentStatus =
    !normalizedPubkey || preference === "offline"
      ? "offline"
      : preference === "away"
        ? "away"
        : automaticStatus;
  const statusRef = useRef<PresenceStatus>(currentStatus);
  statusRef.current = currentStatus;

  const publish = useCallback(
    async (status: PresenceStatus) => {
      if (!normalizedPubkey) return;
      lastPublishedRef.current = status;
      await sendPresence(status);
    },
    [normalizedPubkey],
  );

  useEffect(() => {
    if (!normalizedPubkey || lastPublishedRef.current === currentStatus) return;
    void publish(currentStatus).catch(() => {
      lastPublishedRef.current = null;
    });
  }, [currentStatus, normalizedPubkey, publish]);

  useEffect(() => {
    if (!normalizedPubkey) return;
    let lastRecordedAt = 0;
    const recordActivity = () => {
      const now = Date.now();
      if (now - lastRecordedAt < ACTIVITY_THROTTLE_MS) return;
      lastRecordedAt = now;
      lastActivityRef.current = now;
      setAutomaticStatus("online");
    };
    const reevaluate = () => {
      setAutomaticStatus(
        Date.now() - lastActivityRef.current >= IDLE_MS ? "away" : "online",
      );
    };
    const handleExit = () => void publish("offline").catch(() => {});

    const heartbeat = window.setInterval(() => {
      if (statusRef.current === "offline") return;
      void publish(statusRef.current).catch(() => {});
    }, HEARTBEAT_MS);
    const idleTick = window.setInterval(reevaluate, 30_000);
    window.addEventListener("pointerdown", recordActivity, true);
    window.addEventListener("pointermove", recordActivity, true);
    window.addEventListener("wheel", recordActivity, {
      capture: true,
      passive: true,
    });
    window.addEventListener("keydown", recordActivity, true);
    window.addEventListener("focus", recordActivity);
    window.addEventListener("pagehide", handleExit);
    return () => {
      window.clearInterval(heartbeat);
      window.clearInterval(idleTick);
      window.removeEventListener("pointerdown", recordActivity, true);
      window.removeEventListener("pointermove", recordActivity, true);
      window.removeEventListener("wheel", recordActivity, true);
      window.removeEventListener("keydown", recordActivity, true);
      window.removeEventListener("focus", recordActivity);
      window.removeEventListener("pagehide", handleExit);
    };
  }, [normalizedPubkey, publish]);

  const setStatus = useCallback(
    async (status: PresenceStatus) => {
      if (!normalizedPubkey) return;
      const previous = preference;
      const next: PresencePreference = status === "online" ? "auto" : status;
      if (status === "online") {
        lastActivityRef.current = Date.now();
        setAutomaticStatus("online");
      }
      setPreference(next);
      writePreference(normalizedPubkey, next);
      setIsPending(true);
      try {
        await publish(status);
      } catch (error) {
        setPreference(previous);
        writePreference(normalizedPubkey, previous);
        lastPublishedRef.current = null;
        throw error;
      } finally {
        setIsPending(false);
      }
    },
    [normalizedPubkey, preference, publish],
  );

  const value = useMemo(
    () => ({ currentStatus, isPending, setStatus }),
    [currentStatus, isPending, setStatus],
  );
  return (
    <PresenceSessionContext.Provider value={value}>
      {children}
    </PresenceSessionContext.Provider>
  );
}

export function usePresenceSession() {
  return useContext(PresenceSessionContext);
}
