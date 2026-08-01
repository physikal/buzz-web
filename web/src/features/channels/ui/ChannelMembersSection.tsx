import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Shield, Trash2, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { parsePubkey, truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  addChannelMember,
  changeChannelMemberRole,
  type Channel,
  type ChannelMember,
  listChannelMembers,
  listProfiles,
  removeChannelMember,
} from "../channel-api";

export function ChannelMembersSection({
  channel,
  ownerPubkey,
}: {
  channel: Channel;
  ownerPubkey: string;
}) {
  const queryClient = useQueryClient();
  const [pubkeyInput, setPubkeyInput] = useState("");
  const [role, setRole] =
    useState<Exclude<ChannelMember["role"], "owner">>("member");
  const key = ["channel-members", channel.id] as const;
  const membersQuery = useQuery({
    queryKey: key,
    queryFn: () => listChannelMembers(channel.id),
    enabled: channel.isMember,
  });
  const members = membersQuery.data ?? [];
  const profilesQuery = useQuery({
    queryKey: ["profiles", ...members.map((member) => member.pubkey).sort()],
    queryFn: () => listProfiles(members.map((member) => member.pubkey)),
    enabled: members.length > 0,
    staleTime: 60_000,
  });
  const profileNames = useMemo(
    () =>
      new Map(
        (profilesQuery.data ?? []).map((profile) => [
          profile.pubkey,
          profile.displayName,
        ]),
      ),
    [profilesQuery.data],
  );
  const currentRole = members.find(
    (member) => member.pubkey === ownerPubkey.toLowerCase(),
  )?.role;
  const canManage = currentRole === "owner" || currentRole === "admin";
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const mutation = useMutation({
    mutationFn: async (input: {
      action: "add" | "remove" | "role";
      pubkey: string;
      role?: Exclude<ChannelMember["role"], "owner">;
    }) => {
      if (input.action === "remove")
        return removeChannelMember(channel.id, input.pubkey);
      if (input.action === "role")
        return changeChannelMemberRole(
          channel.id,
          input.pubkey,
          input.role ?? "member",
        );
      return addChannelMember(channel.id, input.pubkey, input.role ?? "member");
    },
    onSuccess: async (_, input) => {
      await refresh();
      if (input.action === "add") setPubkeyInput("");
      toast.success(
        input.action === "remove"
          ? "Channel member removed"
          : input.action === "role"
            ? "Channel role updated"
            : "Channel member added",
      );
    },
    onError: (error) =>
      toast.error("Could not update channel members", {
        description: error.message,
      }),
  });
  const parsedInput = parsePubkey(pubkeyInput);

  return (
    <section className="mt-6 border-t pt-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">
          Members{" "}
          <span className="font-normal text-muted-foreground">
            {members.length}
          </span>
        </h3>
      </div>
      {canManage ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (parsedInput)
              mutation.mutate({ action: "add", pubkey: parsedInput, role });
          }}
        >
          <Input
            aria-label="New channel member"
            placeholder="Paste an npub or public key"
            value={pubkeyInput}
            onChange={(event) => setPubkeyInput(event.target.value)}
          />
          <select
            aria-label="New member role"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={role}
            onChange={(event) =>
              setRole(
                event.target.value as Exclude<ChannelMember["role"], "owner">,
              )
            }
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="guest">Guest</option>
            <option value="bot">Bot</option>
          </select>
          <Button
            aria-label="Add channel member"
            disabled={!parsedInput || mutation.isPending}
            size="icon"
            type="submit"
          >
            <UserPlus />
          </Button>
        </form>
      ) : null}
      <div className="mt-3 max-h-64 divide-y overflow-y-auto rounded-md border">
        {membersQuery.isLoading ? (
          <p className="p-3 text-sm text-muted-foreground">Loading members…</p>
        ) : members.length ? (
          members.map((member) => {
            const isSelf = member.pubkey === ownerPubkey.toLowerCase();
            const manageable =
              canManage &&
              !isSelf &&
              member.role !== "owner" &&
              (currentRole === "owner" || member.role !== "admin");
            return (
              <div
                className="flex min-h-12 items-center gap-2 px-3 py-2"
                key={member.pubkey}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {profileNames.get(member.pubkey) ||
                      truncatePubkey(member.pubkey)}
                    {isSelf ? " (you)" : ""}
                  </p>
                  <p className="flex items-center gap-1 text-xs capitalize text-muted-foreground">
                    {member.role === "owner" ? (
                      <Crown className="h-3 w-3" />
                    ) : null}
                    {member.role === "admin" ? (
                      <Shield className="h-3 w-3" />
                    ) : null}
                    {member.role}
                  </p>
                </div>
                {manageable ? (
                  <>
                    <select
                      aria-label={`Role for ${truncatePubkey(member.pubkey)}`}
                      className="h-8 rounded-md border bg-background px-2 text-xs"
                      disabled={mutation.isPending}
                      value={member.role}
                      onChange={(event) =>
                        mutation.mutate({
                          action: "role",
                          pubkey: member.pubkey,
                          role: event.target.value as Exclude<
                            ChannelMember["role"],
                            "owner"
                          >,
                        })
                      }
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                      <option value="guest">Guest</option>
                      <option value="bot">Bot</option>
                    </select>
                    <Button
                      aria-label={`Remove ${truncatePubkey(member.pubkey)}`}
                      disabled={mutation.isPending}
                      onClick={() =>
                        mutation.mutate({
                          action: "remove",
                          pubkey: member.pubkey,
                        })
                      }
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 />
                    </Button>
                  </>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className="p-3 text-sm text-muted-foreground">
            No member snapshot is available.
          </p>
        )}
      </div>
    </section>
  );
}
