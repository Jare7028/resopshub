import { describe, expect, it } from "vitest";
import {
  NOTE_SHAPE_DEFAULT_FILL,
  NOTE_SHAPE_DEFAULT_STROKE,
  NOTE_SHAPE_INSERT_OPTIONS,
  areNoteShapeAttrsEqual,
  areNoteTextBoxAttrsEqual,
  buildInsertNoteShapeAttrs,
  buildInsertNoteTextBoxAttrs,
  getDefaultShapeSize,
  getOverlayNodeObjectId,
  getShapeSvgMarkup,
  isOverlayNodeTypeName,
  normalizeNoteShapeAttrs,
  normalizeNoteShapeKind,
  normalizeNoteTextBoxAttrs,
  type OverlayInsertEditorLike,
} from "./noteEditorOverlays";

function createOverlayInsertEditor({
  nodeTypeNames = [],
  coords = { left: 100, top: 80 },
  rect = { left: 10, top: 20 },
  scrollLeft = 5,
  scrollTop = 7,
  shouldThrowCoords = false,
}: {
  nodeTypeNames?: string[];
  coords?: { left: number; top: number };
  rect?: { left: number; top: number };
  scrollLeft?: number;
  scrollTop?: number;
  shouldThrowCoords?: boolean;
}): OverlayInsertEditorLike {
  return {
    state: {
      doc: {
        descendants(callback) {
          nodeTypeNames.forEach((name) => {
            callback({ type: { name } });
          });
        },
      },
      selection: { from: 3 },
    },
    view: {
      coordsAtPos() {
        if (shouldThrowCoords) {
          throw new Error("No coordinates");
        }
        return coords;
      },
      dom: {
        getBoundingClientRect() {
          return rect;
        },
        scrollLeft,
        scrollTop,
      },
    },
  };
}

describe("note editor overlay helpers", () => {
  it("exposes stable insert options and default shape sizes", () => {
    expect(NOTE_SHAPE_INSERT_OPTIONS.map((option) => option.kind)).toEqual([
      "rectangle",
      "square",
      "circle",
      "arrow",
    ]);
    expect(getDefaultShapeSize("rectangle")).toEqual({ width: 150, height: 104 });
    expect(getDefaultShapeSize("arrow")).toEqual({ width: 220, height: 86 });
  });

  it("normalizes shape kind, numbers, colors, and object ids", () => {
    const shape = normalizeNoteShapeAttrs({
      objectId: " shape-1 ",
      kind: "CIRCLE",
      x: -10,
      y: 5000,
      width: 80.4,
      height: 140.6,
      stroke: "",
      fill: "",
      zIndex: 300,
    });

    expect(normalizeNoteShapeKind("unknown")).toBe("rectangle");
    expect(shape).toEqual({
      objectId: "shape-1",
      kind: "circle",
      x: 0,
      y: 4000,
      width: 141,
      height: 141,
      stroke: NOTE_SHAPE_DEFAULT_STROKE,
      fill: NOTE_SHAPE_DEFAULT_FILL,
      zIndex: 200,
    });
  });

  it("detects overlay node types and trims overlay object ids", () => {
    expect(isOverlayNodeTypeName("noteShape")).toBe(true);
    expect(isOverlayNodeTypeName("noteTextBox")).toBe(true);
    expect(isOverlayNodeTypeName("paragraph")).toBe(false);
    expect(getOverlayNodeObjectId({ attrs: { objectId: " object-1 " } })).toBe("object-1");
    expect(getOverlayNodeObjectId({ attrs: { objectId: 123 } })).toBe("");
    expect(getOverlayNodeObjectId(null)).toBe("");
  });

  it("forces arrows to transparent fill and clamps dimensions", () => {
    expect(
      normalizeNoteShapeAttrs({
        objectId: "arrow-1",
        kind: "arrow",
        width: 10,
        height: 9999,
        fill: "#f00",
      })
    ).toMatchObject({
      objectId: "arrow-1",
      kind: "arrow",
      width: 56,
      height: 1200,
      fill: "transparent",
    });
  });

  it("normalizes text box attrs with text-box-specific limits", () => {
    expect(
      normalizeNoteTextBoxAttrs({
        objectId: " text-1 ",
        x: -1,
        y: 88.8,
        width: 40,
        height: 5000,
        zIndex: 0,
      })
    ).toEqual({
      objectId: "text-1",
      x: 0,
      y: 89,
      width: 180,
      height: 1400,
      zIndex: 1,
    });
  });

  it("builds inserted shape defaults from editor coordinates and existing objects", () => {
    const shape = buildInsertNoteShapeAttrs(
      createOverlayInsertEditor({
        nodeTypeNames: ["noteShape", "paragraph", "noteShape"],
      }),
      "rectangle"
    );

    expect(shape).toMatchObject({
      kind: "rectangle",
      x: 131,
      y: 103,
      width: 150,
      height: 104,
      stroke: NOTE_SHAPE_DEFAULT_STROKE,
      fill: NOTE_SHAPE_DEFAULT_FILL,
      zIndex: 22,
    });
    expect(shape.objectId).toBeTruthy();
  });

  it("builds inserted text-box defaults and falls back when coordinates are unavailable", () => {
    const textBox = buildInsertNoteTextBoxAttrs(
      createOverlayInsertEditor({
        nodeTypeNames: ["noteTextBox", "noteTextBox", "noteTextBox"],
        shouldThrowCoords: true,
      })
    );

    expect(textBox).toMatchObject({
      x: 84,
      y: 84,
      width: 260,
      height: 150,
      zIndex: 27,
    });
    expect(textBox.objectId).toBeTruthy();
  });

  it("compares persisted shape and text-box attrs", () => {
    const shape = normalizeNoteShapeAttrs({ objectId: "shape-1", kind: "square" });
    expect(areNoteShapeAttrsEqual(shape, { ...shape })).toBe(true);
    expect(areNoteShapeAttrsEqual(shape, { ...shape, width: shape.width + 1 })).toBe(
      false
    );

    const textBox = normalizeNoteTextBoxAttrs({ objectId: "text-1" });
    expect(areNoteTextBoxAttrsEqual(textBox, { ...textBox })).toBe(true);
    expect(areNoteTextBoxAttrsEqual(textBox, { ...textBox, zIndex: 99 })).toBe(
      false
    );
  });

  it("renders shape-specific SVG markup", () => {
    const circle = getShapeSvgMarkup(
      normalizeNoteShapeAttrs({ objectId: "circle-1", kind: "circle" })
    );
    const arrow = getShapeSvgMarkup(
      normalizeNoteShapeAttrs({ objectId: "arrow-1", kind: "arrow" })
    );

    expect(circle).toContain("<circle");
    expect(arrow).toContain("<path");
    expect(arrow).not.toContain(`fill="${NOTE_SHAPE_DEFAULT_FILL}"`);
  });
});
