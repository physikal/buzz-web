import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Cpu } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { cn } from "@/shared/lib/cn";
import { Input } from "@/shared/ui/input";
import {
  type ComputeCatalog,
  type ComputeCatalogEntry,
  type ComputeDownloadProgress,
  type ComputeStatus,
  type ComputeUsage,
  getComputeCatalog,
  getComputeModels,
  getComputeStatus,
  getComputeUsage,
  startCompute,
  stopCompute,
} from "../compute-api";

const MODEL_DRAFT_STORAGE_KEY = "buzz.mesh-compute.share.model.v1";
const MAX_VRAM_DRAFT_STORAGE_KEY = "buzz.mesh-compute.share.max-vram-gb.v1";

function readDraft(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage is only a convenience; the current session remains usable.
  }
}

function validHostedModelRef(value: string): boolean {
  const model = value.trim();
  if (
    model.length === 0 ||
    new TextEncoder().encode(model).length > 512 ||
    model.startsWith("/") ||
    model.startsWith("~") ||
    model.startsWith("./") ||
    model.startsWith("../") ||
    model.endsWith("/") ||
    model.toLowerCase().endsWith(".gguf") ||
    model.includes("\\") ||
    model.includes("?") ||
    model.includes("#") ||
    /\s/.test(model)
  ) {
    return false;
  }

  const huggingFace = model.startsWith("hf://");
  if (!huggingFace && model.includes("://")) return false;
  const reference = huggingFace ? model.slice("hf://".length) : model;
  if (
    !reference ||
    reference.startsWith("/") ||
    reference.endsWith("/") ||
    reference.includes("//") ||
    reference
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..") ||
    !/^[A-Za-z0-9._/@:-]+$/.test(reference)
  ) {
    return false;
  }

  if (huggingFace) {
    return (
      reference.includes("/") &&
      !reference.includes(":") &&
      reference.split("@").length <= 2
    );
  }

  const colon = reference.indexOf(":");
  if (colon === -1) return reference.split("@").length <= 2;
  const suffix = reference.slice(colon + 1);
  return (
    reference.slice(0, colon).includes("/") &&
    suffix.length > 0 &&
    !/[/:@]/.test(suffix)
  );
}

export function MeshComputeSettingsPanel() {
  const queryClient = useQueryClient();
  const [modelInput, setModelInput] = useState(() =>
    readDraft(MODEL_DRAFT_STORAGE_KEY),
  );
  const [maxVramGb, setMaxVramGb] = useState(() =>
    readDraft(MAX_VRAM_DRAFT_STORAGE_KEY),
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["shared-compute", "status"],
    queryFn: getComputeStatus,
    retry: false,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "starting" ? 2_000 : 10_000;
    },
  });
  const catalogQuery = useQuery({
    queryKey: ["shared-compute", "catalog"],
    queryFn: getComputeCatalog,
    retry: false,
  });
  const modelsQuery = useQuery({
    queryKey: ["shared-compute", "models"],
    queryFn: getComputeModels,
    retry: false,
  });
  const status = statusQuery.data ?? null;
  const isSharing =
    status?.mode === "serve" &&
    ["starting", "running", "failed"].includes(status.state);
  const isConsuming =
    status?.mode === "client" &&
    ["starting", "running", "failed"].includes(status.state);
  const usageQuery = useQuery({
    queryKey: ["shared-compute", "usage"],
    queryFn: getComputeUsage,
    enabled: status?.state === "running" && status.mode === "serve",
    retry: false,
    refetchInterval: 3_000,
  });

  useEffect(() => {
    const currentModel = status?.mode === "serve" ? status.modelId : null;
    if (currentModel && currentModel !== modelInput) {
      setModelInput(currentModel);
      writeDraft(MODEL_DRAFT_STORAGE_KEY, currentModel);
    }
  }, [modelInput, status?.mode, status?.modelId]);

  useEffect(() => {
    const recommended = catalogQuery.data?.recommended;
    if (!modelInput.trim() && recommended) {
      setModelInput(recommended);
      writeDraft(MODEL_DRAFT_STORAGE_KEY, recommended);
    }
  }, [catalogQuery.data?.recommended, modelInput]);

  useEffect(() => {
    if (maxVramGb || status?.maxVramGb == null) return;
    const value = String(status.maxVramGb);
    setMaxVramGb(value);
    writeDraft(MAX_VRAM_DRAFT_STORAGE_KEY, value);
  }, [maxVramGb, status?.maxVramGb]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["shared-compute", "status"] }),
      queryClient.invalidateQueries({ queryKey: ["shared-compute", "models"] }),
      queryClient.invalidateQueries({ queryKey: ["shared-compute", "usage"] }),
    ]);
  };
  const start = useMutation({
    mutationFn: startCompute,
    onSuccess: refresh,
  });
  const stop = useMutation({
    mutationFn: stopCompute,
    onSuccess: refresh,
  });
  const actionPending = start.isPending || stop.isPending;
  const actionError = start.error ?? stop.error;
  const controlsDisabled = actionPending || isSharing;
  const maxVramNumber = Number(maxVramGb);
  const maxVramValid =
    maxVramGb.trim() === "" ||
    (Number.isSafeInteger(maxVramNumber) &&
      maxVramNumber >= 1 &&
      maxVramNumber <= 1024);

  function handleToggle(next: boolean) {
    start.reset();
    stop.reset();
    if (next) {
      if (!validHostedModelRef(modelInput) || !maxVramValid) return;
      start.mutate({
        modelId: modelInput.trim(),
        ...(maxVramGb.trim() ? { maxVramGb: maxVramNumber } : {}),
      });
    } else if (isSharing && status?.state !== "starting") {
      stop.mutate();
    }
  }

  return (
    <section className="min-w-0" data-testid="settings-mesh-share-compute">
      <h2 className="text-xl font-semibold">Share compute</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Share this machine with your relay. When on, other members can run their
        agents here.
      </p>

      {statusQuery.error ? (
        <ErrorMessage>
          Couldn&apos;t check shared compute: {statusQuery.error.message}
        </ErrorMessage>
      ) : null}
      {actionError ? <ErrorMessage>{actionError.message}</ErrorMessage> : null}
      {status?.progress && !status.progress.done ? (
        <DownloadProgressBar progress={status.progress} />
      ) : null}

      <div className="mt-6 divide-y overflow-hidden rounded-md border bg-background">
        <div className="flex min-h-20 items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <label
              className="text-sm font-medium"
              htmlFor="mesh-share-compute-toggle"
            >
              Share this machine
            </label>
            <StatusLine
              isConsuming={isConsuming}
              pendingAction={
                start.isPending ? "start" : stop.isPending ? "stop" : null
              }
              status={status}
            />
            <UsageLine usage={usageQuery.data ?? null} visible={isSharing} />
          </div>
          <Toggle
            checked={isSharing}
            disabled={
              actionPending ||
              status?.state === "starting" ||
              (!isSharing &&
                (!validHostedModelRef(modelInput) || !maxVramValid))
            }
            id="mesh-share-compute-toggle"
            onCheckedChange={handleToggle}
          />
        </div>

        <div className="px-4 pb-4 pt-5">
          <label
            className="mb-3 flex items-center gap-2 text-sm font-medium"
            htmlFor="mesh-share-compute-model"
          >
            <Cpu className="h-4 w-4 text-muted-foreground" />
            Model
          </label>
          <div className="flex flex-col gap-2">
            <Input
              data-testid="mesh-share-compute-model"
              disabled={controlsDisabled}
              id="mesh-share-compute-model"
              onChange={(event) => {
                setModelInput(event.target.value);
                writeDraft(MODEL_DRAFT_STORAGE_KEY, event.target.value);
              }}
              placeholder="Qwen3-8B-Q4_K_M or hf://meshllm/qwen3-8b@main"
              value={modelInput}
            />
            <p className="text-sm text-muted-foreground">
              Choose a suggested model below, or enter a remote model reference.
              Buzz downloads it when sharing starts.
            </p>
            {modelInput && !validHostedModelRef(modelInput) ? (
              <p className="text-xs text-destructive">
                Enter a catalog model ID or hf:// reference. File paths and
                arbitrary URLs are not accepted.
              </p>
            ) : null}
            {catalogQuery.data?.entries.length ? (
              <CatalogPicker
                catalog={catalogQuery.data}
                disabled={controlsDisabled}
                onPick={(model) => {
                  setModelInput(model);
                  writeDraft(MODEL_DRAFT_STORAGE_KEY, model);
                }}
                selected={modelInput.trim()}
              />
            ) : null}
            {modelsQuery.data?.length ? (
              <div className="mt-1">
                <p className="text-sm text-muted-foreground">
                  Already installed on this machine:
                </p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {modelsQuery.data.map((model) => (
                    <li key={model.id}>
                      <button
                        className="rounded border bg-muted/20 px-2 py-0.5 text-sm hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={controlsDisabled}
                        onClick={() => {
                          setModelInput(model.id);
                          writeDraft(MODEL_DRAFT_STORAGE_KEY, model.id);
                        }}
                        type="button"
                      >
                        {model.name ?? model.id}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>

        <details
          className="px-4 py-3"
          onToggle={(event) =>
            setAdvancedOpen((event.target as HTMLDetailsElement).open)
          }
          open={advancedOpen}
        >
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium">
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                advancedOpen ? "rotate-0" : "-rotate-90",
              )}
            />
            Advanced
          </summary>
          <div className="mt-3 flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="mesh-vram">
              Max VRAM (GB)
            </label>
            <Input
              data-testid="mesh-share-compute-vram"
              disabled={controlsDisabled}
              id="mesh-vram"
              inputMode="numeric"
              min={1}
              max={1024}
              onChange={(event) => {
                setMaxVramGb(event.target.value);
                writeDraft(MAX_VRAM_DRAFT_STORAGE_KEY, event.target.value);
              }}
              placeholder="No limit"
              type="number"
              value={maxVramGb}
            />
            {!maxVramValid ? (
              <p className="text-xs text-destructive">
                Max VRAM must be a whole number between 1 and 1024 GB.
              </p>
            ) : null}
          </div>
        </details>
      </div>

      <p className="mt-3 rounded-md bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        Only members of this relay can use this machine&apos;s shared compute.
      </p>
    </section>
  );
}

function Toggle({
  checked,
  disabled,
  id,
  onCheckedChange,
}: {
  checked: boolean;
  disabled: boolean;
  id: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label="Share this machine"
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/35",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
      data-testid="mesh-share-compute-toggle"
      disabled={disabled}
      id={id}
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-background shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  );
}

function StatusLine({
  isConsuming,
  pendingAction,
  status,
}: {
  isConsuming: boolean;
  pendingAction: "start" | "stop" | null;
  status: ComputeStatus | null;
}) {
  if (pendingAction === "start") return <Muted>Starting…</Muted>;
  if (pendingAction === "stop") return <Muted>Stopping…</Muted>;
  if (isConsuming) {
    return (
      <Muted>
        This machine is currently using another member&apos;s shared compute.
        Turn on sharing to switch to the selected local model; Buzz may briefly
        restart.
      </Muted>
    );
  }
  if (!status) return <Muted>Checking status…</Muted>;
  const model = status.modelName ?? status.modelId ?? "";
  if (status.state === "off") return <Muted>Not sharing right now.</Muted>;
  if (status.state === "starting") {
    return <Muted>{status.health.reason || "Starting…"}</Muted>;
  }
  if (status.state === "failed") {
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load: {status.health.reason || "Couldn&apos;t start."}
      </p>
    );
  }
  if (status.health.status === "failed") {
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load: {status.health.reason}
      </p>
    );
  }
  if (status.health.status === "degraded") {
    return (
      <p className="text-sm text-amber-600 dark:text-amber-400">
        Active{model ? ` — ${model}` : ""}. {status.health.reason}
      </p>
    );
  }
  return <Muted>Sharing{model ? ` ${model}` : ""} with relay members.</Muted>;
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function UsageLine({
  usage,
  visible,
}: {
  usage: ComputeUsage | null;
  visible: boolean;
}) {
  if (!visible || !usage) return null;
  const remote = usage.remoteAttempts + usage.endpointAttempts;
  let label = "Idle · no one using it yet";
  let prominent = false;
  if (remote > 0) {
    prominent = true;
    label =
      usage.inflight > 0
        ? `In use now by another member · ${usage.inflight} live`
        : `Used by another member · ${remote} ${remote === 1 ? "request" : "requests"}`;
  } else if (usage.inflight > 0) {
    label = `Serving your agent · ${usage.inflight} live`;
  } else if (usage.requestsServed > 0) {
    label = "Idle · no one using it right now";
  }
  return (
    <p
      className={cn(
        "mt-0.5 text-xs",
        prominent
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-muted-foreground",
      )}
      data-testid="mesh-serving-usage"
    >
      {label}
      {usage.tokensPerSecond > 0 ? (
        <span className="text-muted-foreground">
          {" "}
          · {Math.round(usage.tokensPerSecond)} tok/s
        </span>
      ) : null}
    </p>
  );
}

function DownloadProgressBar({
  progress,
}: {
  progress: ComputeDownloadProgress;
}) {
  const percent =
    progress.downloadedBytes != null &&
    progress.totalBytes != null &&
    progress.totalBytes > 0
      ? Math.min(
          100,
          Math.round((progress.downloadedBytes / progress.totalBytes) * 100),
        )
      : null;
  const formatGb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;
  const bytes =
    progress.downloadedBytes == null
      ? ""
      : progress.totalBytes
        ? `${formatGb(progress.downloadedBytes)} of ${formatGb(progress.totalBytes)}`
        : formatGb(progress.downloadedBytes);
  return (
    <div
      className="mt-4 rounded-md bg-muted/30 px-3 py-2"
      data-testid="mesh-download-progress"
    >
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-medium">
          {progress.status === "preparing" ? "Preparing" : "Downloading"}{" "}
          {progress.label}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {percent == null ? bytes || "…" : `${percent}%`}
        </span>
      </div>
      {bytes && percent != null ? (
        <p className="mt-0.5 text-sm text-muted-foreground">{bytes}</p>
      ) : null}
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full bg-primary transition-[width] duration-300",
            percent == null && "w-1/4 animate-pulse",
          )}
          style={percent == null ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

const FIT_LABEL: Record<ComputeCatalogEntry["fit"], string> = {
  comfortable: "Fits well",
  tight: "Tight fit",
  tradeoff: "Trade-off",
  too_large: "Too large",
};

const FIT_CLASS: Record<ComputeCatalogEntry["fit"], string> = {
  comfortable: "text-green-600 dark:text-green-400",
  tight: "text-amber-600 dark:text-amber-400",
  tradeoff: "text-orange-600 dark:text-orange-400",
  too_large: "text-destructive",
};

function CatalogPicker({
  catalog,
  disabled,
  onPick,
  selected,
}: {
  catalog: ComputeCatalog;
  disabled: boolean;
  onPick: (model: string) => void;
  selected: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const curated = catalog.entries.filter((entry) => entry.curated);
  const advanced = catalog.entries.filter((entry) => !entry.curated);
  const visible = expanded ? catalog.entries : curated;
  return (
    <div className="mt-1" data-testid="mesh-share-compute-catalog">
      <p className="text-sm text-muted-foreground">
        Recommended for this machine
        {catalog.gpuName ? ` (${catalog.gpuName}, ` : " ("}
        {catalog.vramDisplay} AI memory):
      </p>
      <ul className="mt-1.5 flex max-h-56 flex-col gap-1 overflow-y-auto">
        {visible.map((entry) => {
          const selectedEntry = entry.name === selected;
          return (
            <li key={entry.name}>
              <button
                className={cn(
                  "flex w-full flex-col gap-1 rounded border px-2 py-1 text-left text-sm sm:flex-row sm:items-baseline sm:gap-2",
                  selectedEntry
                    ? "border-primary/60 bg-primary/10"
                    : "bg-muted/20 hover:bg-muted/40",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
                disabled={disabled || entry.fit === "too_large"}
                onClick={() => onPick(entry.name)}
                title={entry.description}
                type="button"
              >
                <span className="w-full min-w-0 break-all font-medium sm:flex-1 sm:break-words">
                  {entry.name}
                </span>
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="shrink-0 text-muted-foreground">
                    {entry.size}
                  </span>
                  <span className={cn("shrink-0", FIT_CLASS[entry.fit])}>
                    {FIT_LABEL[entry.fit]}
                  </span>
                  {entry.recommended ? (
                    <span className="shrink-0 rounded bg-primary/15 px-1.5 text-xs font-medium text-primary">
                      Recommended
                    </span>
                  ) : null}
                  {entry.installed ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Installed
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {advanced.length ? (
        <button
          className="mt-1 text-sm text-muted-foreground underline hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded
            ? "Hide advanced models"
            : `Advanced: ${advanced.length} more models`}
        </button>
      ) : null}
    </div>
  );
}
