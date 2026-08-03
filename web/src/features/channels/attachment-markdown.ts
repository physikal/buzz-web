export type AttachmentMarkdownMedia = {
  url: string;
  type: string;
  filename?: string;
};

export type RenderedAttachmentMedia = {
  url: string;
  mimeType: string | null;
  name: string | null;
};

const MEDIA_LINE_RE =
  /^(?:\|\|)?!\[(?:image|video)\]\(([^)\s]+)\)(?:\|\|)?\s*$/;
const SPOILERED_MEDIA_LINE_RE =
  /^\|\|!\[(?:image|video)\]\(([^)\s]+)\)\|\|\s*$/;
const BLOCK_SPOILER_DELIMITER_RE = /^\s*\|\|\s*$/;
const FILE_LINE_RE = /^\[(?:\\.|[^\]\\])*\]\(([^)\s]+)\)\s*$/;

function findTrailingBlockSpoilerStart(
  lines: string[],
  closingIndex: number,
  attachmentUrls: ReadonlySet<string>,
) {
  let index = closingIndex - 1;
  let matchedMedia = false;
  while (index >= 0) {
    const line = lines[index];
    if (!line.trim()) {
      index -= 1;
      continue;
    }
    if (BLOCK_SPOILER_DELIMITER_RE.test(line))
      return matchedMedia ? index : null;
    const url = line.match(MEDIA_LINE_RE)?.[1];
    if (!url || !attachmentUrls.has(url)) return null;
    matchedMedia = true;
    index -= 1;
  }
  return null;
}

function isInlineMedia(type: string, filename?: string | null) {
  const lower = filename?.toLowerCase();
  const snapshot =
    lower?.endsWith(".agent.png") || lower?.endsWith(".team.png");
  return type.startsWith("video/") || (type.startsWith("image/") && !snapshot);
}

export function formatAttachmentMarkdownLine(
  attachment: AttachmentMarkdownMedia,
  spoilered = false,
) {
  if (attachment.type.startsWith("video/")) {
    const line = `![video](${attachment.url})`;
    return `\n${spoilered ? `||${line}||` : line}`;
  }
  if (isInlineMedia(attachment.type, attachment.filename)) {
    const line = `![image](${attachment.url})`;
    return `\n${spoilered ? `||${line}||` : line}`;
  }
  const label =
    attachment.filename || attachment.url.split("/").pop() || "file";
  const escaped = label.replace(/[\\[\]]/g, "\\$&");
  return `\n[${escaped}](${attachment.url})`;
}

export function buildOutgoingAttachmentContent(
  body: string,
  attachments: readonly AttachmentMarkdownMedia[],
  spoileredUrls: ReadonlySet<string>,
) {
  return attachments.reduce(
    (content, attachment) =>
      content +
      formatAttachmentMarkdownLine(
        attachment,
        spoileredUrls.has(attachment.url),
      ),
    body,
  );
}

export function findSpoileredAttachmentUrls(
  content: string,
  attachments: readonly Pick<RenderedAttachmentMedia, "url">[],
) {
  const attachmentUrls = new Set(attachments.map(({ url }) => url));
  const spoilered = new Set<string>();
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const url = line.match(SPOILERED_MEDIA_LINE_RE)?.[1];
    if (url && attachmentUrls.has(url)) {
      spoilered.add(url);
      continue;
    }
    if (!BLOCK_SPOILER_DELIMITER_RE.test(line)) continue;
    const blockUrls = new Set<string>();
    let closingIndex = -1;
    for (
      let blockIndex = index + 1;
      blockIndex < lines.length;
      blockIndex += 1
    ) {
      const blockLine = lines[blockIndex];
      if (BLOCK_SPOILER_DELIMITER_RE.test(blockLine)) {
        closingIndex = blockIndex;
        break;
      }
      const blockUrl = blockLine.match(MEDIA_LINE_RE)?.[1];
      if (blockUrl && attachmentUrls.has(blockUrl)) blockUrls.add(blockUrl);
    }
    if (closingIndex !== -1) {
      for (const blockUrl of blockUrls) spoilered.add(blockUrl);
      index = closingIndex;
    }
  }
  return spoilered;
}

export function stripTrailingAttachmentMarkdown(
  content: string,
  attachments: readonly Pick<RenderedAttachmentMedia, "url">[],
) {
  if (!attachments.length) return content;
  const attachmentUrls = new Set(attachments.map(({ url }) => url));
  const lines = content.split("\n");
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1];
    if (!line.trim()) {
      end -= 1;
      continue;
    }
    if (BLOCK_SPOILER_DELIMITER_RE.test(line)) {
      const start = findTrailingBlockSpoilerStart(
        lines,
        end - 1,
        attachmentUrls,
      );
      if (start !== null) {
        end = start;
        continue;
      }
    }
    const url = line.match(MEDIA_LINE_RE)?.[1] ?? line.match(FILE_LINE_RE)?.[1];
    if (!url || !attachmentUrls.has(url)) break;
    end -= 1;
  }
  return lines.slice(0, end).join("\n").replace(/\s+$/, "");
}
