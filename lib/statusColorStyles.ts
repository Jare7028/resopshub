type RGB = { r: number; g: number; b: number };

function parseHexColor(colorHex: string | null | undefined): RGB | null {
  const raw = String(colorHex || "").trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(raw)) return null;

  const r = Number.parseInt(raw.slice(1, 3), 16);
  const g = Number.parseInt(raw.slice(3, 5), 16);
  const b = Number.parseInt(raw.slice(5, 7), 16);
  if ([r, g, b].some((value) => Number.isNaN(value))) return null;

  return { r, g, b };
}

function toRgba(color: RGB, alpha: number) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

export function statusDotStyle(colorHex: string | null | undefined) {
  const color = parseHexColor(colorHex);
  if (!color) return undefined;
  return { backgroundColor: toRgba(color, 1) };
}

export function statusBarStyle(colorHex: string | null | undefined) {
  const color = parseHexColor(colorHex);
  if (!color) return undefined;
  return { backgroundColor: toRgba(color, 1) };
}

export function statusPillStyle(colorHex: string | null | undefined) {
  const color = parseHexColor(colorHex);
  if (!color) return undefined;
  return {
    borderColor: toRgba(color, 0.4),
    backgroundColor: toRgba(color, 0.14),
    color: "#0f172a",
  };
}

export function statusSelectStyle(colorHex: string | null | undefined) {
  const color = parseHexColor(colorHex);
  if (!color) return undefined;
  return {
    borderColor: toRgba(color, 0.5),
    backgroundColor: toRgba(color, 0.12),
    color: "#0f172a",
  };
}
