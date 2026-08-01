import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import {
  nip44DecryptFromSelf,
  nip44EncryptToSelf,
} from "@/shared/lib/nostr-signer";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";

export const CHANNEL_TEMPLATE_KIND = 30078;
const TEMPLATE_PREFIX = "buzz-web:channel-template:";

export type ChannelTemplate = {
  id: string;
  eventId: string;
  createdAt: number;
  name: string;
  description: string;
  channelType: "stream" | "forum";
  visibility: "open" | "private";
  canvasTemplate: string;
  personaIds: string[];
  teamIds: string[];
};

export type ChannelTemplateInput = Omit<
  ChannelTemplate,
  "id" | "eventId" | "createdAt"
>;

function firstTag(event: NostrEvent, name: string) {
  const tags = event.tags.filter((tag) => tag[0] === name);
  return tags.length === 1 ? tags[0][1] : undefined;
}

function validIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (id) =>
        typeof id === "string" &&
        id.length > 0 &&
        id.length <= 64 &&
        !/\s/u.test(id),
    )
  );
}

async function parseTemplate(
  event: NostrEvent,
): Promise<ChannelTemplate | null> {
  const coordinate = firstTag(event, "d");
  if (!coordinate?.startsWith(TEMPLATE_PREFIX)) return null;
  const id = coordinate.slice(TEMPLATE_PREFIX.length);
  if (!/^[a-f0-9]{32}$/u.test(id)) return null;
  try {
    const content = JSON.parse(
      await nip44DecryptFromSelf(event.content),
    ) as Record<string, unknown>;
    const name = content.name;
    const description = content.description;
    const channelType = content.channel_type;
    const visibility = content.visibility;
    const canvasTemplate = content.canvas_template;
    const personaIds = content.persona_ids;
    const teamIds = content.team_ids;
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 120 ||
      typeof description !== "string" ||
      description.length > 2_000 ||
      !["stream", "forum"].includes(channelType as string) ||
      !["open", "private"].includes(visibility as string) ||
      typeof canvasTemplate !== "string" ||
      canvasTemplate.length > 128 * 1024 ||
      !validIds(personaIds) ||
      !validIds(teamIds)
    )
      return null;
    return {
      id,
      eventId: event.id,
      createdAt: event.created_at,
      name: name.trim(),
      description,
      channelType: channelType as "stream" | "forum",
      visibility: visibility as "open" | "private",
      canvasTemplate,
      personaIds,
      teamIds,
    };
  } catch {
    return null;
  }
}

export async function listChannelTemplates(ownerPubkey: string) {
  const events = await queryEvents(
    relayWsUrl(),
    { kinds: [CHANNEL_TEMPLATE_KIND], authors: [ownerPubkey], limit: 500 },
    { requireNip07: true },
  );
  const heads = new Map<string, NostrEvent>();
  for (const event of events) {
    if (event.pubkey !== ownerPubkey) continue;
    const coordinate = firstTag(event, "d");
    if (!coordinate?.startsWith(TEMPLATE_PREFIX)) continue;
    const current = heads.get(coordinate);
    if (
      !current ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id < current.id)
    )
      heads.set(coordinate, event);
  }
  const parsed = await Promise.all([...heads.values()].map(parseTemplate));
  return parsed
    .filter((template): template is ChannelTemplate => template !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveChannelTemplate(
  input: ChannelTemplateInput,
  existing?: ChannelTemplate,
) {
  if (!input.name.trim() || input.name.length > 120)
    throw new Error("Enter a template name.");
  if (input.description.length > 2_000)
    throw new Error("Template descriptions are limited to 2,000 characters.");
  if (input.canvasTemplate.length > 128 * 1024)
    throw new Error("Canvas templates are limited to 128 KB.");
  if (input.personaIds.length > 100 || input.teamIds.length > 100)
    throw new Error("A template can include at most 100 personas and teams.");
  const id = existing?.id ?? crypto.randomUUID().replace(/-/gu, "");
  const plaintext = JSON.stringify({
    name: input.name.trim(),
    description: input.description.trim(),
    channel_type: input.channelType,
    visibility: input.visibility,
    canvas_template: input.canvasTemplate,
    persona_ids: [...new Set(input.personaIds)],
    team_ids: [...new Set(input.teamIds)],
  });
  const content = await nip44EncryptToSelf(plaintext);
  await submitEvent({
    kind: CHANNEL_TEMPLATE_KIND,
    created_at: existing
      ? Math.max(Math.floor(Date.now() / 1000), existing.createdAt + 1)
      : undefined,
    tags: [
      ["d", `${TEMPLATE_PREFIX}${id}`],
      ["alt", "encrypted channel template"],
    ],
    content,
  });
}

export async function deleteChannelTemplate(
  ownerPubkey: string,
  template: ChannelTemplate,
) {
  await submitEvent({
    kind: 5,
    tags: [
      [
        "a",
        `${CHANNEL_TEMPLATE_KIND}:${ownerPubkey}:${TEMPLATE_PREFIX}${template.id}`,
      ],
      ["k", String(CHANNEL_TEMPLATE_KIND)],
    ],
    content: "",
  });
}

export async function setChannelCanvas(channelId: string, content: string) {
  if (!/^[0-9a-f-]{36}$/iu.test(channelId))
    throw new Error("The relay returned an invalid channel identifier.");
  if (content.length > 128 * 1024)
    throw new Error("Canvas content is limited to 128 KB.");
  await submitEvent({ kind: 40100, tags: [["h", channelId]], content });
}

export function renderCanvasTemplate(
  template: ChannelTemplate,
  channelName: string,
) {
  return template.canvasTemplate
    .replace(/\{channel\.name\}/gu, channelName)
    .replace(/\{template\.name\}/gu, template.name);
}
