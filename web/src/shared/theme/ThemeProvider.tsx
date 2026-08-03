import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { createThemeVars, hexToHsl } from "./adaptive-theme";
import {
  getThemePair,
  isSyntaxTheme,
  loadThemeColors,
  resolveSystemTheme,
  type SyntaxThemeName,
} from "./theme-catalog";

export const THEME_STORAGE_KEY = "buzz-theme";
export const ACCENT_STORAGE_KEY = "buzz-accent-color";
export const NEUTRAL_ACCENT = "neutral";
const FOLLOW_SYSTEM_KEY = "buzz-follow-system";
const CACHE_KEY = "buzz-web-theme-cache";
const DEFAULT_ACCENT = "#3b82f6";

export const ACCENT_COLORS = [
  { name: "Neutral", value: NEUTRAL_ACCENT },
  { name: "Blue", value: "#3b82f6" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Green", value: "#22c55e" },
  { name: "Orange", value: "#f97316" },
  { name: "Red", value: "#ef4444" },
  { name: "Pink", value: "#ec4899" },
  { name: "Lilac", value: "#c0a2f1" },
  { name: "Purple", value: "#a855f7" },
  { name: "Indigo", value: "#6366f1" },
] as const;

type ThemeContextValue = {
  themeName: SyntaxThemeName;
  selectedThemeName: SyntaxThemeName;
  isDark: boolean;
  isLoading: boolean;
  accentColor: string;
  followSystem: boolean;
  hasPair: boolean;
  setTheme: (theme: SyntaxThemeName) => void;
  setAccentColor: (color: string) => void;
  setFollowSystem: (enabled: boolean) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function systemIsDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function previewSelection(): {
  theme: SyntaxThemeName;
  followSystem: boolean;
} | null {
  if (!import.meta.env.DEV) return null;
  const value = new URLSearchParams(window.location.search).get("previewTheme");
  if (value === "light") return { theme: "buzz", followSystem: false };
  if (value === "dark") return { theme: "buzz-dark", followSystem: false };
  return null;
}

function readStoredTheme(): SyntaxThemeName {
  const preview = previewSelection();
  if (preview) return preview.theme;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!stored || stored === "system") return "buzz";
    if (stored === "light") return "buzz";
    if (stored === "dark") return "buzz-dark";
    return isSyntaxTheme(stored) ? stored : "buzz";
  } catch {
    return "buzz";
  }
}

function readFollowSystem() {
  const preview = previewSelection();
  if (preview) return preview.followSystem;
  try {
    const stored = window.localStorage.getItem(FOLLOW_SYSTEM_KEY);
    if (stored !== null) return stored === "true";
    return window.localStorage.getItem(THEME_STORAGE_KEY) === null;
  } catch {
    return true;
  }
}

function readAccent() {
  try {
    return window.localStorage.getItem(ACCENT_STORAGE_KEY) ?? DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

export function isBuzzTheme(name: string) {
  return name === "buzz" || name === "buzz-dark";
}

function contrastColor(hex: string) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return "#ffffff";
  const [red, green, blue] = match
    .slice(1)
    .map((value) => Number.parseInt(value, 16));
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 > 0.5
    ? "#000000"
    : "#ffffff";
}

function applyAccent(name: SyntaxThemeName, value: string) {
  const root = document.documentElement;
  const effective = isBuzzTheme(name) ? NEUTRAL_ACCENT : value;
  if (effective === NEUTRAL_ACCENT) {
    const styles = window.getComputedStyle(root);
    const foreground = styles.getPropertyValue("--foreground").trim();
    const background = styles.getPropertyValue("--background").trim();
    root.style.setProperty("--primary", foreground);
    root.style.setProperty("--primary-foreground", background);
    root.style.setProperty("--sidebar-primary", foreground);
    root.style.setProperty("--sidebar-primary-foreground", background);
    return;
  }
  const accent = hexToHsl(effective);
  const foreground = hexToHsl(contrastColor(effective));
  root.style.setProperty("--primary", accent);
  root.style.setProperty("--primary-foreground", foreground);
  root.style.setProperty("--sidebar-primary", accent);
  root.style.setProperty("--sidebar-primary-foreground", foreground);
}

function applyCachedTheme() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const cached = JSON.parse(raw) as {
      themeName?: string;
      isDark?: boolean;
      vars?: Record<string, string>;
    };
    if (!cached.themeName || !isSyntaxTheme(cached.themeName) || !cached.vars)
      return false;
    const entries = Object.entries(cached.vars);
    if (
      entries.length > 64 ||
      entries.some(
        ([name, value]) =>
          !/^--[a-z0-9-]{1,63}$/u.test(name) ||
          typeof value !== "string" ||
          value.length > 128,
      )
    )
      return false;
    for (const [name, value] of entries) {
      document.documentElement.style.setProperty(name, value);
    }
    document.documentElement.classList.toggle("dark", cached.isDark === true);
    document.documentElement.classList.toggle("light", cached.isDark !== true);
    document.documentElement.toggleAttribute(
      "data-buzz-sidebar",
      isBuzzTheme(cached.themeName),
    );
    applyAccent(cached.themeName, readAccent());
    return true;
  } catch {
    return false;
  }
}

let applyRequest = 0;

async function applyTheme(name: SyntaxThemeName) {
  const request = ++applyRequest;
  const colors = await loadThemeColors(name);
  if (request !== applyRequest) return null;
  const result = createThemeVars(colors);
  for (const [property, value] of Object.entries(result.vars)) {
    document.documentElement.style.setProperty(property, value);
  }
  document.documentElement.classList.toggle("dark", result.isDark);
  document.documentElement.classList.toggle("light", !result.isDark);
  document.documentElement.toggleAttribute(
    "data-buzz-sidebar",
    isBuzzTheme(name),
  );
  applyAccent(name, readAccent());
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ themeName: name, ...result }),
    );
  } catch {
    // A theme still works for the current session when storage is unavailable.
  }
  return result;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [selectedTheme, setSelectedTheme] = useState<SyntaxThemeName>(() => {
    applyCachedTheme();
    return readStoredTheme();
  });
  const [followSystem, setFollowSystemState] = useState(readFollowSystem);
  const [prefersDark, setPrefersDark] = useState(systemIsDark);
  const [accentColor, setAccentColorState] = useState(readAccent);
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  const [isLoading, setIsLoading] = useState(true);
  const desiredThemeRef = useRef<SyntaxThemeName>(selectedTheme);
  const themeName = followSystem
    ? resolveSystemTheme(selectedTheme, prefersDark)
    : selectedTheme;

  useEffect(() => {
    desiredThemeRef.current = themeName;
    setIsLoading(true);
    void applyTheme(themeName)
      .then((result) => {
        if (result && desiredThemeRef.current === themeName) {
          setIsDark(result.isDark);
          setIsLoading(false);
        }
      })
      .catch(() => setIsLoading(false));
  }, [themeName]);

  useEffect(() => {
    applyAccent(themeName, accentColor);
  }, [themeName, accentColor]);

  useEffect(() => {
    if (!followSystem) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const change = (event: MediaQueryListEvent) =>
      setPrefersDark(event.matches);
    setPrefersDark(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, [followSystem]);

  const setTheme = useCallback((next: SyntaxThemeName) => {
    setSelectedTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort.
    }
  }, []);

  const setAccentColor = useCallback((next: string) => {
    setAccentColorState(next);
    try {
      window.localStorage.setItem(ACCENT_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort.
    }
  }, []);

  const setFollowSystem = useCallback((enabled: boolean) => {
    setFollowSystemState(enabled);
    try {
      window.localStorage.setItem(FOLLOW_SYSTEM_KEY, String(enabled));
    } catch {
      // Persistence is best-effort.
    }
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        themeName,
        selectedThemeName: selectedTheme,
        isDark,
        isLoading,
        accentColor,
        followSystem,
        hasPair: getThemePair(selectedTheme) !== null,
        setTheme,
        setAccentColor,
        setFollowSystem,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
