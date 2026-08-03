import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import {
  listAgents,
  setAgentRunning,
  type ManagedAgent,
  updateAgent,
  type UpdateAgentInput,
} from "../agent-api";
import { listAgentChannels } from "../agent-channels";
import {
  UserProfileDialog,
  type UserProfileDialogProps,
} from "@/features/profile/UserProfileDialog";
import { AddAgentToChannelDialog } from "./AddAgentToChannelDialog";
import { AgentActivityDialog } from "./AgentActivityDialog";
import { AgentAuthDialog } from "./AgentAuthDialog";
import { AgentEditDialog } from "./AgentEditDialog";

type ManagedUserProfileDialogProps = Omit<
  UserProfileDialogProps,
  | "agentActionPending"
  | "agentChannels"
  | "agentChannelsLoading"
  | "agentRunning"
  | "managedAgent"
  | "onAddToChannel"
  | "onEditAgent"
  | "onOpenActivity"
  | "onToggleAgentState"
>;

export function ManagedUserProfileDialog({
  pubkey,
  ownerPubkey,
  ...profileProps
}: ManagedUserProfileDialogProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ManagedAgent | null>(null);
  const [authenticating, setAuthenticating] = useState<ManagedAgent | null>(
    null,
  );
  const [addingToChannel, setAddingToChannel] = useState<ManagedAgent | null>(
    null,
  );
  const [viewingActivity, setViewingActivity] = useState<ManagedAgent | null>(
    null,
  );
  const agentsQuery = useQuery({
    queryKey: ["managed-agents", ownerPubkey],
    queryFn: listAgents,
    enabled: pubkey !== null,
    staleTime: 10_000,
    retry: false,
  });
  const agent = agentsQuery.data?.find(
    (candidate) => candidate.agent_pubkey === pubkey,
  );
  const channelsQuery = useQuery({
    queryKey: ["agent-channels", agent?.agent_pubkey ?? ""],
    queryFn: () => listAgentChannels(agent?.agent_pubkey ?? ""),
    enabled: agent !== undefined,
    staleTime: 30_000,
  });

  function replaceAgent(updated: ManagedAgent) {
    queryClient.setQueryData<ManagedAgent[]>(
      ["managed-agents", ownerPubkey],
      (current = []) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        ),
    );
  }

  const stateMutation = useMutation({
    mutationFn: ({ id, running }: { id: string; running: boolean }) =>
      setAgentRunning(id, running),
    onSuccess: replaceAgent,
    onError: (error) =>
      toast.error("Could not update agent", { description: error.message }),
  });
  const editMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAgentInput }) =>
      updateAgent(id, input),
    onSuccess: (updated) => {
      replaceAgent(updated);
      setEditing(null);
      toast.success(`${updated.name} updated`);
    },
    onError: (error) =>
      toast.error("Could not update agent", { description: error.message }),
  });
  const running = Boolean(
    agent &&
      ["pending", "starting", "running", "stopping"].includes(
        agent.observed_state,
      ),
  );

  return (
    <>
      <UserProfileDialog
        {...profileProps}
        agentActionPending={stateMutation.isPending}
        agentChannels={channelsQuery.data}
        agentChannelsLoading={channelsQuery.isLoading}
        agentName={agent?.name ?? profileProps.agentName}
        agentRunning={running}
        managedAgent={agent}
        onAddToChannel={agent ? () => setAddingToChannel(agent) : undefined}
        onEditAgent={agent && !running ? () => setEditing(agent) : undefined}
        onOpenActivity={agent ? () => setViewingActivity(agent) : undefined}
        onToggleAgentState={
          agent
            ? () => {
                if (running) {
                  stateMutation.mutate({ id: agent.id, running: false });
                } else if (agent.credential_mode === "subscription") {
                  setAuthenticating(agent);
                } else {
                  stateMutation.mutate({ id: agent.id, running: true });
                }
              }
            : undefined
        }
        ownerPubkey={ownerPubkey}
        pubkey={pubkey}
      />
      <AddAgentToChannelDialog
        agent={addingToChannel}
        onAdded={(channel) => {
          void queryClient.invalidateQueries({
            queryKey: ["agent-channels", addingToChannel?.agent_pubkey ?? ""],
          });
          toast.success(`${addingToChannel?.name ?? "Agent"} added`, {
            description: `The agent can now be mentioned in ${channel.name}.`,
          });
        }}
        onClose={() => setAddingToChannel(null)}
        open={addingToChannel !== null}
      />
      <AgentAuthDialog
        agent={authenticating}
        key={authenticating?.id ?? "profile-agent-auth"}
        onAuthenticated={async (selected) => {
          await stateMutation.mutateAsync({ id: selected.id, running: true });
          setAuthenticating(null);
          toast.success(`${selected.name} is starting`);
        }}
        onClose={() => setAuthenticating(null)}
      />
      <AgentEditDialog
        agent={editing}
        pending={editMutation.isPending}
        onClose={() => setEditing(null)}
        onSubmit={async (input) => {
          if (!editing) return;
          await editMutation.mutateAsync({ id: editing.id, input });
        }}
      />
      <AgentActivityDialog
        agent={viewingActivity}
        onClose={() => setViewingActivity(null)}
        ownerPubkey={ownerPubkey}
      />
    </>
  );
}
