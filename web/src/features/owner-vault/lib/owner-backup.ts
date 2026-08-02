export const MIN_BACKUP_PASSWORD_LENGTH = 12;

export function backupPasswordIssue(password: string): string | null {
  if (!password) return null;
  return [...password].length < MIN_BACKUP_PASSWORD_LENGTH
    ? `Use at least ${MIN_BACKUP_PASSWORD_LENGTH} characters.`
    : null;
}

export function downloadOwnerBackup(ncryptsec: string, ownerPubkey: string) {
  const blob = new Blob([`${ncryptsec}\n`], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `buzz-owner-${ownerPubkey}.ncryptsec`;
  anchor.click();
  URL.revokeObjectURL(url);
}
