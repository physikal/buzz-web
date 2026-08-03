/**
 * Turn chat-style spoiler spans (`||secret||`) into a custom element rendered
 * by the shared spoiler component. This mirrors desktop receive-side parsing.
 */
type MarkdownNode = {
  // Markdown AST nodes are deliberately structural so this plugin does not
  // need to couple the web bundle to unified's internal type packages.
  // biome-ignore lint/suspicious/noExplicitAny: mdast supports arbitrary data.
  [key: string]: any;
};

type Part = { type: "delimiter" } | { type: "node"; node: MarkdownNode };

export default function remarkSpoilers() {
  return (tree: MarkdownNode) => transformNode(tree);
}

function transformNode(node: MarkdownNode) {
  if (!node?.children || !Array.isArray(node.children) || shouldSkipNode(node))
    return;

  for (const child of node.children) transformNode(child);
  node.children = groupBlockSpoilers(
    groupInlineSpoilers(node.children, node.type === "paragraph"),
  );
}

function groupInlineSpoilers(
  children: MarkdownNode[],
  rejectTableDelimiterRow: boolean,
) {
  const output: MarkdownNode[] = [];
  let spoilerBuffer: MarkdownNode[] | null = null;

  for (const part of splitDelimiterParts(children)) {
    if (part.type === "delimiter") {
      if (spoilerBuffer) {
        if (rejectTableDelimiterRow && isTableDelimiterRow(spoilerBuffer)) {
          output.push({ type: "text", value: "||" }, ...spoilerBuffer, {
            type: "text",
            value: "||",
          });
        } else output.push(buildSpoilerNode(spoilerBuffer));
        spoilerBuffer = null;
      } else spoilerBuffer = [];
      continue;
    }
    if (spoilerBuffer) spoilerBuffer.push(part.node);
    else output.push(part.node);
  }

  if (spoilerBuffer)
    output.push({ type: "text", value: "||" }, ...spoilerBuffer);
  return output;
}

function splitDelimiterParts(children: MarkdownNode[]): Part[] {
  const parts: Part[] = [];
  for (const child of children) {
    if (child.type !== "text") {
      parts.push({ type: "node", node: child });
      continue;
    }
    const text = String(child.value ?? "");
    let cursor = 0;
    while (cursor < text.length) {
      const delimiterIndex = text.indexOf("||", cursor);
      if (delimiterIndex === -1) {
        const value = text.slice(cursor);
        if (value) parts.push({ type: "node", node: { ...child, value } });
        break;
      }
      const before = text.slice(cursor, delimiterIndex);
      if (before)
        parts.push({ type: "node", node: { ...child, value: before } });
      parts.push({ type: "delimiter" });
      cursor = delimiterIndex + 2;
    }
  }
  return parts;
}

function isTableDelimiterRow(children: MarkdownNode[]) {
  if (children.some((child) => child.type !== "text")) return false;
  const value = children.map((child) => String(child.value ?? "")).join("");
  return /^\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+\s*$/u.test(value);
}

function buildSpoilerNode(
  children: MarkdownNode[],
  options: { block?: boolean } = {},
): MarkdownNode {
  return {
    type: "spoiler",
    children,
    data: {
      hName: "spoiler",
      ...(options.block ? { hProperties: { "data-block-spoiler": "" } } : {}),
    },
  };
}

function groupBlockSpoilers(children: MarkdownNode[]) {
  const output: MarkdownNode[] = [];
  let spoilerBuffer: MarkdownNode[] | null = null;
  let openingDelimiter: MarkdownNode | null = null;
  for (const child of children) {
    if (isBlockDelimiter(child)) {
      if (spoilerBuffer) {
        output.push(buildSpoilerNode(spoilerBuffer, { block: true }));
        spoilerBuffer = null;
        openingDelimiter = null;
      } else {
        spoilerBuffer = [];
        openingDelimiter = child;
      }
      continue;
    }
    if (spoilerBuffer) spoilerBuffer.push(child);
    else output.push(child);
  }
  if (spoilerBuffer) {
    if (openingDelimiter) output.push(openingDelimiter);
    output.push(...spoilerBuffer);
  }
  return output;
}

function isBlockDelimiter(node: MarkdownNode) {
  return (
    node.type === "paragraph" &&
    Array.isArray(node.children) &&
    node.children.length === 1 &&
    node.children[0]?.type === "text" &&
    String(node.children[0].value ?? "").trim() === "||"
  );
}

function shouldSkipNode(node: MarkdownNode) {
  return node.type === "code" || node.type === "inlineCode";
}
