import { Brain, Download, FileType2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/ui/button";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import type { SnapshotMemoryLevel } from "../agent-snapshot";
import type { AgentTeam } from "../team-api";

export function TeamSnapshotExportDialog({
  team,
  linkedMembers,
  onClose,
  onExport,
}: {
  team: AgentTeam;
  linkedMembers: number;
  onClose: () => void;
  onExport: (
    memoryLevel: SnapshotMemoryLevel,
    format: "json" | "png",
  ) => Promise<void>;
}) {
  const [memoryLevel, setMemoryLevel] = useState<SnapshotMemoryLevel>("none");
  const [format, setFormat] = useState<"json" | "png">("png");
  const [pending, setPending] = useState(false);
  useEscapeSurface(true, onClose, pending);
  return (
    <div
      aria-label={`Export ${team.name}`}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-2xl">
        <header className="flex items-center justify-between gap-4">
          <h2 className="truncate text-lg font-semibold">Export {team.name}</h2>
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
          <label className="flex min-h-10 items-center justify-between gap-4 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <Brain className="h-4 w-4 text-muted-foreground" /> Memories
            </span>
            <select
              aria-label="Memories"
              className="h-9 rounded-md border bg-background px-3"
              disabled={pending}
              onChange={(event) =>
                setMemoryLevel(event.target.value as SnapshotMemoryLevel)
              }
              value={memoryLevel}
            >
              <option value="none">Team only</option>
              <option value="core">Team + core memory</option>
              <option value="everything">Team + all memories</option>
            </select>
          </label>
          <label className="flex min-h-10 items-center justify-between gap-4 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <FileType2 className="h-4 w-4 text-muted-foreground" /> File
              format
            </span>
            <select
              aria-label="File format"
              className="h-9 rounded-md border bg-background px-3"
              disabled={pending}
              onChange={(event) =>
                setFormat(event.target.value as "json" | "png")
              }
              value={format}
            >
              <option value="png">PNG</option>
              <option value="json">JSON</option>
            </select>
          </label>
          {memoryLevel !== "none" ? (
            <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              <p>
                Memory is stored as plaintext. Only share this snapshot with
                people you trust.
              </p>
              <p>
                {linkedMembers} of {team.personaIds.length} members have a
                linked hosted instance; other members remain config-only.
              </p>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Private keys, credentials, subscription sessions, and persona
            lineage are never included.
          </p>
        </div>
        <footer className="mt-6 flex justify-end gap-2">
          <Button disabled={pending} onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                await onExport(memoryLevel, format);
                onClose();
              } catch {
                // The parent reports the error and leaves the dialog open.
              } finally {
                setPending(false);
              }
            }}
          >
            <Download /> Export
          </Button>
        </footer>
      </div>
    </div>
  );
}
