/** Restrict user-controlled outbound links to browser-safe web schemes. */
export function isSafeHttpUrl(
  value: string | null | undefined,
): value is string {
  if (!value) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
