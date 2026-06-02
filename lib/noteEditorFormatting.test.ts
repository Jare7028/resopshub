import { describe, expect, it } from "vitest";
import {
  getNextFontSizeValue,
  normalizeFontFamilyLabel,
  normalizeFontSizeLabel,
  normalizeImageFloat,
  parseFontSizePx,
  WORD_FONT_OPTIONS,
  WORD_FONT_SIZE_OPTIONS,
} from "./noteEditorFormatting";

describe("note editor formatting helpers", () => {
  it("exposes stable Word-style font option lists", () => {
    expect(WORD_FONT_OPTIONS.map((option) => option.value)).toEqual([
      "Arial",
      "Verdana",
      "Georgia",
      "Times New Roman",
      "Courier New",
    ]);
    expect(WORD_FONT_SIZE_OPTIONS.map((option) => option.value)).toEqual([
      "12px",
      "14px",
      "16px",
      "18px",
      "24px",
      "32px",
    ]);
  });

  it("parses valid positive px font sizes only", () => {
    expect(parseFontSizePx(" 14PX ")).toBe(14);
    expect(parseFontSizePx("13.5px")).toBe(13.5);
    expect(parseFontSizePx("0px")).toBeNull();
    expect(parseFontSizePx("-1px")).toBeNull();
    expect(parseFontSizePx("14pt")).toBeNull();
    expect(parseFontSizePx(null)).toBeNull();
  });

  it("steps font sizes up and down through configured values", () => {
    expect(getNextFontSizeValue("", "up")).toBe("12px");
    expect(getNextFontSizeValue("", "down")).toBe("32px");
    expect(getNextFontSizeValue("17px", "up")).toBe("18px");
    expect(getNextFontSizeValue("17px", "down")).toBe("16px");
    expect(getNextFontSizeValue("32px", "up")).toBe("32px");
    expect(getNextFontSizeValue("12px", "down")).toBe("");
  });

  it("normalizes image float values", () => {
    expect(normalizeImageFloat(" LEFT ")).toBe("left");
    expect(normalizeImageFloat("right")).toBe("right");
    expect(normalizeImageFloat("inline")).toBe("none");
    expect(normalizeImageFloat(null)).toBe("none");
  });

  it("normalizes font labels shown in the editor toolbar", () => {
    expect(normalizeFontFamilyLabel('"Times New Roman", serif')).toBe(
      "Times New Roman"
    );
    expect(normalizeFontFamilyLabel("")).toBe("Default");
    expect(normalizeFontSizeLabel("13.50px")).toBe("13.5");
    expect(normalizeFontSizeLabel("14px")).toBe("14");
    expect(normalizeFontSizeLabel("14pt")).toBe("Default");
  });
});
