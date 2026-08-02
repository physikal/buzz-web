import { Bot, Check, Library, X } from "lucide-react";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import type { AgentPersona } from "../persona-api";
import type { CatalogPersona } from "../persona-catalog-api";

export function PersonaCatalogDialog({
  catalog,
  error,
  importing,
  loading,
  localPersonas,
  onClose,
  onImport,
}: {
  catalog: CatalogPersona[];
  error: string | null;
  importing: boolean;
  loading: boolean;
  localPersonas: AgentPersona[];
  onClose: () => void;
  onImport: (persona: CatalogPersona) => void;
}) {
  const [selectedId, setSelectedId] = useState(catalog[0]?.id ?? null);
  const selected =
    catalog.find((persona) => persona.id === selectedId) ?? catalog[0] ?? null;
  const imported = useMemo(
    () =>
      new Set(
        localPersonas
          .filter((persona) => persona.catalogSource)
          .map(
            (persona) =>
              `${persona.catalogSource?.ownerPubkey}:${persona.catalogSource?.personaId}`,
          ),
      ),
    [localPersonas],
  );
  const selectedImported = selected
    ? selected.sourceIsOwn
      ? localPersonas.some((persona) => persona.id === selected.sourcePersonaId)
      : imported.has(
          `${selected.sourceOwnerPubkey}:${selected.sourcePersonaId}`,
        )
    : false;

  return (
    <div
      aria-label="Agent catalog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="flex h-[min(42rem,88dvh)] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-background shadow-2xl">
        <header className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Library className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Agent catalog</h2>
          </div>
          <Button
            aria-label="Close"
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        {loading ? (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
            Loading catalog…
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-destructive">
            {error}
          </div>
        ) : catalog.length ? (
          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[220px_minmax(0,1fr)] sm:grid-rows-1">
            <aside className="max-h-44 overflow-y-auto border-b p-2 sm:max-h-none sm:border-r sm:border-b-0">
              {catalog.map((persona) => (
                <button
                  aria-current={
                    selected?.id === persona.id ? "true" : undefined
                  }
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${selected?.id === persona.id ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent"}`}
                  key={persona.id}
                  onClick={() => setSelectedId(persona.id)}
                  type="button"
                >
                  <CatalogAvatar persona={persona} />
                  <span className="truncate">{persona.displayName}</span>
                </button>
              ))}
            </aside>
            {selected ? (
              <div className="min-h-0 overflow-y-auto p-6">
                <div className="flex items-center gap-3">
                  <CatalogAvatar large persona={selected} />
                  <div className="min-w-0">
                    <h3 className="truncate text-xl font-semibold">
                      {selected.displayName}
                    </h3>
                    <p className="font-mono text-xs text-muted-foreground">
                      {truncatePubkey(selected.sourceOwnerPubkey)}
                    </p>
                  </div>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <Metadata
                    label="Harness"
                    value={runtimeLabel(selected.runtime)}
                  />
                  <Metadata
                    label="Model"
                    value={selected.model || "Automatic"}
                  />
                  <Metadata
                    label="Access"
                    value={
                      selected.respondTo === "anyone" ? "Anyone" : "Only me"
                    }
                  />
                </dl>
                <div className="prose prose-sm mt-6 max-w-none dark:prose-invert">
                  <ReactMarkdown
                    components={{
                      a: ({ children }) => (
                        <span className="font-medium text-current">
                          {children}
                        </span>
                      ),
                      img: ({ alt }) => (
                        <span>{alt?.trim() || "Image attachment"}</span>
                      ),
                    }}
                    remarkPlugins={[remarkGfm]}
                  >
                    {selected.systemPrompt || "No instructions."}
                  </ReactMarkdown>
                </div>
                <div className="mt-6 flex justify-end">
                  <Button
                    disabled={selectedImported || importing}
                    onClick={() => onImport(selected)}
                  >
                    {selectedImported ? <Check /> : <Library />}
                    {selectedImported ? "Added" : "Add to My Agents"}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
            No shared personas yet.
          </div>
        )}
      </div>
    </div>
  );
}

function CatalogAvatar({
  persona,
  large = false,
}: {
  persona: CatalogPersona;
  large?: boolean;
}) {
  const size = large ? "h-12 w-12" : "h-7 w-7";
  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary`}
    >
      {persona.avatarUrl ? (
        <img
          alt=""
          className="h-full w-full object-cover"
          src={persona.avatarUrl}
        />
      ) : (
        <Bot className={large ? "h-6 w-6" : "h-4 w-4"} />
      )}
    </span>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-l pl-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}

function runtimeLabel(runtime: AgentPersona["runtime"]) {
  if (runtime === "buzz-agent") return "Buzz Agent";
  if (runtime === "claude") return "Claude Code";
  if (runtime === "codex") return "Codex";
  return "Choose later";
}
