import {
  buildOutgoingAttachmentContent,
  type AttachmentMarkdownMedia,
} from "@/features/channels/attachment-markdown";
import {
  mediaImetaTag,
  type UploadedMedia,
} from "@/features/channels/channel-api";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";

export type FeedbackCategory = "bug" | "praise" | "needs-work";

export type ProductFeedbackAttachment = {
  filename: string;
  media: UploadedMedia;
};

export type ProductFeedbackInput = {
  category: FeedbackCategory | null;
  message: string;
};

export function buildProductFeedbackEvent(
  input: ProductFeedbackInput,
  attachments: ProductFeedbackAttachment[],
) {
  const markdownAttachments: AttachmentMarkdownMedia[] = attachments.map(
    ({ filename, media }) => ({
      filename,
      type: media.type,
      url: media.url,
    }),
  );
  return {
    content: buildOutgoingAttachmentContent(
      input.message.trim(),
      markdownAttachments,
      new Set(),
    ),
    tags: [
      ...(input.category ? [["category", input.category]] : []),
      ...attachments.map(({ filename, media }) =>
        mediaImetaTag(media, filename),
      ),
    ],
  };
}

export async function collectFeedbackDiagnostics() {
  let deploymentVersion = "unknown";
  try {
    const response = await fetch(`${relayHttpBaseUrl()}/info`, {
      headers: { Accept: "application/nostr+json" },
    });
    const info = (await response.json().catch(() => null)) as {
      build?: unknown;
      version?: unknown;
    } | null;
    if (response.ok && typeof info?.version === "string") {
      deploymentVersion =
        typeof info.build === "string"
          ? `${info.version} (${info.build})`
          : info.version;
    }
  } catch {
    // Diagnostics are optional and remain useful without a version response.
  }
  return [
    "Buzz Web feedback diagnostics",
    `captured: ${new Date().toISOString()}`,
    `deployment version: ${deploymentVersion}`,
    `origin: ${window.location.origin}`,
    `platform: ${navigator.platform || "unknown"}`,
    `user agent: ${navigator.userAgent || "unknown"}`,
    `language: ${navigator.language || "unknown"}`,
  ].join("\n");
}

export async function submitProductFeedback(
  input: ProductFeedbackInput,
  attachments: ProductFeedbackAttachment[],
) {
  const event = buildProductFeedbackEvent(input, attachments);
  if (!event.content.trim()) throw new Error("Enter feedback before sending.");
  if (new TextEncoder().encode(event.content).length > 32 * 1024) {
    throw new Error("Feedback is limited to 32 KB.");
  }
  await submitEvent({ kind: 42000, ...event });
}
