type MdastNode = {
  children?: MdastNode[];
  data?: Record<string, unknown>;
  type: string;
  value?: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildPrefixPattern(
  prefix: string,
  names: readonly string[],
  fallbackToGeneric = false,
): RegExp {
  const alternatives = [...new Set(names)]
    .filter((name) => name.trim())
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  if (!alternatives)
    return fallbackToGeneric
      ? new RegExp(`${escapeRegExp(prefix)}\\S+`, "giu")
      : /(?!)/giu;
  return new RegExp(
    `${escapeRegExp(prefix)}(?:${alternatives})(?=[\\s,;.!?:)\\]}]|$)`,
    "giu",
  );
}

function splitText(
  value: string,
  pattern: RegExp,
  elementName: string,
): MdastNode[] {
  pattern.lastIndex = 0;
  const nodes: MdastNode[] = [];
  let cursor = 0;
  for (let match = pattern.exec(value); match; ) {
    if (match.index > cursor)
      nodes.push({ type: "text", value: value.slice(cursor, match.index) });
    nodes.push({
      type: elementName,
      value: match[0],
      data: {
        hName: elementName,
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

function transformChildren(
  node: MdastNode,
  pattern: RegExp,
  elementName: string,
): void {
  if (!node.children || ["code", "inlineCode", "link"].includes(node.type))
    return;
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index];
    if (child.type === "text" && child.value !== undefined) {
      const replacement = splitText(child.value, pattern, elementName);
      if (replacement.length > 1 || replacement[0].type !== "text")
        node.children.splice(index, 1, ...replacement);
    } else {
      transformChildren(child, pattern, elementName);
    }
  }
}

export function createRemarkPrefixPlugin(pattern: RegExp, elementName: string) {
  return (tree: MdastNode) => transformChildren(tree, pattern, elementName);
}
