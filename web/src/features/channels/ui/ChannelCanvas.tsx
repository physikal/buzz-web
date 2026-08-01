import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Save, X } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { getChannelCanvas, setChannelCanvas } from "../channel-api";

export function ChannelCanvas({ channelId }: { channelId: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const query = useQuery({
    queryKey: ["channel-canvas", channelId],
    queryFn: () => getChannelCanvas(channelId),
    staleTime: 10_000,
  });
  const save = useMutation({
    mutationFn: (content: string) => setChannelCanvas(channelId, content),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["channel-canvas", channelId],
      });
      setEditing(false);
    },
  });
  const canvas = query.data;

  if (query.isLoading)
    return <p className="text-sm text-muted-foreground">Loading canvas…</p>;
  if (query.error)
    return (
      <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">
        {query.error.message}
      </p>
    );
  if (editing)
    return (
      <div className="space-y-3">
        <textarea
          aria-label="Canvas content"
          className="min-h-52 w-full rounded-md border bg-background p-3 font-mono text-sm"
          disabled={save.isPending}
          maxLength={128 * 1024}
          placeholder="Write your canvas content in Markdown…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex gap-2">
          <Button
            disabled={save.isPending}
            onClick={() => save.mutate(draft)}
            size="sm"
          >
            <Save /> {save.isPending ? "Saving…" : "Save canvas"}
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => setEditing(false)}
            size="sm"
            variant="outline"
          >
            <X /> Cancel
          </Button>
        </div>
        {save.error ? (
          <p className="text-sm text-destructive">{save.error.message}</p>
        ) : null}
      </div>
    );

  return (
    <div className="space-y-3">
      {canvas?.content ? (
        <div className="prose prose-sm max-w-none break-words rounded-md border bg-muted/20 p-4 text-foreground dark:prose-invert prose-pre:max-w-full prose-pre:overflow-x-auto">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {canvas.content}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No canvas set for this channel.
        </p>
      )}
      {canvas?.updatedAt && canvas.author ? (
        <p className="text-xs text-muted-foreground">
          Updated {new Date(canvas.updatedAt * 1000).toLocaleString()} by{" "}
          {truncatePubkey(canvas.author)}
        </p>
      ) : null}
      <Button
        onClick={() => {
          setDraft(canvas?.content ?? "");
          setEditing(true);
        }}
        size="sm"
        variant="outline"
      >
        <Pencil /> {canvas?.content ? "Edit canvas" : "Create canvas"}
      </Button>
    </div>
  );
}
