import {
  AlertCircle,
  Bot,
  Brain,
  CheckCircle2,
  CircleDot,
  Clock3,
  Code2,
  FilePenLine,
  FileSearch,
  Image,
  ListChecks,
  MessageSquare,
  Radio,
  ShieldAlert,
  TerminalSquare,
  User,
  Wrench,
  XCircle,
} from "lucide-react";
import type { ComponentType } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/shared/lib/cn";
import type {
  AgentActivityRenderClass,
  ToolStatus as ToolStatusValue,
  TranscriptItem,
} from "./agentSessionTypes";
import { formatTranscriptTime } from "./agentSessionUtils";

export function AgentSessionTranscriptView({
  items,
}: {
  items: TranscriptItem[];
}) {
  if (!items.length) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
        <Radio className="h-4 w-4 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">No ACP activity yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Mention this agent in a channel to watch the next turn.
        </p>
      </div>
    );
  }

  return (
    <div
      aria-label="Live ACP transcript"
      aria-live="polite"
      className="space-y-4"
      role="log"
    >
      {items.map((item) => (
        <TranscriptRow item={item} key={item.id} />
      ))}
    </div>
  );
}

function TranscriptRow({ item }: { item: TranscriptItem }) {
  if (item.type === "message") return <MessageRow item={item} />;
  if (item.type === "tool") return <ToolRow item={item} />;
  if (item.type === "metadata") return <MetadataRow item={item} />;

  const Icon =
    item.type === "thought"
      ? Brain
      : item.type === "plan"
        ? ListChecks
        : item.renderClass === "permission"
          ? ShieldAlert
          : item.renderClass === "error"
            ? AlertCircle
            : CircleDot;
  const text = item.text.trim();
  return (
    <div className="flex gap-3" data-transcript-type={item.type}>
      <RowIcon Icon={Icon} error={item.renderClass === "error"} />
      <div className="min-w-0 flex-1 pt-0.5">
        <RowHeader timestamp={item.timestamp} title={item.title} />
        {text ? <MarkdownText className="mt-1" text={text} /> : null}
        {item.type === "lifecycle" && item.outcome ? (
          <p className="mt-1 text-xs font-medium text-muted-foreground">
            {item.outcome}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function MessageRow({
  item,
}: {
  item: Extract<TranscriptItem, { type: "message" }>;
}) {
  const assistant = item.role === "assistant";
  return (
    <div className="flex gap-3" data-transcript-type="message">
      <RowIcon Icon={assistant ? Bot : User} />
      <div
        className={cn(
          "min-w-0 flex-1 pt-0.5",
          !assistant &&
            "rounded-md border border-border/60 bg-muted/25 px-3 py-2",
        )}
      >
        <RowHeader
          timestamp={item.timestamp}
          title={
            assistant ? item.title || "Assistant" : item.title || "User prompt"
          }
        />
        <MarkdownText className="mt-1" text={item.text} />
      </div>
    </div>
  );
}

function ToolRow({
  item,
}: {
  item: Extract<TranscriptItem, { type: "tool" }>;
}) {
  const Icon = iconForRenderClass(item.renderClass);
  const failed = item.isError || item.status === "failed";
  const preview = item.descriptor.preview?.trim();
  return (
    <div className="flex gap-3" data-transcript-type="tool">
      <RowIcon Icon={Icon} error={failed} />
      <details className="group min-w-0 flex-1 pt-0.5">
        <summary className="cursor-pointer list-none select-none">
          <div className="flex min-w-0 items-center gap-2">
            <strong className="truncate text-sm font-medium">
              {item.descriptor.label || item.title}
            </strong>
            <ToolStatusDisplay status={item.status} failed={failed} />
            <RowTime timestamp={item.timestamp} />
          </div>
          {preview ? (
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {preview}
            </p>
          ) : null}
        </summary>
        <div className="mt-2 space-y-2 border-l border-border/70 pl-3">
          {Object.keys(item.args).length ? (
            <CodeBlock
              label="Input"
              value={JSON.stringify(item.args, null, 2)}
            />
          ) : null}
          {item.result ? (
            <CodeBlock
              label={failed ? "Error" : "Output"}
              value={item.result}
            />
          ) : null}
        </div>
      </details>
    </div>
  );
}

function MetadataRow({
  item,
}: {
  item: Extract<TranscriptItem, { type: "metadata" }>;
}) {
  return (
    <div className="flex gap-3" data-transcript-type="metadata">
      <RowIcon Icon={Code2} />
      <details className="group min-w-0 flex-1 pt-0.5">
        <summary className="cursor-pointer list-none select-none">
          <RowHeader timestamp={item.timestamp} title={item.title} />
        </summary>
        <div className="mt-2 space-y-3 border-l border-border/70 pl-3">
          {item.sections.map((section) => (
            <CodeBlock
              key={`${section.title}:${section.body}`}
              label={section.title}
              value={section.body}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

function RowHeader({ title, timestamp }: { title: string; timestamp: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <strong className="truncate text-sm font-medium">{title}</strong>
      <RowTime timestamp={timestamp} />
    </div>
  );
}

function RowTime({ timestamp }: { timestamp: string }) {
  const display = formatTranscriptTime(timestamp);
  return display ? (
    <time
      className="ml-auto shrink-0 text-xs text-muted-foreground"
      dateTime={timestamp}
    >
      {display}
    </time>
  ) : null;
}

function RowIcon({
  Icon,
  error = false,
}: {
  Icon: ComponentType<{ className?: string }>;
  error?: boolean;
}) {
  return (
    <span
      className={cn(
        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-background",
        error && "border-destructive/40 text-destructive",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

function MarkdownText({
  className,
  text,
}: {
  className?: string;
  text: string;
}) {
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none break-words text-foreground dark:prose-invert",
        className,
      )}
    >
      <ReactMarkdown
        components={{
          img: () => null,
          a: ({ children, ...props }) => (
            <a {...props} rel="noreferrer noopener" target="_blank">
              {children}
            </a>
          ),
        }}
        remarkPlugins={[remarkGfm]}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/50 bg-muted/25 p-2 font-mono text-xs leading-5">
        {value}
      </pre>
    </div>
  );
}

function ToolStatusDisplay({
  status,
  failed,
}: {
  status: ToolStatusValue;
  failed: boolean;
}) {
  const Icon = failed
    ? XCircle
    : status === "completed"
      ? CheckCircle2
      : status === "pending"
        ? CircleDot
        : Clock3;
  return (
    <Icon
      className={cn(
        "h-3.5 w-3.5 shrink-0 text-muted-foreground",
        failed && "text-destructive",
      )}
    />
  );
}

function iconForRenderClass(renderClass: AgentActivityRenderClass) {
  if (renderClass === "shell") return TerminalSquare;
  if (renderClass === "file-edit") return FilePenLine;
  if (renderClass === "file-read" || renderClass === "skill-read")
    return FileSearch;
  if (renderClass === "image") return Image;
  if (renderClass === "message" || renderClass === "relay-op")
    return MessageSquare;
  if (renderClass === "plan") return ListChecks;
  if (renderClass === "permission") return ShieldAlert;
  if (renderClass === "error") return AlertCircle;
  return Wrench;
}
