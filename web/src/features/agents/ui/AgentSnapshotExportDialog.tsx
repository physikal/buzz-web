import { Brain, Download, FileType2, ShieldCheck, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/ui/button";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import type { SnapshotMemoryLevel } from "../agent-snapshot";

export function AgentSnapshotExportDialog({
  name,
  memoryAvailable = false,
  onClose,
  onExport,
}: {
  name: string;
  memoryAvailable?: boolean;
  onClose: () => void;
  onExport: (
    format: "json" | "png",
    memoryLevel: SnapshotMemoryLevel,
  ) => Promise<void>;
}) {
  const [format, setFormat] = useState<"json" | "png">("png");
  const [memoryLevel, setMemoryLevel] = useState<SnapshotMemoryLevel>("none");
  const [pending, setPending] = useState(false);
  useEscapeSurface(true, onClose, pending);

  return (
    <div
      aria-label={`Export ${name}`}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-2xl">
        <header className="flex items-center justify-between gap-4">
          <h2 className="truncate text-lg font-semibold">Export {name}</h2>
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
          <div className="flex min-h-10 items-center justify-between gap-4 border-b pb-3 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              Contents
            </span>
            <span>Agent only</span>
          </div>
          <label className="flex min-h-10 items-center justify-between gap-4 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <FileType2 className="h-4 w-4 text-muted-foreground" />
              File format
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
          {memoryAvailable ? (
            <label className="flex min-h-10 items-center justify-between gap-4 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <Brain className="h-4 w-4 text-muted-foreground" />
                Memory
              </span>
              <select
                aria-label="Memory to include"
                className="h-9 rounded-md border bg-background px-3"
                disabled={pending}
                onChange={(event) =>
                  setMemoryLevel(event.target.value as SnapshotMemoryLevel)
                }
                value={memoryLevel}
              >
                <option value="none">None</option>
                <option value="core">Core only</option>
                <option value="everything">Everything</option>
              </select>
            </label>
          ) : null}
          {memoryLevel !== "none" ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              Included memory is decrypted and stored as plaintext. Anyone with
              this file can read it.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Private keys, API credentials, subscription sessions, and
            server-local commands are never included.
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
                await onExport(format, memoryLevel);
                onClose();
              } catch {
                // The parent reports the export error and keeps this dialog open.
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
