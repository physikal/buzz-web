import { useEffect, useRef } from "react";

type EscapeSurface = {
  id: number;
  close: () => void;
  disabled: boolean;
};

const surfaces: EscapeSurface[] = [];
let nextSurfaceId = 1;
let listenerInstalled = false;

function handleEscape(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.key !== "Escape" ||
    event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return;
  const surface = surfaces[surfaces.length - 1];
  if (!surface) return;
  event.preventDefault();
  if (!surface.disabled) surface.close();
}

function ensureListener() {
  if (listenerInstalled) return;
  window.addEventListener("keydown", handleEscape);
  listenerInstalled = true;
}

export function hasActiveEscapeSurface() {
  return surfaces.length > 0;
}

export function useEscapeSurface(
  active: boolean,
  onClose: () => void,
  disabled = false,
) {
  const state = useRef({ onClose, disabled });
  state.current = { onClose, disabled };
  useEffect(() => {
    if (!active) return;
    ensureListener();
    const surface: EscapeSurface = {
      id: nextSurfaceId++,
      close: () => state.current.onClose(),
      get disabled() {
        return state.current.disabled;
      },
    };
    surfaces.push(surface);
    return () => {
      const index = surfaces.findIndex((entry) => entry.id === surface.id);
      if (index >= 0) surfaces.splice(index, 1);
    };
  }, [active]);
}
