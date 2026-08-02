import { Download, FileType2, ShieldCheck, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/ui/button";
import type { AgentPersona } from "../persona-api";

export function AgentSnapshotExportDialog({
  persona,
  onClose,
  onExport,
}: {
  persona: AgentPersona;
  onClose: () => void;
  onExport: (format: "json" | "png") => Promise<void>;
}) {
  const [format, setFormat] = useState<"json" | "png">("png");
  const [pending, setPending] = useState(false);

  return (
    <div
      aria-label={`Export ${persona.displayName}`}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-2xl">
        <header className="flex items-center justify-between gap-4">
          <h2 className="truncate text-lg font-semibold">
            Export {persona.displayName}
          </h2>
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
                await onExport(format);
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
