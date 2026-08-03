import { buildPrefixPattern, createRemarkPrefixPlugin } from "./remark-prefix";

export default function remarkChannelLinks(options?: {
  channelNames?: string[];
}) {
  return createRemarkPrefixPlugin(
    buildPrefixPattern("#", options?.channelNames ?? [], true),
    "channel-link",
  );
}
