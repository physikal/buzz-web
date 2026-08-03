import {
  CircleDot,
  ExternalLink,
  FileText,
  FolderOpen,
  GitFork,
  GitPullRequest,
  Presentation,
  Table2,
} from "lucide-react";

import type { SupportedLinkPreview } from "../link-preview";

function PreviewIcon({ preview }: { preview: SupportedLinkPreview }) {
  const className = "h-4 w-4";
  switch (preview.kind) {
    case "github-pull-request":
      return <GitPullRequest className={className} />;
    case "github-issue":
    case "linear-issue":
      return <CircleDot className={className} />;
    case "github-repository":
      return <GitFork className={className} />;
    case "google-drive-folder":
      return <FolderOpen className={className} />;
    case "google-sheets-spreadsheet":
      return <Table2 className={className} />;
    case "google-slides-presentation":
      return <Presentation className={className} />;
    case "google-drive-file":
    case "google-docs-document":
      return <FileText className={className} />;
  }
}

export function LinkPreviewCards({
  previews,
}: {
  previews: SupportedLinkPreview[];
}) {
  if (!previews.length) return null;
  return (
    <div className="mt-3 flex max-w-2xl flex-wrap gap-2">
      {previews.map((preview) => (
        <a
          aria-label={`Open ${preview.provider} ${preview.typeLabel}: ${preview.title}`}
          className="group flex w-80 max-w-full items-center gap-3 rounded-md border bg-background p-3 text-foreground no-underline shadow-xs hover:bg-muted/50"
          data-link-preview={preview.kind}
          href={preview.href}
          key={preview.href}
          rel="noreferrer"
          target="_blank"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <PreviewIcon preview={preview} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-muted-foreground">
              {preview.provider} {"\u00b7"} {preview.typeLabel}
            </span>
            <span className="block truncate text-sm font-semibold">
              {preview.title}
            </span>
          </span>
          <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
        </a>
      ))}
    </div>
  );
}
