import { X } from "lucide-react";
import { useEffect, useState } from "react";

import type { ChannelSection } from "../use-channel-sections";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";

export function ChannelSectionDialog({
  open,
  section,
  onClose,
  onSave,
}: {
  open: boolean;
  section: ChannelSection | null;
  onClose: () => void;
  onSave: (name: string, icon?: string) => void;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  useEscapeSurface(open, onClose);
  useEffect(() => {
    if (!open) return;
    setName(section?.name ?? "");
    setIcon(section?.icon ?? "");
  }, [open, section]);
  if (!open) return null;
  return (
    <div
      aria-label={section ? "Rename section" : "Create section"}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <form
        className="w-full max-w-sm rounded-lg bg-background p-6 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          onSave(name.trim(), icon.trim() || undefined);
        }}
      >
        <header className="mb-5 flex items-center gap-2">
          <h2 className="flex-1 text-lg font-semibold">
            {section ? "Rename section" : "Create section"}
          </h2>
          <Button
            aria-label="Close"
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        <label
          className="block text-sm font-medium"
          htmlFor="channel-section-name"
        >
          Name
          <Input
            autoFocus
            className="mt-2"
            id="channel-section-name"
            onChange={(event) => setName(event.target.value)}
            placeholder="Section name"
            value={name}
          />
        </label>
        <label
          className="mt-4 block text-sm font-medium"
          htmlFor="channel-section-icon"
        >
          Icon{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
          <Input
            className="mt-2"
            id="channel-section-icon"
            maxLength={16}
            onChange={(event) => setIcon(event.target.value)}
            placeholder="#"
            value={icon}
          />
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={!name.trim()} type="submit">
            {section ? "Save" : "Create"}
          </Button>
        </div>
      </form>
    </div>
  );
}
