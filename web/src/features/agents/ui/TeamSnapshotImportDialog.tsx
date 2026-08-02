import { AlertTriangle, Upload, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/ui/button";
import type { DecodedTeamSnapshot } from "../team-snapshot";

export function TeamSnapshotImportDialog({
  decoded,
  pending,
  onClose,
  onImport,
}: {
  decoded: DecodedTeamSnapshot;
  pending: boolean;
  onClose: () => void;
  onImport: (keepAllowlist: boolean) => void;
}) {
  const [keepAllowlist, setKeepAllowlist] = useState(false);
  const { snapshot } = decoded;
  return (
    <div
      aria-label="Import team snapshot"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="flex max-h-[88dvh] w-full max-w-lg flex-col rounded-lg bg-background shadow-2xl">
        <header className="flex items-start justify-between border-b px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold">Import team snapshot</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {decoded.source.toUpperCase()} · {snapshot.members.length} member
              {snapshot.members.length === 1 ? "" : "s"}
            </p>
          </div>
          <Button
            aria-label="Close"
            disabled={pending}
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
          <div>
            <p className="font-medium">{snapshot.team.name}</p>
            {snapshot.team.description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {snapshot.team.description}
              </p>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            New personas, a new team, and fresh agent identities will be
            created. Source identities and credentials never travel.
          </p>
          <div className="max-h-48 divide-y overflow-y-auto rounded-md border">
            {snapshot.members.map((member, index) => (
              <div
                className="px-3 py-2"
                // biome-ignore lint/suspicious/noArrayIndexKey: exact duplicate members are valid and the preview is immutable
                key={`${member.definition.name}-${index}`}
              >
                <p className="text-sm font-medium">
                  {member.profile.displayName}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.definition.model ??
                    member.definition.runtime ??
                    "Choose a harness"}
                </p>
              </div>
            ))}
          </div>
          {decoded.memoryCount ? (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {decoded.memoryCount} plaintext memory entr
              {decoded.memoryCount === 1 ? "y" : "ies"} will be re-encrypted
              under the new member identities before their harnesses start.
            </p>
          ) : null}
          {decoded.hasSourceAllowlist ? (
            <fieldset className="space-y-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">
                Source allowlists
              </legend>
              <p className="text-xs text-muted-foreground">
                Source public keys may not identify the same people here.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={!keepAllowlist}
                  name="team-allowlist"
                  onChange={() => setKeepAllowlist(false)}
                  type="radio"
                />
                Clear source allowlists (safer)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={keepAllowlist}
                  name="team-allowlist"
                  onChange={() => setKeepAllowlist(true)}
                  type="radio"
                />
                Keep source allowlists
              </label>
            </fieldset>
          ) : null}
        </div>
        <footer className="flex justify-end gap-2 border-t px-6 py-4">
          <Button disabled={pending} onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => onImport(keepAllowlist)}>
            <Upload /> {pending ? "Importing…" : "Import"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
