import type { ThemeRegistrationRaw } from "shiki";

export const SYNTAX_THEMES = [
  "buzz",
  "buzz-dark",
  "andromeeda",
  "aurora-x",
  "ayu-dark",
  "catppuccin-frappe",
  "catppuccin-latte",
  "catppuccin-macchiato",
  "catppuccin-mocha",
  "dark-plus",
  "dracula",
  "dracula-soft",
  "everforest-dark",
  "everforest-light",
  "github-dark",
  "github-dark-default",
  "github-dark-dimmed",
  "github-dark-high-contrast",
  "github-light",
  "github-light-default",
  "github-light-high-contrast",
  "gruvbox-dark-hard",
  "gruvbox-dark-medium",
  "gruvbox-dark-soft",
  "gruvbox-light-hard",
  "gruvbox-light-medium",
  "gruvbox-light-soft",
  "houston",
  "kanagawa-dragon",
  "kanagawa-lotus",
  "kanagawa-wave",
  "laserwave",
  "light-plus",
  "material-theme",
  "material-theme-darker",
  "material-theme-lighter",
  "material-theme-ocean",
  "material-theme-palenight",
  "min-dark",
  "min-light",
  "monokai",
  "night-owl",
  "nord",
  "one-dark-pro",
  "one-light",
  "plastic",
  "poimandres",
  "red",
  "rose-pine",
  "rose-pine-dawn",
  "rose-pine-moon",
  "slack-dark",
  "slack-ochin",
  "snazzy-light",
  "solarized-dark",
  "solarized-light",
  "synthwave-84",
  "tokyo-night",
  "vesper",
  "vitesse-black",
  "vitesse-dark",
  "vitesse-light",
] as const;

export type SyntaxThemeName = (typeof SYNTAX_THEMES)[number];

export const LIGHT_THEMES: ReadonlySet<SyntaxThemeName> = new Set([
  "buzz",
  "catppuccin-latte",
  "everforest-light",
  "github-light",
  "github-light-default",
  "github-light-high-contrast",
  "gruvbox-light-hard",
  "gruvbox-light-medium",
  "gruvbox-light-soft",
  "kanagawa-lotus",
  "light-plus",
  "material-theme-lighter",
  "min-light",
  "one-light",
  "rose-pine-dawn",
  "slack-ochin",
  "snazzy-light",
  "solarized-light",
  "vitesse-light",
]);

const PAIRS: ReadonlyArray<readonly [SyntaxThemeName, SyntaxThemeName]> = [
  ["buzz", "buzz-dark"],
  ["catppuccin-latte", "catppuccin-mocha"],
  ["everforest-light", "everforest-dark"],
  ["github-light", "github-dark"],
  ["github-light-default", "github-dark-default"],
  ["github-light-high-contrast", "github-dark-high-contrast"],
  ["gruvbox-light-hard", "gruvbox-dark-hard"],
  ["gruvbox-light-medium", "gruvbox-dark-medium"],
  ["gruvbox-light-soft", "gruvbox-dark-soft"],
  ["kanagawa-lotus", "kanagawa-wave"],
  ["light-plus", "dark-plus"],
  ["material-theme-lighter", "material-theme"],
  ["min-light", "min-dark"],
  ["one-light", "one-dark-pro"],
  ["rose-pine-dawn", "rose-pine"],
  ["slack-ochin", "slack-dark"],
  ["solarized-light", "solarized-dark"],
  ["vitesse-light", "vitesse-dark"],
];

const themePairs = new Map<SyntaxThemeName, SyntaxThemeName>();
for (const [light, dark] of PAIRS) {
  themePairs.set(light, dark);
  themePairs.set(dark, light);
}

export function getThemePair(name: SyntaxThemeName) {
  return themePairs.get(name) ?? null;
}

export function isSyntaxTheme(name: string): name is SyntaxThemeName {
  return (SYNTAX_THEMES as readonly string[]).includes(name);
}

export function resolveSystemTheme(
  selected: SyntaxThemeName,
  systemIsDark: boolean,
) {
  const selectedIsLight = LIGHT_THEMES.has(selected);
  if (selectedIsLight === !systemIsDark) return selected;
  return getThemePair(selected) ?? selected;
}

type ThemeModule = { default: ThemeRegistrationRaw };
type ThemeLoader = () => Promise<ThemeModule>;

const imports: Record<SyntaxThemeName, ThemeLoader> = {
  buzz: () => import("shiki/themes/github-light.mjs"),
  "buzz-dark": () => import("shiki/themes/github-dark.mjs"),
  andromeeda: () => import("shiki/themes/andromeeda.mjs"),
  "aurora-x": () => import("shiki/themes/aurora-x.mjs"),
  "ayu-dark": () => import("shiki/themes/ayu-dark.mjs"),
  "catppuccin-frappe": () => import("shiki/themes/catppuccin-frappe.mjs"),
  "catppuccin-latte": () => import("shiki/themes/catppuccin-latte.mjs"),
  "catppuccin-macchiato": () => import("shiki/themes/catppuccin-macchiato.mjs"),
  "catppuccin-mocha": () => import("shiki/themes/catppuccin-mocha.mjs"),
  "dark-plus": () => import("shiki/themes/dark-plus.mjs"),
  dracula: () => import("shiki/themes/dracula.mjs"),
  "dracula-soft": () => import("shiki/themes/dracula-soft.mjs"),
  "everforest-dark": () => import("shiki/themes/everforest-dark.mjs"),
  "everforest-light": () => import("shiki/themes/everforest-light.mjs"),
  "github-dark": () => import("shiki/themes/github-dark.mjs"),
  "github-dark-default": () => import("shiki/themes/github-dark-default.mjs"),
  "github-dark-dimmed": () => import("shiki/themes/github-dark-dimmed.mjs"),
  "github-dark-high-contrast": () =>
    import("shiki/themes/github-dark-high-contrast.mjs"),
  "github-light": () => import("shiki/themes/github-light.mjs"),
  "github-light-default": () => import("shiki/themes/github-light-default.mjs"),
  "github-light-high-contrast": () =>
    import("shiki/themes/github-light-high-contrast.mjs"),
  "gruvbox-dark-hard": () => import("shiki/themes/gruvbox-dark-hard.mjs"),
  "gruvbox-dark-medium": () => import("shiki/themes/gruvbox-dark-medium.mjs"),
  "gruvbox-dark-soft": () => import("shiki/themes/gruvbox-dark-soft.mjs"),
  "gruvbox-light-hard": () => import("shiki/themes/gruvbox-light-hard.mjs"),
  "gruvbox-light-medium": () => import("shiki/themes/gruvbox-light-medium.mjs"),
  "gruvbox-light-soft": () => import("shiki/themes/gruvbox-light-soft.mjs"),
  houston: () => import("shiki/themes/houston.mjs"),
  "kanagawa-dragon": () => import("shiki/themes/kanagawa-dragon.mjs"),
  "kanagawa-lotus": () => import("shiki/themes/kanagawa-lotus.mjs"),
  "kanagawa-wave": () => import("shiki/themes/kanagawa-wave.mjs"),
  laserwave: () => import("shiki/themes/laserwave.mjs"),
  "light-plus": () => import("shiki/themes/light-plus.mjs"),
  "material-theme": () => import("shiki/themes/material-theme.mjs"),
  "material-theme-darker": () =>
    import("shiki/themes/material-theme-darker.mjs"),
  "material-theme-lighter": () =>
    import("shiki/themes/material-theme-lighter.mjs"),
  "material-theme-ocean": () => import("shiki/themes/material-theme-ocean.mjs"),
  "material-theme-palenight": () =>
    import("shiki/themes/material-theme-palenight.mjs"),
  "min-dark": () => import("shiki/themes/min-dark.mjs"),
  "min-light": () => import("shiki/themes/min-light.mjs"),
  monokai: () => import("shiki/themes/monokai.mjs"),
  "night-owl": () => import("shiki/themes/night-owl.mjs"),
  nord: () => import("shiki/themes/nord.mjs"),
  "one-dark-pro": () => import("shiki/themes/one-dark-pro.mjs"),
  "one-light": () => import("shiki/themes/one-light.mjs"),
  plastic: () => import("shiki/themes/plastic.mjs"),
  poimandres: () => import("shiki/themes/poimandres.mjs"),
  red: () => import("shiki/themes/red.mjs"),
  "rose-pine": () => import("shiki/themes/rose-pine.mjs"),
  "rose-pine-dawn": () => import("shiki/themes/rose-pine-dawn.mjs"),
  "rose-pine-moon": () => import("shiki/themes/rose-pine-moon.mjs"),
  "slack-dark": () => import("shiki/themes/slack-dark.mjs"),
  "slack-ochin": () => import("shiki/themes/slack-ochin.mjs"),
  "snazzy-light": () => import("shiki/themes/snazzy-light.mjs"),
  "solarized-dark": () => import("shiki/themes/solarized-dark.mjs"),
  "solarized-light": () => import("shiki/themes/solarized-light.mjs"),
  "synthwave-84": () => import("shiki/themes/synthwave-84.mjs"),
  "tokyo-night": () => import("shiki/themes/tokyo-night.mjs"),
  vesper: () => import("shiki/themes/vesper.mjs"),
  "vitesse-black": () => import("shiki/themes/vitesse-black.mjs"),
  "vitesse-dark": () => import("shiki/themes/vitesse-dark.mjs"),
  "vitesse-light": () => import("shiki/themes/vitesse-light.mjs"),
};

type ThemeSetting = {
  scope?: string | string[];
  settings?: { foreground?: string };
};

function firstColor(
  colors: Record<string, string> | undefined,
  keys: string[],
) {
  for (const key of keys) {
    const color = colors?.[key];
    if (color) return color.slice(0, 7);
  }
  return null;
}

export async function loadThemeColors(name: SyntaxThemeName) {
  const { default: theme } = await imports[name]();
  const colors = theme.colors as Record<string, string> | undefined;
  const foreground = colors?.["editor.foreground"] ?? "#d4d4d4";
  const settings = theme.settings as ThemeSetting[] | undefined;
  const comment = settings?.find((setting) => {
    const scopes = Array.isArray(setting.scope)
      ? setting.scope
      : [setting.scope];
    return scopes.includes("comment");
  })?.settings?.foreground;
  return {
    background: colors?.["editor.background"]?.slice(0, 7) ?? "#1e1e1e",
    foreground: foreground.slice(0, 7),
    comment: comment?.slice(0, 7) ?? foreground.slice(0, 7),
    added: firstColor(colors, [
      "gitDecoration.addedResourceForeground",
      "editorGutter.addedBackground",
      "diffEditor.insertedTextBackground",
    ]),
    deleted: firstColor(colors, [
      "gitDecoration.deletedResourceForeground",
      "editorGutter.deletedBackground",
      "diffEditor.removedTextBackground",
    ]),
  };
}
