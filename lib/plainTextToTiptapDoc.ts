import { createEmptyDoc } from "./editorContent";

type TiptapDoc = {
  type: "doc";
  content: Array<Record<string, unknown>>;
};

export function plainTextToTiptapDoc(text: string) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trimEnd();
  if (!normalized.trim()) {
    return createEmptyDoc() as TiptapDoc;
  }

  const lines = normalized.split("\n");
  const content = lines.map((line) => {
    const value = line.trimEnd();
    if (!value) {
      return { type: "paragraph" };
    }
    return {
      type: "paragraph",
      content: [{ type: "text", text: value }],
    };
  });

  return { type: "doc", content } as TiptapDoc;
}

