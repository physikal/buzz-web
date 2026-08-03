import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  setThreadViewMode,
  useThreadViewMode,
  type ThreadViewMode,
} from "@/features/channels/thread-view-mode";
import { createThemeVars } from "@/shared/theme/adaptive-theme";
import {
  ACCENT_COLORS,
  isBuzzTheme,
  NEUTRAL_ACCENT,
  useTheme,
} from "@/shared/theme/ThemeProvider";
import {
  getThemePair,
  LIGHT_THEMES,
  loadThemeColors,
  SYNTAX_THEMES,
  type SyntaxThemeName,
} from "@/shared/theme/theme-catalog";
import { cn } from "@/shared/lib/cn";

type AppearanceMode = "system" | "light" | "dark";
type PreviewVars = Record<string, string>;

function themeLabel(name: string) {
  const tokens = new Set([
    "light",
    "latte",
    "dawn",
    "lotus",
    "ochin",
    "lighter",
    "plus",
  ]);
  const parts = name.split("-").filter((part) => !tokens.has(part));
  return (parts.length ? parts : name.split("-"))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function usePreviewVars(name: SyntaxThemeName) {
  const [vars, setVars] = useState<PreviewVars | null>(null);
  useEffect(() => {
    let active = true;
    void loadThemeColors(name).then((colors) => {
      if (active) setVars(createThemeVars(colors).vars);
    });
    return () => {
      active = false;
    };
  }, [name]);
  return vars;
}

function color(vars: PreviewVars | null, key: string, fallback: string) {
  return `hsl(${vars?.[key] ?? fallback})`;
}

function Preview({ name }: { name: SyntaxThemeName }) {
  const vars = usePreviewVars(name);
  const background = color(vars, "--background", "0 0% 96%");
  const foreground = color(vars, "--foreground", "0 0% 20%");
  const muted = color(vars, "--muted-foreground", "0 0% 55%");
  const sidebar = color(vars, "--sidebar-background", "0 0% 90%");
  const primary = color(vars, "--primary", "220 80% 55%");
  return (
    <div
      aria-hidden="true"
      className="grid h-24 w-full grid-cols-[36%_1fr] overflow-hidden rounded-md border"
      style={{ background }}
    >
      <div
        className="space-y-2 p-2"
        style={
          isBuzzTheme(name)
            ? {
                background:
                  name === "buzz"
                    ? "linear-gradient(#e6e6b6, #c4d0da)"
                    : "linear-gradient(#4a4616, #0a1423)",
              }
            : { background: sidebar }
        }
      >
        {[72, 88, 58, 78].map((width) => (
          <div
            className="h-1 rounded-full opacity-50"
            key={width}
            style={{ background: foreground, width: `${width}%` }}
          />
        ))}
      </div>
      <div className="space-y-2 p-3">
        <div
          className="h-2 w-1/2 rounded-full"
          style={{ background: foreground }}
        />
        <div className="h-1 w-4/5 rounded-full" style={{ background: muted }} />
        <div className="mt-4 flex gap-1.5">
          <div className="h-4 w-4 rounded" style={{ background: primary }} />
          <div className="h-4 flex-1 rounded border" />
        </div>
      </div>
    </div>
  );
}

function PairedPreview({ light }: { light: SyntaxThemeName }) {
  const dark = getThemePair(light);
  const lightVars = usePreviewVars(light);
  const darkVars = usePreviewVars(dark ?? light);
  return (
    <div className="grid h-24 overflow-hidden rounded-md border">
      {[
        { vars: lightVars, name: light },
        { vars: darkVars, name: dark ?? light },
      ].map(({ vars, name }) => (
        <div
          className="grid grid-cols-[36%_1fr]"
          key={name}
          style={{ background: color(vars, "--background", "0 0% 96%") }}
        >
          <div
            style={
              isBuzzTheme(name)
                ? {
                    background:
                      name === "buzz"
                        ? "linear-gradient(90deg, #e6e6b6, #c4d0da)"
                        : "linear-gradient(90deg, #4a4616, #0a1423)",
                  }
                : {
                    background: color(vars, "--sidebar-background", "0 0% 90%"),
                  }
            }
          />
          <div className="flex items-center gap-2 px-2">
            <div
              className="h-1.5 w-1/2 rounded-full"
              style={{ background: color(vars, "--foreground", "0 0% 20%") }}
            />
            <div
              className="h-3 w-3 rounded"
              style={{ background: color(vars, "--primary", "220 80% 55%") }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AppearancePanel() {
  const {
    accentColor,
    followSystem,
    isDark,
    selectedThemeName,
    setAccentColor,
    setFollowSystem,
    setTheme,
  } = useTheme();
  const initialMode: AppearanceMode = followSystem
    ? "system"
    : isDark
      ? "dark"
      : "light";
  const [mode, setMode] = useState<AppearanceMode>(initialMode);
  const pairedLight = useMemo(
    () =>
      SYNTAX_THEMES.filter(
        (name) => LIGHT_THEMES.has(name) && getThemePair(name),
      ),
    [],
  );
  const lightThemes = useMemo(
    () => SYNTAX_THEMES.filter((name) => LIGHT_THEMES.has(name)),
    [],
  );
  const darkThemes = useMemo(
    () => SYNTAX_THEMES.filter((name) => !LIGHT_THEMES.has(name)),
    [],
  );
  const visible =
    mode === "system"
      ? pairedLight
      : mode === "light"
        ? lightThemes
        : darkThemes;

  function selectMode(next: AppearanceMode) {
    setMode(next);
    if (next === "system") {
      setFollowSystem(true);
      if (!getThemePair(selectedThemeName)) setTheme(pairedLight[0]);
      return;
    }
    setFollowSystem(false);
    const wantsLight = next === "light";
    if (LIGHT_THEMES.has(selectedThemeName) !== wantsLight) {
      const pair = getThemePair(selectedThemeName);
      setTheme(pair ?? (wantsLight ? lightThemes[0] : darkThemes[0]));
    }
  }

  return (
    <section>
      <header className="mb-6">
        <h2 className="text-2xl font-semibold">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a theme for Buzz.
        </p>
      </header>
      <fieldset className="mb-5 flex flex-wrap gap-2">
        <legend className="sr-only">Theme mode</legend>
        {[
          ["system", "System", Monitor],
          ["light", "Light", Sun],
          ["dark", "Dark", Moon],
        ].map(([value, label, Icon]) => (
          <button
            aria-pressed={mode === value}
            className={cn(
              "flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium",
              mode === value
                ? "border-primary bg-primary/10"
                : "text-muted-foreground hover:bg-accent",
            )}
            key={value as string}
            onClick={() => selectMode(value as AppearanceMode)}
            type="button"
          >
            <Icon className="h-4 w-4" />
            {label as string}
          </button>
        ))}
      </fieldset>
      <div className="grid max-h-[430px] grid-cols-2 gap-4 overflow-y-auto p-1 sm:grid-cols-3">
        {visible.map((name) => {
          const active =
            selectedThemeName === name ||
            (mode === "system" && getThemePair(name) === selectedThemeName);
          return (
            <button
              aria-pressed={active}
              className="min-w-0 text-left"
              data-testid={
                mode === "system"
                  ? `theme-pair-${name}`
                  : `theme-option-${name}`
              }
              key={name}
              onClick={() => setTheme(name)}
              type="button"
            >
              <div
                className={cn(
                  "rounded-md",
                  active
                    ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : "hover:ring-2 hover:ring-border",
                )}
              >
                {mode === "system" ? (
                  <PairedPreview light={name} />
                ) : (
                  <Preview name={name} />
                )}
              </div>
              <span
                className={cn(
                  "mt-1.5 block truncate text-center text-xs",
                  active ? "font-medium" : "text-muted-foreground",
                )}
              >
                {mode === "system" ? themeLabel(name) : themeLabel(name)}
              </span>
            </button>
          );
        })}
      </div>
      {!isBuzzTheme(selectedThemeName) ? (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-medium">Accent color</h3>
          <div className="flex flex-wrap gap-2">
            {ACCENT_COLORS.map((accent) => (
              <button
                aria-label={`${accent.name} accent`}
                aria-pressed={accentColor === accent.value}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border",
                  accentColor === accent.value &&
                    "ring-2 ring-ring ring-offset-2 ring-offset-background",
                )}
                key={accent.value}
                onClick={() => setAccentColor(accent.value)}
                style={{
                  backgroundColor:
                    accent.value === NEUTRAL_ACCENT
                      ? "hsl(var(--foreground))"
                      : accent.value,
                }}
                title={accent.name}
                type="button"
              >
                {accentColor === accent.value ? (
                  <Check className="h-4 w-4 text-white mix-blend-difference" />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <ThreadLayoutSetting />
    </section>
  );
}

function ThreadLayoutSetting() {
  const value = useThreadViewMode();
  const options: Array<{
    value: ThreadViewMode;
    label: string;
    description: string;
  }> = [
    {
      value: "focus",
      label: "Focus",
      description: "Threads open over the channel, full width",
    },
    {
      value: "split",
      label: "Split",
      description: "Threads open in a side panel next to the channel",
    },
  ];
  const active = options.find((option) => option.value === value) ?? options[1];
  return (
    <div className="mt-8 flex items-center justify-between gap-4 rounded-md border p-4">
      <div>
        <label className="text-sm font-medium" htmlFor="thread-layout">
          Thread layout
        </label>
        <p className="text-sm text-muted-foreground">{active.description}</p>
      </div>
      <select
        className="rounded-md border bg-background px-3 py-2 text-sm"
        id="thread-layout"
        onChange={(event) =>
          setThreadViewMode(event.target.value as ThreadViewMode)
        }
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
