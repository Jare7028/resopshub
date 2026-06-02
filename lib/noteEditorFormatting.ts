export type ImageFloatMode = "none" | "left" | "right";

export const WORD_FONT_OPTIONS = [
  { value: "Arial", label: "Arial" },
  { value: "Verdana", label: "Verdana" },
  { value: "Georgia", label: "Georgia" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Courier New", label: "Courier New" },
] as const;

export const WORD_FONT_SIZE_OPTIONS = [
  { value: "12px", label: "12" },
  { value: "14px", label: "14" },
  { value: "16px", label: "16" },
  { value: "18px", label: "18" },
  { value: "24px", label: "24" },
  { value: "32px", label: "32" },
] as const;

export function parseFontSizePx(value: string | null | undefined) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw.endsWith("px")) {
    return null;
  }
  const parsed = Number.parseFloat(raw.slice(0, -2));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function getNextFontSizeValue(
  currentValue: string,
  direction: "up" | "down"
) {
  const steps = WORD_FONT_SIZE_OPTIONS.map((item) => ({
    value: String(item.value),
    px: parseFontSizePx(item.value),
  })).filter((item) => typeof item.px === "number") as Array<{
    value: string;
    px: number;
  }>;

  if (!steps.length) {
    return "";
  }

  const currentPx = parseFontSizePx(currentValue);
  if (currentPx === null) {
    return direction === "up"
      ? steps[0].value
      : steps[Math.max(steps.length - 1, 0)].value;
  }

  if (direction === "up") {
    const next = steps.find((step) => step.px > currentPx);
    return next?.value || steps[steps.length - 1].value;
  }

  const previous = [...steps].reverse().find((step) => step.px < currentPx);
  return previous?.value || "";
}

export function normalizeImageFloat(value: string | null | undefined): ImageFloatMode {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "left" || normalized === "right") {
    return normalized;
  }
  return "none";
}

export function normalizeFontFamilyLabel(value: string) {
  const firstFamily = String(value || "")
    .split(",")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  return firstFamily || "Default";
}

export function normalizeFontSizeLabel(value: string) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw.endsWith("px")) {
    const px = Number.parseFloat(raw.slice(0, -2));
    if (Number.isFinite(px) && px > 0) {
      return Number.isInteger(px)
        ? String(px)
        : px.toFixed(1).replace(/\.0$/, "");
    }
  }
  return "Default";
}
