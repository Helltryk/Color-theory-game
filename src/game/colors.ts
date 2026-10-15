// Color wheel system: 6 base colors x 2 saturation levels x 2 hue levels = 24 combinations.
export interface ColorKey {
  base: number; // 0..5 -> RED YELLOW GREEN CYAN BLUE MAGENTA
  sat: number; // 0 = FADED, 1 = VIVID
  hue: number; // 0 = TRUE, 1 = SHIFTED
}

export const BASE_COLORS = [
  { name: 'RED', hue: 0 },
  { name: 'YELLOW', hue: 60 },
  { name: 'GREEN', hue: 120 },
  { name: 'CYAN', hue: 180 },
  { name: 'BLUE', hue: 240 },
  { name: 'MAGENTA', hue: 300 },
] as const;

export const SAT_NAMES = ['FADED', 'VIVID'] as const;
export const HUE_NAMES = ['TRUE', 'SHIFT'] as const;

export function colorToCss(c: ColorKey, lightness = 55): string {
  const hueDeg = (BASE_COLORS[c.base].hue + c.hue * 25) % 360;
  const satPct = c.sat === 1 ? 100 : 45;
  return `hsl(${hueDeg}, ${satPct}%, ${lightness}%)`;
}

export function colorToHex(c: ColorKey): number {
  const hueDeg = (BASE_COLORS[c.base].hue + c.hue * 25) % 360;
  const s = c.sat === 1 ? 1 : 0.45;
  return hslToHex(hueDeg / 360, s, 0.55);
}

function hslToHex(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

export function colorName(c: ColorKey): string {
  return `${SAT_NAMES[c.sat]} ${HUE_NAMES[c.hue]} ${BASE_COLORS[c.base].name}`;
}

// The "opposite" needed for prism shields: complementary hue + inverted sat + inverted hue level.
export function oppositeColor(c: ColorKey): ColorKey {
  return { base: (c.base + 3) % 6, sat: 1 - c.sat, hue: 1 - c.hue };
}

export function colorsEqual(a: ColorKey, b: ColorKey): boolean {
  return a.base === b.base && a.sat === b.sat && a.hue === b.hue;
}

export function randomColor(rng: () => number = Math.random): ColorKey {
  return {
    base: Math.floor(rng() * 6),
    sat: Math.floor(rng() * 2),
    hue: Math.floor(rng() * 2),
  };
}

export function colorId(c: ColorKey): number {
  return c.base * 4 + c.sat * 2 + c.hue;
}

export const DEFAULT_PLAYER_COLOR: ColorKey = { base: 0, sat: 1, hue: 0 };
