type MdastNode = {
  children?: MdastNode[];
  data?: Record<string, unknown>;
  type: string;
  value?: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionPattern(names: readonly string[]): RegExp {
  const alternatives = [...new Set(names)]
    .filter((name) => name.trim())
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  if (!alternatives) return /(?!)/giu;
  return new RegExp(`@(?:${alternatives})(?=[\\s,;.!?:)\\]}]|$)`, "giu");
}

function splitText(value: string, pattern: RegExp): MdastNode[] {
  pattern.lastIndex = 0;
  const nodes: MdastNode[] = [];
  let cursor = 0;
  for (let match = pattern.exec(value); match; ) {
    if (match.index > cursor)
      nodes.push({ type: "text", value: value.slice(cursor, match.index) });
    nodes.push({
      type: "mention",
      value: match[0],
      data: {
        hName: "mention",
        hChildren: [{ type: "text", value: match[0] }],
      },
    });
    cursor = match.index + match[0].length;
    match = pattern.exec(value);
  }
  if (!nodes.length) return [{ type: "text", value }];
  if (cursor < value.length)
    nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes;
}

function transformChildren(node: MdastNode, pattern: RegExp): void {
  if (!node.children || ["code", "inlineCode", "link"].includes(node.type))
    return;
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index];
    if (child.type === "text" && child.value !== undefined) {
      const replacement = splitText(child.value, pattern);
      if (replacement.length > 1 || replacement[0].type !== "text")
        node.children.splice(index, 1, ...replacement);
    } else {
      transformChildren(child, pattern);
    }
  }
}

export default function remarkMentions(options?: { mentionNames?: string[] }) {
  const pattern = mentionPattern(options?.mentionNames ?? []);
  return (tree: MdastNode) => transformChildren(tree, pattern);
}
