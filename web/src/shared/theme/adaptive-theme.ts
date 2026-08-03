type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
  const long = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(
    hex,
  );
  if (long) {
    return {
      r: Number.parseInt(long[1], 16),
      g: Number.parseInt(long[2], 16),
      b: Number.parseInt(long[3], 16),
    };
  }
  const short = /^#?([a-f\d])([a-f\d])([a-f\d])([a-f\d])?$/i.exec(hex);
  if (short) {
    return {
      r: Number.parseInt(short[1] + short[1], 16),
      g: Number.parseInt(short[2] + short[2], 16),
      b: Number.parseInt(short[3] + short[3], 16),
    };
  }
  return { r: 128, g: 128, b: 128 };
}

function rgbToHex({ r, g, b }: RGB): string {
  const clamp = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)));
  return `#${[r, g, b]
    .map((value) => clamp(value).toString(16).padStart(2, "0"))
    .join("")}`;
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const [rs, gs, bs] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function mix(from: string, to: string, factor: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex({
    r: a.r + (b.r - a.r) * factor,
    g: a.g + (b.g - a.g) * factor,
    b: a.b + (b.b - a.b) * factor,
  });
}

function adjust(hex: string, amount: number): string {
  return mix(hex, amount > 0 ? "#ffffff" : "#000000", Math.abs(amount));
}

function overlay(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function hexToHsl(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  if (max === min) return `0 0% ${(lightness * 100).toFixed(1)}%`;
  const delta = max - min;
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === rn) hue = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) hue = ((bn - rn) / delta + 2) / 6;
  else hue = ((rn - gn) / delta + 4) / 6;
  return `${(hue * 360).toFixed(1)} ${(saturation * 100).toFixed(2)}% ${(lightness * 100).toFixed(1)}%`;
}

function findColorWithLuminance(base: string, target: number): string {
  const baseLuminance = luminance(base);
  if (Math.abs(baseLuminance - target) < 0.001) return base;
  const destination = target < baseLuminance ? "#000000" : "#ffffff";
  let low = 0;
  let high = 1;
  for (let index = 0; index < 20; index += 1) {
    const middle = (low + high) / 2;
    const candidate = luminance(mix(base, destination, middle));
    if (destination === "#000000") {
      if (candidate > target) low = middle;
      else high = middle;
    } else if (candidate < target) low = middle;
    else high = middle;
  }
  return mix(base, destination, (low + high) / 2);
}

export type ThemeColors = {
  background: string;
  foreground: string;
  comment: string;
  added?: string | null;
  deleted?: string | null;
};

export function createThemeVars(colors: ThemeColors) {
  const isDark = luminance(colors.background) < 0.5;
  const backgroundLuminance = luminance(colors.background);
  const difference = 0.035 * Math.log(1 + (backgroundLuminance + 0.0135) * 10);
  const target = backgroundLuminance - difference;
  const chrome =
    target >= 0
      ? findColorWithLuminance(colors.background, target)
      : findColorWithLuminance(colors.background, 0);
  const background =
    target >= 0
      ? colors.background
      : findColorWithLuminance(colors.background, difference);
  const elevate = (amount: number) =>
    adjust(background, (isDark ? 1 : -1) * amount);
  const green = colors.added ?? (isDark ? "#3fb950" : "#1a7f37");
  const red = colors.deleted ?? (isDark ? "#f85149" : "#cf222e");
  const orange = isDark ? "#d29922" : "#9a6700";
  const border = mix(background, colors.foreground, isDark ? 0.15 : 0.12);
  const foreground = hexToHsl(colors.foreground);
  const surface = hexToHsl(background);
  const hover = hexToHsl(elevate(0.06));

  return {
    isDark,
    vars: {
      "--background": surface,
      "--card": surface,
      "--popover": hexToHsl(elevate(0.08)),
      "--muted": hover,
      "--accent": hover,
      "--secondary": hover,
      "--foreground": foreground,
      "--card-foreground": foreground,
      "--popover-foreground": foreground,
      "--muted-foreground": hexToHsl(colors.comment),
      "--accent-foreground": foreground,
      "--secondary-foreground": foreground,
      "--destructive": hexToHsl(red),
      "--destructive-foreground": surface,
      "--border": hexToHsl(border),
      "--input": hexToHsl(border),
      "--ring": foreground,
      "--sidebar": hexToHsl(chrome),
      "--sidebar-background": hexToHsl(chrome),
      "--sidebar-foreground": foreground,
      "--sidebar-accent": surface,
      "--sidebar-accent-foreground": foreground,
      "--sidebar-border": hexToHsl(border),
      "--sidebar-ring": hexToHsl(border),
      "--status-added": green,
      "--status-deleted": red,
      "--status-modified": orange,
      "--ui-warning": orange,
      "--ui-warning-bg": overlay(orange, isDark ? 0.1 : 0.08),
    },
  };
}
