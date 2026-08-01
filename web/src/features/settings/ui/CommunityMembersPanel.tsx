import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, MoreHorizontal, Search, Shield, Ticket } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  changeCommunityMemberRole,
  getCommunityMembership,
  removeCommunityMember,
  type CommunityMember,
} from "../community-api";
import { CommunityInviteDialog } from "./CommunityInviteDialog";

export const communityMembershipKey = ["community-membership"] as const;

export function CommunityMembersPanel({
  ownerPubkey,
}: {
  ownerPubkey: string;
}) {
  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const queryClient = useQueryClient();
  const membershipQuery = useQuery({
    queryKey: [...communityMembershipKey, ownerPubkey],
    queryFn: () => getCommunityMembership(ownerPubkey),
    staleTime: 30_000,
  });
  const membership = membershipQuery.data;
  const members = membership?.members ?? [];
  const currentRole = membership?.currentRole;
  const canManage = currentRole === "owner" || currentRole === "admin";
  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return members;
    return members.filter((member) =>
      [member.pubkey, member.role, member.profile?.displayName ?? ""].some(
        (value) => value.toLowerCase().includes(query),
      ),
    );
  }, [members, search]);
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: [...communityMembershipKey, ownerPubkey],
    });

  return (
    <section>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Invites</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage members and community access.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setInviteOpen(true)}>
            <Ticket />
            Invite to community
          </Button>
        ) : null}
      </header>

      {membershipQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">
          Checking invite permissions…
        </p>
      ) : membershipQuery.error instanceof Error ? (
        <Notice tone="error">{membershipQuery.error.message}</Notice>
      ) : !canManage ? (
        <Notice>
          Member management is available to community owners and admins.
        </Notice>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <div className="border-b p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">
                Members{" "}
                <span className="text-muted-foreground">{members.length}</span>
              </p>
            </div>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search members"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          <div className="max-h-[32rem] divide-y overflow-y-auto">
            {filteredMembers.map((member) => (
              <MemberRow
                currentPubkey={ownerPubkey}
                currentRole={currentRole}
                key={member.pubkey}
                member={member}
                onChanged={refresh}
              />
            ))}
            {!filteredMembers.length ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {members.length
                  ? "No members match your search."
                  : "No members yet."}
              </p>
            ) : null}
          </div>
        </div>
      )}

      <CommunityInviteDialog
        isOwner={membership?.currentRole === "owner"}
        onChanged={refresh}
        onClose={() => setInviteOpen(false)}
        open={inviteOpen}
      />
    </section>
  );
}

function MemberRow({
  currentPubkey,
  currentRole,
  member,
  onChanged,
}: {
  currentPubkey: string;
  currentRole: "owner" | "admin";
  member: CommunityMember;
  onChanged: () => Promise<unknown>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: async (action: "promote" | "demote" | "remove") => {
      if (action === "remove") return removeCommunityMember(member.pubkey);
      return changeCommunityMemberRole(
        member.pubkey,
        action === "promote" ? "admin" : "member",
      );
    },
    onSuccess: async (_, action) => {
      setMenuOpen(false);
      await onChanged();
      toast.success(
        action === "remove"
          ? "Member removed"
          : action === "promote"
            ? "Made community admin"
            : "Made community member",
      );
    },
    onError: (error) =>
      toast.error("Could not update member", { description: error.message }),
  });
  const isSelf = member.pubkey === currentPubkey.toLowerCase();
  const canPromote = currentRole === "owner" && member.role === "member";
  const canDemote = currentRole === "owner" && member.role === "admin";
  const canRemove =
    !isSelf &&
    member.role !== "owner" &&
    (currentRole === "owner" || member.role === "member");
  const hasActions = canPromote || canDemote || canRemove;
  const displayName =
    member.profile?.displayName?.trim() ||
    (member.role === "owner" ? "Community owner" : "Unnamed member");

  return (
    <div className="relative flex min-h-16 items-center gap-3 px-4 py-3">
      {member.profile?.avatarUrl ? (
        <img
          alt=""
          className="h-9 w-9 rounded-md object-cover"
          src={member.profile.avatarUrl}
        />
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-xs font-semibold">
          {displayName[0]?.toUpperCase() ?? "?"}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{displayName}</span>
          {member.role === "owner" ? (
            <Crown className="h-4 w-4 text-amber-500" />
          ) : null}
          {member.role === "admin" ? (
            <Shield className="h-4 w-4 text-blue-500" />
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="capitalize">{member.role}</span> ·{" "}
          {truncatePubkey(member.pubkey)}
          {isSelf ? " · You" : ""}
        </p>
      </div>
      {hasActions ? (
        <div>
          <Button
            aria-expanded={menuOpen}
            aria-label={`Actions for ${displayName}`}
            disabled={mutation.isPending}
            onClick={() => setMenuOpen((open) => !open)}
            size="icon"
            variant="ghost"
          >
            <MoreHorizontal />
          </Button>
          {menuOpen ? (
            <div className="absolute right-4 top-12 z-10 min-w-44 rounded-md border bg-popover p-1 text-sm shadow-lg">
              {canPromote ? (
                <MenuAction
                  label="Make admin"
                  onClick={() => mutation.mutate("promote")}
                />
              ) : null}
              {canDemote ? (
                <MenuAction
                  label="Make member"
                  onClick={() => mutation.mutate("demote")}
                />
              ) : null}
              {canRemove ? (
                <MenuAction
                  destructive
                  label="Remove from community"
                  onClick={() => mutation.mutate("remove")}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MenuAction({
  label,
  destructive,
  onClick,
}: {
  label: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`block w-full rounded-sm px-3 py-2 text-left hover:bg-accent ${destructive ? "text-destructive" : ""}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function Notice({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <p
      className={`rounded-md border p-4 text-sm ${tone === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" : "text-muted-foreground"}`}
    >
      {children}
    </p>
  );
}
