import type { CustomEmoji } from "@/features/settings/custom-emoji-api";
import { cn } from "@/shared/lib/cn";

const SHORTCODE = /^:([^:\s]+):$/;

export function StatusEmoji({
  className,
  customEmoji,
  value,
}: {
  className?: string;
  customEmoji: CustomEmoji[];
  value: string | undefined;
}) {
  if (!value) return null;
  const match = value.match(SHORTCODE);
  const resolved = match
    ? customEmoji.find(
        (emoji) => emoji.shortcode.toLowerCase() === match[1].toLowerCase(),
      )
    : undefined;
  if (resolved) {
    return (
      <img
        alt={value}
        className={cn("inline-block object-contain align-middle", className)}
        draggable={false}
        referrerPolicy="no-referrer"
        src={resolved.url}
        title={value}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center leading-normal align-middle",
        className,
      )}
      title={value}
    >
      {value}
    </span>
  );
}
