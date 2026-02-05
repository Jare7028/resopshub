function collectText(value: unknown, parts: string[]) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, parts));
    return;
  }

  if (typeof value === "object") {
    const node = value as { text?: unknown; content?: unknown };
    if (typeof node.text === "string") {
      parts.push(node.text);
    }
    if (node.content) {
      collectText(node.content, parts);
    }
  }
}

export function extractPlainText(value: unknown) {
  const parts: string[] = [];
  collectText(value, parts);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
