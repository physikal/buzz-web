import { usePersistentAgentAudienceSetting } from "@/features/channels/persistent-agent-audience";

export function AgentBehaviorPanel({ ownerPubkey }: { ownerPubkey: string }) {
  const audience = usePersistentAgentAudienceSetting(ownerPubkey);
  return (
    <section>
      <header className="mb-6">
        <h2 className="text-2xl font-semibold">Agents</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Control how agents behave in conversations and run on the centralized
          host.
        </p>
      </header>
      <div className="divide-y rounded-md border">
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <label
              className="text-sm font-medium"
              htmlFor="persistent-agent-audience"
            >
              Keep addressed agents active
            </label>
            <p className="text-sm text-muted-foreground">
              Keep agents you address selected for future messages in the same
              thread. Remove them from the composer at any time.
            </p>
          </div>
          <input
            checked={audience.enabled}
            id="persistent-agent-audience"
            onChange={(event) => audience.setEnabled(event.target.checked)}
            type="checkbox"
          />
        </div>
      </div>
    </section>
  );
}
