import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  getCustomEmoji,
  normalizeShortcode,
  removeCustomEmoji,
  saveCustomEmoji,
  uploadEmoji,
} from "../custom-emoji-api";

export const customEmojiKey = ["custom-emoji"] as const;

export function CustomEmojiPanel({ ownerPubkey }: { ownerPubkey: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [upload, setUpload] = useState<{
    url: string;
    filename: string;
  } | null>(null);
  const query = useQuery({
    queryKey: [...customEmojiKey, ownerPubkey],
    queryFn: () => getCustomEmoji(ownerPubkey),
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: [...customEmojiKey, ownerPubkey],
    });
  const uploadMutation = useMutation({
    mutationFn: uploadEmoji,
    onSuccess: (result) => {
      setUpload({ url: result.url, filename: result.name });
      if (!name.trim()) setName(result.name);
    },
    onError: (error) =>
      toast.error("Could not upload emoji", { description: error.message }),
  });
  const saveMutation = useMutation({
    mutationFn: () => saveCustomEmoji(ownerPubkey, name, upload?.url ?? ""),
    onSuccess: async (shortcode) => {
      await refresh();
      setName("");
      setUpload(null);
      toast.success(`Added :${shortcode}:`);
    },
    onError: (error) =>
      toast.error("Could not save emoji", { description: error.message }),
  });
  const removeMutation = useMutation({
    mutationFn: (shortcode: string) =>
      removeCustomEmoji(ownerPubkey, shortcode),
    onSuccess: async (_, shortcode) => {
      await refresh();
      toast.success(`Removed :${shortcode}:`);
    },
    onError: (error) =>
      toast.error("Could not remove emoji", { description: error.message }),
  });
  const normalized = normalizeShortcode(name);
  const own = query.data?.own ?? [];
  const ownNames = new Set(own.map((emoji) => emoji.shortcode));
  const others = (query.data?.community ?? []).filter(
    (emoji) => !ownNames.has(emoji.shortcode),
  );

  return (
    <section>
      <header className="mb-6">
        <h2 className="text-2xl font-semibold">Custom emoji</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add your own emoji for everyone on this relay to use.
        </p>
      </header>
      <form
        className="overflow-hidden rounded-md border"
        onSubmit={(event) => {
          event.preventDefault();
          if (upload && normalized) saveMutation.mutate();
        }}
      >
        <div className="flex flex-wrap items-center gap-4 border-b p-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border bg-muted/40">
            {upload ? (
              <img
                alt="Selected custom emoji preview"
                className="h-14 w-14 object-contain"
                src={upload.url}
              />
            ) : (
              <ImagePlus className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Upload an image</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Square GIF, PNG, JPEG, and WebP images work best.
            </p>
          </div>
          <label className="inline-flex h-9 cursor-pointer items-center rounded-md border px-3 text-sm font-medium">
            {uploadMutation.isPending
              ? "Uploading…"
              : upload
                ? "Choose another"
                : "Upload image"}
            <input
              accept="image/gif,image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={uploadMutation.isPending || saveMutation.isPending}
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) uploadMutation.mutate(file);
              }}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-4 p-4">
          <div className="min-w-48 flex-1">
            <p className="text-sm font-medium">Give it a name</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Use letters, numbers, hyphen, or underscore.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              :
            </span>
            <Input
              aria-label="Custom emoji name"
              className="px-6"
              placeholder="party-parrot"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              :
            </span>
          </div>
          <Button
            disabled={!upload || !normalized || saveMutation.isPending}
            type="submit"
          >
            {saveMutation.isPending ? "Saving…" : "Save emoji"}
          </Button>
        </div>
      </form>

      <EmojiList
        empty="You haven't added any emoji yet."
        emoji={own}
        loading={query.isLoading}
        onRemove={(shortcode) => removeMutation.mutate(shortcode)}
        title="My emoji"
      />
      {others.length ? (
        <EmojiList emoji={others} title="From other members" />
      ) : null}
    </section>
  );
}

function EmojiList({
  title,
  emoji,
  loading,
  empty,
  onRemove,
}: {
  title: string;
  emoji: Array<{ shortcode: string; url: string }>;
  loading?: boolean;
  empty?: string;
  onRemove?: (shortcode: string) => void;
}) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-base font-semibold">
        {title}
        {emoji.length ? ` (${emoji.length})` : ""}
      </h3>
      <div className="divide-y overflow-hidden rounded-md border">
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : emoji.length ? (
          emoji.map((item) => (
            <div className="flex items-center gap-3 p-3" key={item.shortcode}>
              <img
                alt={`:${item.shortcode}:`}
                className="h-7 w-7 object-contain"
                src={item.url}
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                :{item.shortcode}:
              </span>
              {onRemove ? (
                <Button
                  aria-label={`Remove :${item.shortcode}:`}
                  onClick={() => onRemove(item.shortcode)}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          ))
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{empty}</p>
        )}
      </div>
    </section>
  );
}
