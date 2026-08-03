export type SupportedLinkPreviewKind =
  | "github-pull-request"
  | "github-issue"
  | "github-repository"
  | "linear-issue"
  | "google-drive-file"
  | "google-drive-folder"
  | "google-docs-document"
  | "google-sheets-spreadsheet"
  | "google-slides-presentation";

export type SupportedLinkPreview = {
  kind: SupportedLinkPreviewKind;
  href: string;
  provider:
    | "GitHub"
    | "Linear"
    | "Google Drive"
    | "Google Docs"
    | "Google Sheets"
    | "Google Slides";
  title: string;
  typeLabel:
    | "PR"
    | "issue"
    | "repo"
    | "file"
    | "folder"
    | "document"
    | "spreadsheet"
    | "presentation";
};

const SUPPORTED_URL_RE =
  /(^|[\s([{<>"'])((?:https?:\/\/)?(?:(?:www\.)?github\.com|(?:www\.)?linear\.app|drive\.google\.com|docs\.google\.com)\/[^\s<>"'\]]+)/giu;
const MARKDOWN_SUPPORTED_LINK_RE =
  /!?\[([^\]\n]+)\]\(((?:https?:\/\/)?(?:(?:www\.)?github\.com|(?:www\.)?linear\.app|drive\.google\.com|docs\.google\.com)\/[^)\s<>"']+)\)/giu;
const MAX_PREVIEWS = 8;

type HiddenRange = { end: number; start: number };

function overlaps(start: number, end: number, ranges: HiddenRange[]) {
  return ranges.some((range) => start < range.end && end > range.start);
}

function contains(index: number, ranges: HiddenRange[]) {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function collectCodeRanges(content: string): HiddenRange[] {
  const ranges: HiddenRange[] = [];
  for (const match of content.matchAll(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu))
    ranges.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  for (const match of content.matchAll(/`[^`\n]*`/gu))
    ranges.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  for (const match of content.matchAll(/^(?: {4}|\t).*(?:\n|$)/gmu))
    ranges.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  return ranges;
}

function collectImageRanges(content: string): HiddenRange[] {
  return [...content.matchAll(MARKDOWN_SUPPORTED_LINK_RE)]
    .filter((match) => match[0].startsWith("!"))
    .map((match) => ({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    }));
}

function collectBlockSpoilers(
  content: string,
  excluded: HiddenRange[],
): HiddenRange[] {
  const ranges: HiddenRange[] = [];
  let open: number | null = null;
  let start = 0;
  while (start < content.length) {
    const newline = content.indexOf("\n", start);
    const end = newline === -1 ? content.length : newline + 1;
    const line = content.slice(start, newline === -1 ? end : newline);
    if (line.trim() === "||" && !overlaps(start, end, excluded)) {
      if (open === null) open = start;
      else {
        ranges.push({ start: open, end });
        open = null;
      }
    }
    start = end;
  }
  return ranges;
}

function collectInlineSpoilers(
  content: string,
  excluded: HiddenRange[],
): HiddenRange[] {
  const ranges: HiddenRange[] = [];
  let open: number | null = null;
  for (let index = 0; index < content.length - 1; index += 1) {
    if (
      content[index] !== "|" ||
      content[index + 1] !== "|" ||
      contains(index, excluded) ||
      contains(index + 1, excluded)
    )
      continue;
    if (open === null) open = index;
    else {
      ranges.push({ start: open, end: index + 2 });
      open = null;
    }
    index += 1;
  }
  return ranges;
}

function maskRanges(content: string, ranges: HiddenRange[]) {
  const merged: HiddenRange[] = [];
  for (const range of [...ranges].sort(
    (left, right) => left.start - right.start,
  )) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end)
      last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  let masked = "";
  let cursor = 0;
  for (const range of merged) {
    masked += content.slice(cursor, range.start);
    masked += content.slice(range.start, range.end).replace(/[^\n]/gu, " ");
    cursor = range.end;
  }
  return masked + content.slice(cursor);
}

function searchableContent(content: string) {
  const code = collectCodeRanges(content);
  const images = collectImageRanges(content);
  const hidden = [...code, ...images];
  const blocks = collectBlockSpoilers(content, hidden);
  const inline = collectInlineSpoilers(content, [...hidden, ...blocks]);
  return maskRanges(content, [...hidden, ...blocks, ...inline]);
}

function trimUrlCandidate(candidate: string) {
  let value = candidate.replace(/[.,!?;:]+$/gu, "");
  for (let changed = true; changed; ) {
    changed = false;
    for (const [close, open] of [
      [")", "("],
      ["]", "["],
      ["}", "{"],
    ]) {
      if (
        value.endsWith(close) &&
        [...value].filter((character) => character === close).length >
          [...value].filter((character) => character === open).length
      ) {
        value = value.slice(0, -1);
        changed = true;
      }
    }
  }
  return value;
}

function decode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function preview(
  kind: SupportedLinkPreviewKind,
  parsed: URL,
  provider: SupportedLinkPreview["provider"],
  typeLabel: SupportedLinkPreview["typeLabel"],
  title: string,
): SupportedLinkPreview {
  return { kind, href: parsed.href, provider, title, typeLabel };
}

function parseGithub(parsed: URL): SupportedLinkPreview | null {
  if (parsed.hostname.toLowerCase().replace(/^www\./u, "") !== "github.com")
    return null;
  const [owner, repo, resource, number] = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map(decode);
  if (!owner || !repo) return null;
  const title = `${owner}/${repo}`;
  if (resource === undefined)
    return preview("github-repository", parsed, "GitHub", "repo", title);
  if (!/^\d+$/u.test(number ?? "")) return null;
  if (resource === "pull")
    return preview(
      "github-pull-request",
      parsed,
      "GitHub",
      "PR",
      `${title} #${number}`,
    );
  if (resource === "issues")
    return preview(
      "github-issue",
      parsed,
      "GitHub",
      "issue",
      `${title} #${number}`,
    );
  return null;
}

function parseLinear(parsed: URL): SupportedLinkPreview | null {
  if (parsed.hostname.toLowerCase().replace(/^www\./u, "") !== "linear.app")
    return null;
  const segments = parsed.pathname.split("/").filter(Boolean).map(decode);
  const issueIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "issue",
  );
  const issue = segments[issueIndex + 1]?.toUpperCase();
  if (
    !segments[0] ||
    issueIndex < 1 ||
    !issue ||
    !/^[A-Z][A-Z0-9]*-\d+$/u.test(issue)
  )
    return null;
  return preview("linear-issue", parsed, "Linear", "issue", issue);
}

function parseGoogle(parsed: URL): SupportedLinkPreview | null {
  const hostname = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (hostname === "drive.google.com") {
    const folders = segments.findIndex(
      (segment) => segment.toLowerCase() === "folders",
    );
    if (folders >= 0 && segments[folders + 1])
      return preview(
        "google-drive-folder",
        parsed,
        "Google Drive",
        "folder",
        "Drive folder",
      );
    if (
      (segments[0] === "file" && segments[1] === "d" && segments[2]) ||
      (segments[0] === "open" && parsed.searchParams.has("id"))
    )
      return preview(
        "google-drive-file",
        parsed,
        "Google Drive",
        "file",
        "Drive file",
      );
    return null;
  }
  if (hostname !== "docs.google.com" || segments[1] !== "d" || !segments[2])
    return null;
  if (segments[0] === "document")
    return preview(
      "google-docs-document",
      parsed,
      "Google Docs",
      "document",
      "Document",
    );
  if (segments[0] === "spreadsheets")
    return preview(
      "google-sheets-spreadsheet",
      parsed,
      "Google Sheets",
      "spreadsheet",
      "Spreadsheet",
    );
  if (segments[0] === "presentation")
    return preview(
      "google-slides-presentation",
      parsed,
      "Google Slides",
      "presentation",
      "Presentation",
    );
  return null;
}

export function parseSupportedLinkPreview(
  href: string,
): SupportedLinkPreview | null {
  let parsed: URL;
  try {
    const candidate = trimUrlCandidate(href);
    parsed = new URL(
      /^https?:\/\//iu.test(candidate) ? candidate : `https://${candidate}`,
    );
  } catch {
    return null;
  }
  if (!/^https?:$/u.test(parsed.protocol)) return null;
  return parseGithub(parsed) ?? parseLinear(parsed) ?? parseGoogle(parsed);
}

export function isSupportedLinkAutolinkLabel(
  label: string,
  candidate: SupportedLinkPreview,
) {
  return parseSupportedLinkPreview(label)?.href === candidate.href;
}

function customTitle(label: string, candidate: SupportedLinkPreview) {
  const title = label.replace(/\s+/gu, " ").trim();
  return !title || isSupportedLinkAutolinkLabel(title, candidate)
    ? null
    : title;
}

export function extractSupportedLinkPreviews(
  content: string,
): SupportedLinkPreview[] {
  const searchable = searchableContent(content);
  const candidates: Array<{
    href: string;
    index: number;
    label?: string;
    order: number;
  }> = [];
  let order = 0;
  for (const match of searchable.matchAll(MARKDOWN_SUPPORTED_LINK_RE)) {
    if (match[0].startsWith("!")) continue;
    candidates.push({
      href: match[2],
      index: match.index ?? 0,
      label: match[1],
      order: order++,
    });
  }
  for (const match of searchable.matchAll(SUPPORTED_URL_RE)) {
    if (!match[2]) continue;
    candidates.push({
      href: match[2],
      index: (match.index ?? 0) + (match[1]?.length ?? 0),
      order: order++,
    });
  }
  candidates.sort(
    (left, right) => left.index - right.index || left.order - right.order,
  );
  const result: SupportedLinkPreview[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const parsed = parseSupportedLinkPreview(candidate.href);
    if (!parsed || seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    const title = candidate.label ? customTitle(candidate.label, parsed) : null;
    result.push(title ? { ...parsed, title } : parsed);
    if (result.length >= MAX_PREVIEWS) break;
  }
  return result;
}
