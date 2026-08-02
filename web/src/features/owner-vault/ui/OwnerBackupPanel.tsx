import { Download, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  backupPasswordIssue,
  downloadOwnerBackup,
  MIN_BACKUP_PASSWORD_LENGTH,
} from "../lib/owner-backup";
import { exportOwnerNip49Backup } from "../lib/vault-worker-client";

export function OwnerBackupPanel({ ownerPubkey }: { ownerPubkey: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const passwordIssue = backupPasswordIssue(password);
  const confirmationIssue =
    confirmation && confirmation !== password
      ? "Passwords do not match."
      : null;

  async function download() {
    if (
      passwordIssue ||
      [...password].length < MIN_BACKUP_PASSWORD_LENGTH ||
      password !== confirmation
    )
      return;
    setPending(true);
    try {
      const encrypted = await exportOwnerNip49Backup(password);
      downloadOwnerBackup(encrypted, ownerPubkey);
      setPassword("");
      setConfirmation("");
      setOpen(false);
      toast.success("Encrypted backup downloaded");
    } catch (error) {
      toast.error("Could not create backup", {
        description:
          error instanceof Error ? error.message : "Backup encryption failed.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="owner-backup-heading"
      className="mt-4 rounded-md border p-4"
    >
      <div className="flex items-start gap-3">
        <LockKeyhole className="mt-0.5 h-5 w-5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold" id="owner-backup-heading">
            Encrypted owner backup
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a standard NIP-49 backup for Buzz or another compatible Nostr
            client.
          </p>
        </div>
        {!open ? (
          <Button
            onClick={() => setOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <Download /> Create backup
          </Button>
        ) : null}
      </div>
      {open ? (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void download();
          }}
        >
          <label
            className="block text-sm font-medium"
            htmlFor="backup-password"
          >
            Backup password
            <Input
              autoComplete="new-password"
              className="mt-2"
              disabled={pending}
              id="backup-password"
              maxLength={256}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {passwordIssue ? (
            <p className="text-xs text-destructive">{passwordIssue}</p>
          ) : null}
          <label
            className="block text-sm font-medium"
            htmlFor="backup-password-confirmation"
          >
            Confirm password
            <Input
              autoComplete="new-password"
              className="mt-2"
              disabled={pending}
              id="backup-password-confirmation"
              maxLength={256}
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {confirmationIssue ? (
            <p className="text-xs text-destructive">{confirmationIssue}</p>
          ) : null}
          <p className="text-xs leading-5 text-muted-foreground">
            The owner key is encrypted inside the signing worker and is never
            revealed to this page. Keep the file and password separately.
          </p>
          <div className="flex gap-2">
            <Button
              disabled={
                pending ||
                passwordIssue !== null ||
                [...password].length < MIN_BACKUP_PASSWORD_LENGTH ||
                password !== confirmation
              }
              type="submit"
            >
              <Download /> {pending ? "Encrypting…" : "Download backup"}
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                setPassword("");
                setConfirmation("");
                setOpen(false);
              }}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
