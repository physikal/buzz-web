import { Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { isSafeHttpUrl } from "@/shared/lib/url";

type ProjectAttachment = {
  url: string;
  mimeType: string | null;
  name: string | null;
  thumbnailUrl: string | null;
};

function fieldValue(fields: Map<string, string>, name: string, limit: number) {
  const value = fields.get(name)?.trim();
  return value && value.length <= limit ? value : null;
}

function parseAttachments(tags: string[][]): ProjectAttachment[] {
  const attachments = new Map<string, ProjectAttachment>();
  for (const tag of tags.slice(0, 32)) {
    if (tag[0] !== "imeta") continue;
    const fields = new Map<string, string>();
    for (const part of tag.slice(1, 32)) {
      if (part.length > 4_096) continue;
      const separator = part.indexOf(" ");
      if (separator > 0) {
        fields.set(part.slice(0, separator), part.slice(separator + 1));
      }
    }
    const url = fieldValue(fields, "url", 4_096);
    if (!isSafeHttpUrl(url) || attachments.has(url)) continue;
    const thumbnailUrl = fieldValue(fields, "thumb", 4_096);
    attachments.set(url, {
      url,
      mimeType: fieldValue(fields, "m", 255),
      name: fieldValue(fields, "name", 512),
      thumbnailUrl: isSafeHttpUrl(thumbnailUrl) ? thumbnailUrl : null,
    });
  }
  return [...attachments.values()];
}

export function ProjectRichContent({
  className = "text-sm",
  content,
  tags = [],
}: {
  className?: string;
  content: string;
  tags?: string[][];
}) {
  const attachments = parseAttachments(tags);
  return (
    <>
      <div
        className={`prose prose-sm max-w-none break-words text-foreground dark:prose-invert prose-p:my-1 prose-pre:max-w-full prose-pre:overflow-x-auto ${className}`}
      >
        <ReactMarkdown
          components={{
            a: ({ children, href }) =>
              isSafeHttpUrl(href) ? (
                <a href={href} rel="noreferrer" target="_blank">
                  {children}
                </a>
              ) : (
                <span>{children}</span>
              ),
            img: ({ alt, src }) =>
              isSafeHttpUrl(src) ? (
                <img
                  alt={alt ?? "Project image"}
                  className="max-h-80 rounded-md border object-contain"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  src={src}
                />
              ) : (
                <span>{alt ?? "Project image"}</span>
              ),
          }}
          remarkPlugins={[remarkGfm]}
          skipHtml
        >
          {content}
        </ReactMarkdown>
      </div>
      <ProjectAttachments attachments={attachments} />
    </>
  );
}

function ProjectAttachments({
  attachments,
}: {
  attachments: ProjectAttachment[];
}) {
  if (!attachments.length) return null;
  return (
    <div className="mt-3 grid max-w-2xl gap-2 sm:grid-cols-2">
      {attachments.map((attachment) => {
        if (attachment.mimeType?.startsWith("image/")) {
          return (
            <a
              href={attachment.url}
              key={attachment.url}
              rel="noreferrer"
              target="_blank"
            >
              <img
                alt={attachment.name ?? "Project attachment"}
                className="max-h-80 w-full rounded-md border object-contain"
                loading="lazy"
                referrerPolicy="no-referrer"
                src={attachment.thumbnailUrl ?? attachment.url}
              />
            </a>
          );
        }
        if (attachment.mimeType?.startsWith("video/")) {
          return (
            // User uploads do not currently carry WebVTT caption tracks.
            // biome-ignore lint/a11y/useMediaCaption: Render the user-provided media instead of hiding it.
            <video
              className="max-h-80 w-full rounded-md border"
              controls
              key={attachment.url}
              preload="metadata"
              src={attachment.url}
            />
          );
        }
        if (attachment.mimeType?.startsWith("audio/")) {
          return (
            // User uploads do not currently carry WebVTT caption tracks.
            // biome-ignore lint/a11y/useMediaCaption: Render the user-provided media instead of hiding it.
            <audio
              className="w-full"
              controls
              key={attachment.url}
              preload="metadata"
              src={attachment.url}
            />
          );
        }
        return (
          <a
            className="flex items-center gap-3 rounded-md border p-3 text-sm hover:bg-muted"
            href={attachment.url}
            key={attachment.url}
            rel="noreferrer"
            target="_blank"
          >
            <Download className="h-5 w-5" />
            <span className="min-w-0 flex-1 truncate">
              {attachment.name ?? "Download attachment"}
            </span>
          </a>
        );
      })}
    </div>
  );
}
