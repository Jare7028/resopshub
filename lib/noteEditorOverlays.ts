export type NoteShapeKind = "rectangle" | "square" | "circle" | "arrow";

export type NoteShapeAttrs = {
  objectId: string;
  kind: NoteShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  stroke: string;
  fill: string;
  zIndex: number;
};

export type NoteTextBoxAttrs = {
  objectId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
};

type OverlayInsertEditorNode = {
  type: {
    name: string;
  };
};

export type OverlayInsertEditorLike = {
  state: {
    doc: {
      descendants: (callback: (node: OverlayInsertEditorNode) => boolean | void) => void;
    };
    selection: {
      from: number;
    };
  };
  view: {
    coordsAtPos: (position: number) => { left: number; top: number };
    dom: {
      getBoundingClientRect: () => { left: number; top: number };
      scrollLeft?: number;
      scrollTop?: number;
    };
  };
};

export const NOTE_SHAPE_DEFAULT_STROKE = "#0f172a";
export const NOTE_SHAPE_DEFAULT_FILL = "#ffffff";
export const NOTE_TEXTBOX_DEFAULT_WIDTH = 260;
export const NOTE_TEXTBOX_DEFAULT_HEIGHT = 150;

const NOTE_SHAPE_KIND_SET = new Set<NoteShapeKind>([
  "rectangle",
  "square",
  "circle",
  "arrow",
]);

export const NOTE_SHAPE_INSERT_OPTIONS: ReadonlyArray<{
  kind: NoteShapeKind;
  label: string;
}> = [
  { kind: "rectangle", label: "Rectangle" },
  { kind: "square", label: "Square" },
  { kind: "circle", label: "Circle" },
  { kind: "arrow", label: "Arrow" },
];

export function normalizeNoteShapeKind(value: string | null | undefined): NoteShapeKind {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (NOTE_SHAPE_KIND_SET.has(normalized as NoteShapeKind)) {
    return normalized as NoteShapeKind;
  }
  return "rectangle";
}

function normalizeShapeNumber(
  value: unknown,
  fallback: number,
  options?: { min?: number; max?: number }
) {
  const parsed = Number(value);
  let next = Number.isFinite(parsed) ? parsed : fallback;
  if (typeof options?.min === "number") {
    next = Math.max(options.min, next);
  }
  if (typeof options?.max === "number") {
    next = Math.min(options.max, next);
  }
  return Math.round(next);
}

export function createOverlayObjectId() {
  try {
    if (
      typeof globalThis !== "undefined" &&
      globalThis.crypto &&
      typeof globalThis.crypto.randomUUID === "function"
    ) {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Ignore unsupported randomUUID environments.
  }
  return `overlay_${Math.random().toString(36).slice(2, 10)}`;
}

export function getDefaultShapeSize(kind: NoteShapeKind) {
  if (kind === "arrow") {
    return { width: 220, height: 86 };
  }
  if (kind === "rectangle") {
    return { width: 150, height: 104 };
  }
  return { width: 110, height: 110 };
}

function countEditorNodesByType(editor: OverlayInsertEditorLike, typeName: string) {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === typeName) {
      count += 1;
    }
    return true;
  });
  return count;
}

function getOverlayInsertPosition(editor: OverlayInsertEditorLike, offset: number) {
  let x = 24 + offset;
  let y = 24 + offset;
  try {
    const cursor = editor.view.coordsAtPos(editor.state.selection.from);
    const editorRect = editor.view.dom.getBoundingClientRect();
    x = Math.max(
      8,
      Math.round(cursor.left - editorRect.left + (editor.view.dom.scrollLeft || 0) + offset)
    );
    y = Math.max(
      8,
      Math.round(cursor.top - editorRect.top + (editor.view.dom.scrollTop || 0) + offset)
    );
  } catch {
    // Keep fallback placement when selection coordinates are unavailable.
  }
  return { x, y };
}

export function buildInsertNoteShapeAttrs(
  editor: OverlayInsertEditorLike,
  kind: NoteShapeKind
) {
  const { width, height } = getDefaultShapeSize(kind);
  const existingShapeCount = countEditorNodesByType(editor, "noteShape");
  const offset = (existingShapeCount % 6) * 18;
  const { x, y } = getOverlayInsertPosition(editor, offset);

  return normalizeNoteShapeAttrs({
    objectId: createOverlayObjectId(),
    kind,
    x,
    y,
    width,
    height,
    stroke: NOTE_SHAPE_DEFAULT_STROKE,
    fill: kind === "arrow" ? "transparent" : NOTE_SHAPE_DEFAULT_FILL,
    zIndex: 20 + existingShapeCount,
  });
}

export function buildInsertNoteTextBoxAttrs(editor: OverlayInsertEditorLike) {
  const existingTextBoxCount = countEditorNodesByType(editor, "noteTextBox");
  const offset = (existingTextBoxCount % 6) * 20;
  const { x, y } = getOverlayInsertPosition(editor, offset);

  return normalizeNoteTextBoxAttrs({
    objectId: createOverlayObjectId(),
    x,
    y,
    width: NOTE_TEXTBOX_DEFAULT_WIDTH,
    height: NOTE_TEXTBOX_DEFAULT_HEIGHT,
    zIndex: 24 + existingTextBoxCount,
  });
}

export function normalizeNoteShapeAttrs(
  attrs: Record<string, unknown> | null | undefined
): NoteShapeAttrs {
  const kind = normalizeNoteShapeKind(String(attrs?.kind || ""));
  const defaults = getDefaultShapeSize(kind);
  let width = normalizeShapeNumber(attrs?.width, defaults.width, { min: 56, max: 1400 });
  let height = normalizeShapeNumber(attrs?.height, defaults.height, {
    min: 56,
    max: 1200,
  });
  if (kind === "square" || kind === "circle") {
    const size = Math.max(width, height);
    width = size;
    height = size;
  }
  return {
    objectId:
      typeof attrs?.objectId === "string" && attrs.objectId.trim()
        ? attrs.objectId.trim()
        : createOverlayObjectId(),
    kind,
    x: normalizeShapeNumber(attrs?.x, 24, { min: 0, max: 4000 }),
    y: normalizeShapeNumber(attrs?.y, 24, { min: 0, max: 4000 }),
    width,
    height,
    stroke:
      String(attrs?.stroke || NOTE_SHAPE_DEFAULT_STROKE).trim() ||
      NOTE_SHAPE_DEFAULT_STROKE,
    fill:
      kind === "arrow"
        ? "transparent"
        : String(attrs?.fill || NOTE_SHAPE_DEFAULT_FILL).trim() ||
          NOTE_SHAPE_DEFAULT_FILL,
    zIndex: normalizeShapeNumber(attrs?.zIndex, 20, { min: 1, max: 200 }),
  };
}

export function normalizeNoteTextBoxAttrs(
  attrs: Record<string, unknown> | null | undefined
): NoteTextBoxAttrs {
  return {
    objectId:
      typeof attrs?.objectId === "string" && attrs.objectId.trim()
        ? attrs.objectId.trim()
        : createOverlayObjectId(),
    x: normalizeShapeNumber(attrs?.x, 24, { min: 0, max: 4000 }),
    y: normalizeShapeNumber(attrs?.y, 24, { min: 0, max: 4000 }),
    width: normalizeShapeNumber(attrs?.width, NOTE_TEXTBOX_DEFAULT_WIDTH, {
      min: 180,
      max: 1800,
    }),
    height: normalizeShapeNumber(attrs?.height, NOTE_TEXTBOX_DEFAULT_HEIGHT, {
      min: 100,
      max: 1400,
    }),
    zIndex: normalizeShapeNumber(attrs?.zIndex, 24, { min: 1, max: 200 }),
  };
}

export function areNoteTextBoxAttrsEqual(
  left: NoteTextBoxAttrs,
  right: NoteTextBoxAttrs
) {
  return (
    left.objectId === right.objectId &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.zIndex === right.zIndex
  );
}

export function getShapeSvgMarkup(attrs: NoteShapeAttrs) {
  const width = Math.max(8, attrs.width);
  const height = Math.max(8, attrs.height);
  const stroke = attrs.stroke || NOTE_SHAPE_DEFAULT_STROKE;
  const fill = attrs.kind === "arrow" ? "none" : attrs.fill || NOTE_SHAPE_DEFAULT_FILL;

  if (attrs.kind === "circle") {
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.max(8, Math.min(width, height) / 2 - 4);
    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="2"/></svg>`;
  }

  if (attrs.kind === "arrow") {
    const centerY = Math.round(height / 2);
    const headStart = Math.max(34, width - Math.max(28, Math.round(height * 0.6)));
    const topY = Math.max(8, centerY - Math.max(8, Math.round(height * 0.2)));
    const bottomY = Math.min(height - 8, centerY + Math.max(8, Math.round(height * 0.2)));
    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><path d="M8 ${centerY} H ${headStart}" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/><path d="M${headStart} ${topY} L ${width - 8} ${centerY} L ${headStart} ${bottomY}" fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  const cornerRadius = attrs.kind === "square" ? 4 : 10;
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="${Math.max(8, width - 6)}" height="${Math.max(8, height - 6)}" rx="${cornerRadius}" fill="${fill}" stroke="${stroke}" stroke-width="2"/></svg>`;
}

export function areNoteShapeAttrsEqual(left: NoteShapeAttrs, right: NoteShapeAttrs) {
  return (
    left.objectId === right.objectId &&
    left.kind === right.kind &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.stroke === right.stroke &&
    left.fill === right.fill &&
    left.zIndex === right.zIndex
  );
}
