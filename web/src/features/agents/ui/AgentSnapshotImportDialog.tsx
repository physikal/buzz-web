import { AlertTriangle, Bot, Upload, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/ui/button";
import type { DecodedAgentSnapshot } from "../agent-snapshot";
import { safePersonaAvatarUrl } from "../persona-api";

export function AgentSnapshotImportDialog({
  decoded,
  pending,
  onClose,
  onImport,
}: {
  decoded: DecodedAgentSnapshot;
  pending: boolean;
  onClose: () => void;
  onImport: (keepAllowlist: boolean) => void;
}) {
  const [keepAllowlist, setKeepAllowlist] = useState(false);
  const { snapshot } = decoded;
  const allowlist = snapshot.definition.respondToAllowlist ?? [];
  const memoryCount = snapshot.memory.entries?.length ?? 0;
  const avatar = safePersonaAvatarUrl(
    snapshot.profile.avatarDataUrl ?? snapshot.profile.avatarUrl ?? null,
  );

  return (
    <div
      aria-label="Import agent snapshot"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-2xl">
        <header className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Import agent snapshot</h2>
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
        <div className="mt-5 space-y-4">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary">
              {avatar ? (
                <img
                  alt=""
                  className="h-full w-full object-cover"
                  src={avatar}
                />
              ) : (
                <Bot className="h-6 w-6" />
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold">
                {snapshot.profile.displayName}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {snapshot.definition.model ||
                  snapshot.definition.runtime ||
                  "Choose a harness when deploying"}
              </p>
            </div>
          </div>
          {snapshot.definition.systemPrompt ? (
            <p className="line-clamp-3 text-sm text-muted-foreground">
              {snapshot.definition.systemPrompt}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            A private persona will be created, then Buzz will open the secure
            deployment form for credentials. Source identity never travels.
          </p>
          {memoryCount ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              This snapshot includes {memoryCount} plaintext memory entr
              {memoryCount === 1 ? "y" : "ies"}. Buzz will re-encrypt each entry
              under the new agent identity before publishing it.
            </div>
          ) : null}
          {allowlist.length ? (
            <fieldset className="space-y-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">
                Respond-to allowlist ({allowlist.length})
              </legend>
              <p className="text-xs text-muted-foreground">
                Source identities may not be meaningful in this community.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={!keepAllowlist}
                  name="snapshot-allowlist"
                  onChange={() => setKeepAllowlist(false)}
                  type="radio"
                />
                Clear source allowlist (safer)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={keepAllowlist}
                  name="snapshot-allowlist"
                  onChange={() => setKeepAllowlist(true)}
                  type="radio"
                />
                Keep source allowlist
              </label>
            </fieldset>
          ) : null}
        </div>
        <footer className="mt-6 flex justify-end gap-2">
          <Button disabled={pending} onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => onImport(keepAllowlist)}>
            <Upload /> Import
          </Button>
        </footer>
      </div>
    </div>
  );
}
