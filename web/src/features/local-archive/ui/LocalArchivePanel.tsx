import { useQuery } from "@tanstack/react-query";
import { Archive, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { listChannels } from "@/features/channels/channel-api";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { Button } from "@/shared/ui/button";
import {
  isGroupFullyChecked,
  isGroupIndeterminate,
  KIND_AGENT_OBSERVER_FRAME,
  KIND_AGENT_TURN_METRIC,
  KIND_GROUPS,
  parseCustomKinds,
  selectedArchiveKinds,
  toggleGroup,
  toggleKind,
  type KindGroup,
} from "../local-archive-kinds";
import {
  deleteArchiveSubscription,
  listArchiveSubscriptions,
  saveArchiveSubscription,
  setOwnerArchiveKind,
  type ArchiveSubscription,
} from "../local-archive-store";

function kindSummary(kinds: number[]) {
  if (kinds.length <= 4) return kinds.join(", ");
  return `${kinds.slice(0, 3).join(", ")} +${kinds.length - 3} more`;
}

function ToggleRow({
  checked,
  description,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 p-4">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
      <input
        checked={checked}
        className="h-4 w-4 shrink-0 accent-primary"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

function GroupCheckbox({
  group,
  selected,
  onChange,
}: {
  group: KindGroup;
  selected: ReadonlySet<number>;
  onChange: (next: Set<number>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const checked = isGroupFullyChecked(group, selected);
  const indeterminate = isGroupIndeterminate(group, selected);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const groupId = `local-archive-group-${group.label.replace(/\s+/gu, "-")}`;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <input
          checked={checked}
          className="h-4 w-4 accent-primary"
          id={groupId}
          onChange={() => onChange(toggleGroup(group, selected))}
          ref={inputRef}
          type="checkbox"
        />
        <label className="text-sm font-medium" htmlFor={groupId}>
          {group.label}
        </label>
      </div>
      <div className="ml-6 space-y-1.5">
        {group.items.map((item) => {
          const itemId = `local-archive-kind-${item.kind}`;
          return (
            <div className="flex items-center gap-2" key={item.kind}>
              <input
                checked={selected.has(item.kind)}
                className="h-4 w-4 accent-primary"
                id={itemId}
                onChange={() => onChange(toggleKind(item.kind, selected))}
                type="checkbox"
              />
              <label className="text-sm text-muted-foreground" htmlFor={itemId}>
                {item.label}
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddSubscriptionForm({
  channels,
  ownerPubkey,
  relayUrl,
  onCancel,
  onSaved,
}: {
  channels: Array<{ id: string; name: string }>;
  ownerPubkey: string;
  relayUrl: string;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [channelId, setChannelId] = useState("");
  const [selectedKinds, setSelectedKinds] = useState<Set<number>>(new Set());
  const [customKinds, setCustomKinds] = useState("");
  const [saving, setSaving] = useState(false);
  const parsedCustomKinds = parseCustomKinds(customKinds);
  const kinds = selectedArchiveKinds(selectedKinds, parsedCustomKinds.valid);
  const canSave = channelId.length > 0 && kinds.length > 0;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      await saveArchiveSubscription({
        ownerPubkey,
        relayUrl,
        scopeType: "channel_h",
        scopeValue: channelId,
        kinds,
      });
      await onSaved();
      toast.success("Archive subscription created.");
    } catch (error) {
      toast.error("Could not create archive subscription", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 rounded-md border p-4">
      <label className="block text-sm font-medium" htmlFor="archive-channel">
        Channel
        <select
          className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
          id="archive-channel"
          onChange={(event) => setChannelId(event.target.value)}
          value={channelId}
        >
          <option value="">Select a channel…</option>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-medium">Event types</legend>
        {KIND_GROUPS.map((group) => (
          <GroupCheckbox
            group={group}
            key={group.label}
            onChange={setSelectedKinds}
            selected={selectedKinds}
          />
        ))}
      </fieldset>
      <label
        className="block text-sm font-medium"
        htmlFor="archive-custom-kinds"
      >
        Advanced: custom kinds
        <input
          className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
          id="archive-custom-kinds"
          onChange={(event) => setCustomKinds(event.target.value)}
          placeholder="e.g. 30023 1337"
          value={customKinds}
        />
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          Space- or comma-separated event kinds from 0 through 65535.
        </span>
      </label>
      {parsedCustomKinds.invalid.length > 0 ? (
        <p className="text-xs text-destructive">
          Invalid tokens (ignored): {parsedCustomKinds.invalid.join(", ")}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          disabled={saving}
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          data-testid="local-archive-confirm-add"
          disabled={!canSave || saving}
          onClick={() => void save()}
          type="button"
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

export function LocalArchivePanel({ ownerPubkey }: { ownerPubkey: string }) {
  const relayUrl = relayWsUrl();
  const [subscriptions, setSubscriptions] = useState<ArchiveSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [ownerKindOverrides, setOwnerKindOverrides] = useState<
    Map<number, boolean>
  >(new Map());
  const channelsQuery = useQuery({
    queryKey: ["channels", ownerPubkey],
    queryFn: () => listChannels(ownerPubkey),
    staleTime: 5_000,
  });
  const channels = useMemo(
    () => (channelsQuery.data ?? []).filter((channel) => channel.isMember),
    [channelsQuery.data],
  );
  const channelNames = useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel.name])),
    [channels],
  );

  const reload = useCallback(async () => {
    try {
      setSubscriptions(await listArchiveSubscriptions(ownerPubkey, relayUrl));
      setStorageError(null);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [ownerPubkey, relayUrl]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const ownerSubscription = subscriptions.find(
    (subscription) => subscription.scopeType === "owner_p",
  );
  const channelSubscriptions = subscriptions.filter(
    (subscription) => subscription.scopeType !== "owner_p",
  );

  async function setOwnerKind(kind: number, enabled: boolean) {
    const action = `${kind}:${enabled}`;
    setOwnerKindOverrides((current) => {
      const next = new Map(current);
      next.set(kind, enabled);
      return next;
    });
    setPending(action);
    try {
      await setOwnerArchiveKind({
        ownerPubkey,
        relayUrl,
        kind,
        enabled,
      });
      await reload();
      toast.success(
        kind === KIND_AGENT_OBSERVER_FRAME
          ? `Observer feed archive ${enabled ? "enabled" : "disabled"}.`
          : `Agent turn metric archive ${enabled ? "enabled" : "disabled"}.`,
      );
    } catch (error) {
      toast.error("Could not update local archive", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setOwnerKindOverrides((current) => {
        const next = new Map(current);
        next.delete(kind);
        return next;
      });
      setPending(null);
    }
  }

  function ownerKindEnabled(kind: number) {
    return (
      ownerKindOverrides.get(kind) ??
      ownerSubscription?.kinds.includes(kind) ??
      false
    );
  }

  async function remove(subscription: ArchiveSubscription) {
    setPending(subscription.key);
    try {
      await deleteArchiveSubscription({
        ownerPubkey,
        relayUrl,
        scopeType: subscription.scopeType,
        scopeValue: subscription.scopeValue,
      });
      await reload();
      toast.success("Archive subscription removed.");
    } catch (error) {
      toast.error("Could not remove archive subscription", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <section data-testid="settings-local-archive">
      <header className="mb-6">
        <h2 className="text-2xl font-semibold">Local archive</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Save verified relay events to this browser’s local database. Archive
          data stays in this browser profile and is separated by owner and
          relay.
        </p>
      </header>
      {storageError ? (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {storageError}
        </p>
      ) : null}
      <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Agent observer feed</h3>
          <div className="divide-y rounded-md border">
            <ToggleRow
              checked={ownerKindEnabled(KIND_AGENT_OBSERVER_FRAME)}
              description="Saves ephemeral observer frames addressed to your owner identity. The relay does not retain these events."
              disabled={pending !== null || Boolean(storageError)}
              label="Archive my agents’ observer frames"
              onChange={(checked) =>
                void setOwnerKind(KIND_AGENT_OBSERVER_FRAME, checked)
              }
            />
          </div>
        </section>
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Agent turn metrics</h3>
          <div className="divide-y rounded-md border">
            <ToggleRow
              checked={ownerKindEnabled(KIND_AGENT_TURN_METRIC)}
              description="Saves turn-metric events addressed to your owner identity for local usage analysis."
              disabled={pending !== null || Boolean(storageError)}
              label="Archive my agents’ turn metrics"
              onChange={(checked) =>
                void setOwnerKind(KIND_AGENT_TURN_METRIC, checked)
              }
            />
          </div>
        </section>
        <section
          className="space-y-3"
          data-testid="local-archive-subscriptions"
        >
          <h3 className="text-lg font-semibold">
            Channel subscriptions
            {channelSubscriptions.length > 0
              ? ` (${channelSubscriptions.length})`
              : ""}
          </h3>
          <div className="divide-y rounded-md border">
            {loading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : channelSubscriptions.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No channel subscriptions yet. Add one below.
              </p>
            ) : (
              channelSubscriptions.map((subscription) => (
                <div
                  className="flex items-center gap-3 p-4"
                  data-testid={`local-archive-sub-${subscription.scopeValue}`}
                  key={subscription.key}
                >
                  <Archive className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {channelNames.get(subscription.scopeValue) ??
                        subscription.scopeValue}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {subscription.scopeType} · kinds:{" "}
                      {kindSummary(subscription.kinds)}
                    </p>
                  </div>
                  <Button
                    aria-label={`Remove archive subscription for ${channelNames.get(subscription.scopeValue) ?? subscription.scopeValue}`}
                    disabled={pending === subscription.key}
                    onClick={() => void remove(subscription)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))
            )}
          </div>
        </section>
        <section className="space-y-3" data-testid="local-archive-add">
          <h3 className="text-lg font-semibold">Add channel subscription</h3>
          {adding ? (
            <AddSubscriptionForm
              channels={channels}
              onCancel={() => setAdding(false)}
              onSaved={async () => {
                setAdding(false);
                await reload();
              }}
              ownerPubkey={ownerPubkey}
              relayUrl={relayUrl}
            />
          ) : (
            <div className="flex items-center justify-between gap-4 rounded-md border p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">Subscribe to a channel</p>
                <p className="text-sm text-muted-foreground">
                  Choose a joined channel and the event types to retain.
                </p>
              </div>
              <Button
                data-testid="local-archive-open-add"
                disabled={Boolean(storageError)}
                onClick={() => setAdding(true)}
                size="sm"
                type="button"
                variant="outline"
              >
                Add
              </Button>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
