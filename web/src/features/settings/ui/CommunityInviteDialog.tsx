import { Check, Copy, UserPlus, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  addCommunityMember,
  type CommunityRole,
  mintCommunityInvite,
  parseMemberPubkey,
} from "../community-api";

const TTL_OPTIONS = [
  ["1 day", 86_400],
  ["3 days", 259_200],
  ["7 days", 604_800],
  ["30 days", 2_592_000],
] as const;

const USE_OPTIONS = [
  ["No limit", ""],
  ["1 use", "1"],
  ["3 uses", "3"],
  ["5 uses", "5"],
  ["10 uses", "10"],
  ["25 uses", "25"],
] as const;

export function CommunityInviteDialog({
  isOwner,
  open,
  onClose,
  onChanged,
}: {
  isOwner: boolean;
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const [pubkey, setPubkey] = useState("");
  const [role, setRole] = useState<CommunityRole>("member");
  const [ttlSecs, setTtlSecs] = useState(259_200);
  const [maxUses, setMaxUses] = useState("");
  const [pending, setPending] = useState<"member" | "link" | null>(null);
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  async function addMember(event: FormEvent) {
    event.preventDefault();
    if (!parseMemberPubkey(pubkey)) return;
    setPending("member");
    try {
      await addCommunityMember(pubkey, role);
      await onChanged();
      setPubkey("");
      setRole("member");
      toast.success(role === "admin" ? "Admin added" : "Member added");
    } catch (error) {
      toast.error("Could not add member", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPending(null);
    }
  }

  async function copyInvite() {
    setPending("link");
    try {
      const invite = await mintCommunityInvite({
        ttlSecs,
        maxUses: maxUses ? Number(maxUses) : null,
      });
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
      toast.success("Invite link copied");
    } catch (error) {
      toast.error("Could not create invite link", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      aria-label="Invite to community"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !pending) onClose();
      }}
    >
      <div className="w-full max-w-xl rounded-lg bg-background p-6 shadow-2xl">
        <header className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Invite to community</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add someone directly or share a link they can use to join.
            </p>
          </div>
          <Button
            aria-label="Close"
            disabled={Boolean(pending)}
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>

        <form className="mt-6" onSubmit={addMember}>
          <label className="text-sm font-medium" htmlFor="member-pubkey">
            Person
          </label>
          <div className="mt-2 flex gap-2">
            <Input
              autoCapitalize="none"
              autoCorrect="off"
              disabled={Boolean(pending)}
              id="member-pubkey"
              placeholder="Paste an npub or public key"
              spellCheck={false}
              value={pubkey}
              onChange={(event) => setPubkey(event.target.value)}
            />
            {isOwner ? (
              <select
                aria-label="Member role"
                className="h-9 rounded-md border bg-background px-3 text-sm"
                disabled={Boolean(pending)}
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as CommunityRole)
                }
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            ) : null}
            <Button
              aria-label="Add member"
              disabled={pending !== null || !parseMemberPubkey(pubkey)}
              size="icon"
              type="submit"
            >
              <UserPlus />
            </Button>
          </div>
        </form>

        <section className="mt-6 border-t pt-5">
          <p className="text-sm font-medium">Link settings</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted-foreground">
              Expires after
              <select
                className="mt-1 block h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                disabled={Boolean(pending)}
                value={ttlSecs}
                onChange={(event) => setTtlSecs(Number(event.target.value))}
              >
                {TTL_OPTIONS.map(([label, value]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Limit number of uses
              <select
                className="mt-1 block h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                disabled={Boolean(pending)}
                value={maxUses}
                onChange={(event) => setMaxUses(event.target.value)}
              >
                {USE_OPTIONS.map(([label, value]) => (
                  <option key={value || "unlimited"} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-5 flex justify-end">
            <Button
              disabled={Boolean(pending)}
              onClick={() => void copyInvite()}
              type="button"
              variant="outline"
            >
              {copied ? <Check /> : <Copy />}
              {pending === "link"
                ? "Creating…"
                : copied
                  ? "Copied"
                  : "Copy link"}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
