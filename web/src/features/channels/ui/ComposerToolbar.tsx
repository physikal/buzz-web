import {
  ALargeSmall,
  AtSign,
  Bold,
  Code,
  Italic,
  Link,
  List,
  ListOrdered,
  Paperclip,
  Quote,
  SmilePlus,
  Strikethrough,
} from "lucide-react";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";

import type { CustomEmoji } from "@/features/settings/custom-emoji-api";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { wrapComposerSelection } from "../composer-edit";
import type { DmCandidate } from "../dm-candidates";

const COMMON_EMOJI = ["😀", "😂", "❤️", "👍", "🎉", "👀", "🚀", "✅"];

export function ComposerToolbar({
  customEmoji,
  disabled,
  mentionCandidates,
  onAttach,
  onValueChange,
  textareaRef,
  value,
}: {
  customEmoji: CustomEmoji[];
  disabled: boolean;
  mentionCandidates: DmCandidate[];
  onAttach: () => void;
  onValueChange: (
    value: string,
    selection: number,
    selectedMention?: DmCandidate,
  ) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
}) {
  const [panel, setPanel] = useState<"format" | "mention" | "emoji" | null>(
    null,
  );
  const [mentionQuery, setMentionQuery] = useState("");
  const pendingSelectionRef = useRef<{
    content: string;
    end: number;
    start: number;
  } | null>(null);

  useLayoutEffect(() => {
    const pendingSelection = pendingSelectionRef.current;
    const textarea = textareaRef.current;
    if (
      !pendingSelection ||
      value !== pendingSelection.content ||
      textarea?.value !== pendingSelection.content
    )
      return;
    pendingSelectionRef.current = null;
    textarea.focus();
    textarea.setSelectionRange(pendingSelection.start, pendingSelection.end);
  }, [textareaRef, value]);

  const replaceSelection = (
    content: string,
    selectionStart: number,
    selectionEnd: number,
    selectedMention?: DmCandidate,
  ) => {
    pendingSelectionRef.current = {
      content,
      end: selectionEnd,
      start: selectionStart,
    };
    onValueChange(content, selectionEnd, selectedMention);
  };
  const insert = (text: string, selectedMention?: DmCandidate) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? start;
    const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
    replaceSelection(
      next,
      start + text.length,
      start + text.length,
      selectedMention,
    );
  };
  const wrap = (before: string, after: string, placeholder: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? start;
    const edit = wrapComposerSelection(
      value,
      start,
      end,
      before,
      after,
      placeholder,
    );
    replaceSelection(edit.value, edit.selectionStart, edit.selectionEnd);
  };
  const prefixLines = (prefix: string, ordered = false) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? start;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const nextLine = value.indexOf("\n", end);
    const lineEnd = nextLine === -1 ? value.length : nextLine;
    const source = value.slice(lineStart, lineEnd) || "List item";
    const replacement = source
      .split("\n")
      .map((line, index) => `${ordered ? `${index + 1}. ` : prefix}${line}`)
      .join("\n");
    const next = `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`;
    replaceSelection(next, lineStart, lineStart + replacement.length);
  };

  const visibleMentions = mentionCandidates
    .filter((candidate) =>
      candidate.displayName
        .toLowerCase()
        .includes(mentionQuery.trim().toLowerCase()),
    )
    .slice(0, 20);

  return (
    <div className="relative flex min-w-0 items-center gap-1">
      {panel ? (
        <div className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-[min(24rem,calc(100vw-3rem))] overflow-y-auto rounded-md border bg-popover p-2 text-popover-foreground shadow-lg">
          {panel === "format" ? (
            <div className="flex flex-wrap gap-1">
              <ToolButton
                label="Bold"
                onClick={() => wrap("**", "**", "bold text")}
              >
                <Bold />
              </ToolButton>
              <ToolButton
                label="Italic"
                onClick={() => wrap("_", "_", "italic text")}
              >
                <Italic />
              </ToolButton>
              <ToolButton
                label="Strikethrough"
                onClick={() => wrap("~~", "~~", "text")}
              >
                <Strikethrough />
              </ToolButton>
              <ToolButton
                label="Inline code"
                onClick={() => wrap("`", "`", "code")}
              >
                <Code />
              </ToolButton>
              <ToolButton
                label="Link"
                onClick={() => wrap("[", "](https://)", "link text")}
              >
                <Link />
              </ToolButton>
              <ToolButton
                label="Bulleted list"
                onClick={() => prefixLines("- ")}
              >
                <List />
              </ToolButton>
              <ToolButton
                label="Numbered list"
                onClick={() => prefixLines("", true)}
              >
                <ListOrdered />
              </ToolButton>
              <ToolButton label="Quote" onClick={() => prefixLines("> ")}>
                <Quote />
              </ToolButton>
              <ToolButton
                label="Code block"
                onClick={() => wrap("```\n", "\n```", "code")}
              >
                <Code />
              </ToolButton>
              <ToolButton
                label="Spoiler"
                onClick={() => wrap("||", "||", "spoiler")}
              >
                <span className="text-xs font-semibold">SP</span>
              </ToolButton>
            </div>
          ) : panel === "mention" ? (
            <>
              <Input
                aria-label="Find someone to mention"
                autoFocus
                placeholder="Find someone"
                value={mentionQuery}
                onChange={(event) => setMentionQuery(event.target.value)}
              />
              <div className="mt-2">
                {visibleMentions.map((candidate) => (
                  <button
                    aria-label={`Mention ${candidate.displayName}`}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted"
                    key={candidate.pubkey}
                    onClick={() => {
                      insert(`@${candidate.displayName} `, candidate);
                      setMentionQuery("");
                      setPanel(null);
                    }}
                    type="button"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {candidate.displayName}
                    </span>
                    {candidate.isAgent ? (
                      <span className="text-xs text-muted-foreground">
                        agent
                      </span>
                    ) : null}
                  </button>
                ))}
                {!visibleMentions.length ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No matches
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-6 gap-1">
              {COMMON_EMOJI.map((emoji) => (
                <button
                  aria-label={`Insert ${emoji}`}
                  className="flex h-10 items-center justify-center rounded text-lg hover:bg-muted"
                  key={emoji}
                  onClick={() => {
                    insert(emoji);
                    setPanel(null);
                  }}
                  type="button"
                >
                  {emoji}
                </button>
              ))}
              {customEmoji.map((emoji) => (
                <button
                  aria-label={`Insert :${emoji.shortcode}:`}
                  className="flex h-10 items-center justify-center rounded hover:bg-muted"
                  key={emoji.shortcode}
                  onClick={() => {
                    insert(`:${emoji.shortcode}:`);
                    setPanel(null);
                  }}
                  title={`:${emoji.shortcode}:`}
                  type="button"
                >
                  <img
                    alt=""
                    className="h-6 w-6 object-contain"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    src={emoji.url}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
      <Button
        aria-label="Mention someone"
        disabled={disabled}
        onClick={() => setPanel(panel === "mention" ? null : "mention")}
        size="icon"
        title="Mention someone"
        type="button"
        variant="ghost"
      >
        <AtSign />
      </Button>
      <Button
        aria-label="Attach files"
        disabled={disabled}
        onClick={onAttach}
        size="icon"
        title="Attach files"
        type="button"
        variant="ghost"
      >
        <Paperclip />
      </Button>
      <Button
        aria-label="Insert emoji"
        disabled={disabled}
        onClick={() => setPanel(panel === "emoji" ? null : "emoji")}
        size="icon"
        title="Insert emoji"
        type="button"
        variant="ghost"
      >
        <SmilePlus />
      </Button>
      <Button
        aria-label="Toggle formatting"
        aria-pressed={panel === "format"}
        disabled={disabled}
        onClick={() => setPanel(panel === "format" ? null : "format")}
        size="icon"
        title="Formatting"
        type="button"
        variant={panel === "format" ? "secondary" : "ghost"}
      >
        <ALargeSmall />
      </Button>
    </div>
  );
}

function ToolButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      onClick={onClick}
      size="icon"
      title={label}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  );
}
