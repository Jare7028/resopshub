export function createEmptyDoc() {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

export const DEFAULT_EDITOR_CONTENT = createEmptyDoc();
