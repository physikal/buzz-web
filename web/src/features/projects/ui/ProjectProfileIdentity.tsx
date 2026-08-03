import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";

import { listProfiles } from "@/features/channels/channel-api";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { isSafeHttpUrl } from "@/shared/lib/url";

function pubkeyHue(pubkey: string) {
  let hash = 0;
  for (const character of pubkey)
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

const ProjectProfileNavigationContext = createContext<
  ((pubkey: string) => void) | null
>(null);

export function ProjectProfileNavigationProvider({
  children,
  onOpenProfile,
}: {
  children: ReactNode;
  onOpenProfile: (pubkey: string) => void;
}) {
  return (
    <ProjectProfileNavigationContext.Provider value={onOpenProfile}>
      {children}
    </ProjectProfileNavigationContext.Provider>
  );
}

export function ProjectProfileIdentity({
  className = "",
  pubkey,
  role,
  showAvatar = true,
}: {
  className?: string;
  pubkey: string;
  role?: ReactNode;
  showAvatar?: boolean;
}) {
  const normalized = pubkey.toLowerCase();
  const profileQuery = useQuery({
    queryKey: ["project-profile", normalized],
    queryFn: () => listProfiles([normalized]),
    enabled: /^[0-9a-f]{64}$/u.test(normalized),
    staleTime: 60_000,
  });
  const profile = profileQuery.data?.find(
    (candidate) => candidate.pubkey === normalized,
  );
  const label = profile?.displayName?.trim() || truncatePubkey(normalized);
  const avatarUrl = isSafeHttpUrl(profile?.avatarUrl)
    ? profile.avatarUrl
    : null;
  const onOpenProfile = useContext(ProjectProfileNavigationContext);
  const content = (
    <>
      {showAvatar ? (
        avatarUrl ? (
          <img
            alt=""
            className="h-6 w-6 shrink-0 rounded-md object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
            src={avatarUrl}
          />
        ) : (
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[0.625rem] font-semibold text-white"
            style={{ backgroundColor: `hsl(${pubkeyHue(normalized)} 48% 42%)` }}
          >
            {normalized.slice(0, 2).toUpperCase()}
          </span>
        )
      ) : null}
      <span className="min-w-0 truncate text-xs font-medium">{label}</span>
      {role ? (
        <span className="shrink-0 text-xs text-muted-foreground">{role}</span>
      ) : null}
    </>
  );
  return onOpenProfile ? (
    <button
      aria-label={`Open ${label} profile`}
      className={`inline-flex min-w-0 items-center gap-2 rounded-sm text-left hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      onClick={() => onOpenProfile(normalized)}
      title={normalized}
      type="button"
    >
      {content}
    </button>
  ) : (
    <span
      className={`inline-flex min-w-0 items-center gap-2 ${className}`}
      title={normalized}
    >
      {content}
    </span>
  );
}
