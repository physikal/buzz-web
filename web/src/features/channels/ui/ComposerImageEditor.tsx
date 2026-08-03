import { LoaderCircle, Redo2, Save, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/shared/ui/button";

type Point = { x: number; y: number };
type Stroke = { color: string; points: Point[]; width: number };

const COLORS = [
  { label: "Red", value: "#ef4444" },
  { label: "Yellow", value: "#f59e0b" },
  { label: "Green", value: "#22c55e" },
  { label: "Blue", value: "#3b82f6" },
  { label: "White", value: "#ffffff" },
  { label: "Black", value: "#111111" },
] as const;

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_CANVAS_PIXELS = 40_000_000;

function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke) {
  const [first, ...rest] = stroke.points;
  if (!first) return;
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (!rest.length) {
    context.beginPath();
    context.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of rest) context.lineTo(point.x, point.y);
  context.stroke();
}

async function fetchImageBlob(url: string, signal: AbortSignal) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only HTTP image attachments can be edited.");
  }
  const response = await fetch(parsed, {
    credentials: "omit",
    mode: "cors",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!response.ok)
    throw new Error(`Image download failed (${response.status}).`);
  const contentType =
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? "";
  if (!contentType.startsWith("image/") || contentType === "image/svg+xml") {
    throw new Error("Only raster image attachments can be edited.");
  }
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_SOURCE_BYTES) {
    throw new Error("This image is too large to edit safely.");
  }
  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > MAX_SOURCE_BYTES) {
      throw new Error("This image is too large to edit safely.");
    }
    return blob;
  }
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error("This image is too large to edit safely.");
    }
    const chunk = new ArrayBuffer(value.byteLength);
    new Uint8Array(chunk).set(value);
    chunks.push(chunk);
  }
  return new Blob(chunks, { type: contentType });
}

function encodePng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG encoding failed."));
    }, "image/png");
  });
}

export function ComposerImageEditor({
  sourceUrl,
  onCancel,
  onSave,
  onSavingChange,
}: {
  sourceUrl: string;
  onCancel: () => void;
  onSave: (blob: Blob) => Promise<void>;
  onSavingChange?: (saving: boolean) => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStroke = useRef<Stroke | null>(null);
  const [sourceObjectUrl, setSourceObjectUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<{
    strokes: Stroke[];
    undone: Stroke[];
  }>({ strokes: [], undone: [] });
  const [color, setColor] = useState(COLORS[0].value as string);
  const [widthCss, setWidthCss] = useState(6);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    let objectUrl: string | null = null;
    let disposed = false;
    void fetchImageBlob(sourceUrl, controller.signal)
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setSourceObjectUrl(objectUrl);
      })
      .catch((cause) => {
        if (disposed) return;
        setError(
          cause instanceof DOMException && cause.name === "AbortError"
            ? "Image download timed out."
            : cause instanceof Error
              ? cause.message
              : "Could not load image.",
        );
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sourceUrl]);

  useEffect(() => () => onSavingChange?.(false), [onSavingChange]);

  const setSavingState = useCallback(
    (next: boolean) => {
      setSaving(next);
      onSavingChange?.(next);
    },
    [onSavingChange],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of history.strokes) drawStroke(context, stroke);
  }, [history.strokes]);

  const undo = useCallback(() => {
    setHistory((current) => {
      const stroke = current.strokes[current.strokes.length - 1];
      if (!stroke) return current;
      return {
        strokes: current.strokes.slice(0, -1),
        undone: [...current.undone, stroke],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      const stroke = current.undone[current.undone.length - 1];
      if (!stroke) return current;
      return {
        strokes: [...current.strokes, stroke],
        undone: current.undone.slice(0, -1),
      };
    });
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [redo, undo]);

  function imageLoaded(event: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalHeight, naturalWidth } = event.currentTarget;
    if (
      naturalWidth <= 0 ||
      naturalHeight <= 0 ||
      naturalWidth * naturalHeight > MAX_CANVAS_PIXELS
    ) {
      setError("This image is too large to edit safely.");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = naturalWidth;
    canvas.height = naturalHeight;
    setReady(true);
  }

  function naturalPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || !ready || saving) return;
    const canvas = canvasRef.current;
    const point = naturalPoint(event);
    if (!canvas || !point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = canvas.getBoundingClientRect();
    const stroke = {
      color,
      points: [point],
      width: Math.max(1, widthCss * (canvas.width / bounds.width)),
    };
    activeStroke.current = stroke;
    const context = canvas.getContext("2d");
    if (context) drawStroke(context, stroke);
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = activeStroke.current;
    const canvas = canvasRef.current;
    const point = naturalPoint(event);
    if (!stroke || !canvas || !point) return;
    const previous = stroke.points[stroke.points.length - 1];
    stroke.points.push(point);
    const context = canvas.getContext("2d");
    if (!context || !previous) return;
    drawStroke(context, { ...stroke, points: [previous, point] });
  }

  function commitStroke() {
    const stroke = activeStroke.current;
    if (!stroke) return;
    activeStroke.current = null;
    setHistory((current) => ({
      strokes: [...current.strokes, stroke],
      undone: [],
    }));
  }

  async function save() {
    const image = imageRef.current;
    if (!image || !ready || !history.strokes.length || saving) return;
    setSavingState(true);
    setError(null);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas drawing is unavailable.");
      context.drawImage(image, 0, 0);
      for (const stroke of history.strokes) drawStroke(context, stroke);
      await onSave(await encodePng(canvas));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save drawing.",
      );
      setSavingState(false);
    }
  }

  return (
    <div className="relative z-10 flex max-h-[94dvh] max-w-[96vw] flex-col overflow-hidden rounded-md bg-background shadow-2xl">
      <header className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-2 sm:flex-1">
          <strong className="mr-auto text-sm">Draw on image</strong>
          <Button
            aria-label="Undo drawing"
            disabled={!history.strokes.length || saving}
            onClick={undo}
            size="icon"
            variant="ghost"
          >
            <Undo2 />
          </Button>
          <Button
            aria-label="Redo drawing"
            disabled={!history.undone.length || saving}
            onClick={redo}
            size="icon"
            variant="ghost"
          >
            <Redo2 />
          </Button>
          <Button
            aria-label="Clear drawing"
            disabled={!history.strokes.length || saving}
            onClick={() => setHistory({ strokes: [], undone: [] })}
            size="icon"
            variant="ghost"
          >
            <Trash2 />
          </Button>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            disabled={saving}
            onClick={onCancel}
            size="sm"
            variant="outline"
          >
            <X /> Cancel
          </Button>
          <Button
            disabled={!ready || !history.strokes.length || saving}
            onClick={() => void save()}
            size="sm"
          >
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2">
        <span className="text-xs font-medium">Color</span>
        <div className="flex gap-1.5">
          {COLORS.map((option) => (
            <button
              aria-label={`${option.label} pen`}
              aria-pressed={color === option.value}
              className={`h-6 w-6 rounded-full border-2 ${color === option.value ? "border-primary ring-2 ring-primary/25" : "border-border"}`}
              key={option.value}
              onClick={() => setColor(option.value)}
              style={{ backgroundColor: option.value }}
              type="button"
            />
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs font-medium">
          Width
          <input
            aria-label="Pen width"
            disabled={saving}
            max="12"
            min="4"
            onChange={(event) => setWidthCss(Number(event.target.value))}
            step="2"
            type="range"
            value={widthCss}
          />
        </label>
      </div>
      <div className="grid min-h-48 flex-1 place-items-center overflow-auto bg-black/90 p-3">
        {sourceObjectUrl ? (
          <div className="grid max-h-[70dvh] max-w-[90vw] place-items-center">
            <img
              alt="Attachment being edited"
              className="col-start-1 row-start-1 max-h-[70dvh] max-w-[90vw] object-contain"
              onLoad={imageLoaded}
              ref={imageRef}
              src={sourceObjectUrl}
            />
            <canvas
              aria-label="Drawing canvas"
              className="col-start-1 row-start-1 h-full w-full touch-none cursor-crosshair"
              onPointerCancel={commitStroke}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={commitStroke}
              ref={canvasRef}
            />
          </div>
        ) : error ? null : (
          <LoaderCircle className="h-6 w-6 animate-spin text-white" />
        )}
        {error ? (
          <p className="max-w-sm rounded-md bg-background p-4 text-center text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
