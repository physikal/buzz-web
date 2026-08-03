import { buildPrefixPattern, createRemarkPrefixPlugin } from "./remark-prefix";

export default function remarkMentions(options?: { mentionNames?: string[] }) {
  return createRemarkPrefixPlugin(
    buildPrefixPattern("@", options?.mentionNames ?? []),
    "mention",
  );
}
