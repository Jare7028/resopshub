export const SOCIAL_INLINE_IMAGE_TOKEN_PATTERN = /\[\[img:([^[\]]+)\]\]/g;

export function buildSocialInlineImageToken(storagePath: string) {
  const path = String(storagePath || "").trim();
  if (!path) return "";
  return `[[img:${path}]]`;
}

export function stripSocialInlineImageTokens(value: string) {
  return String(value || "").replace(SOCIAL_INLINE_IMAGE_TOKEN_PATTERN, "").trim();
}

export type SocialInlineContentSegment =
  | { type: "text"; key: string; text: string }
  | { type: "image"; key: string; storagePath: string };

export function splitSocialInlineContent(value: string): SocialInlineContentSegment[] {
  const source = String(value || "");
  const segments: SocialInlineContentSegment[] = [];
  let match: RegExpExecArray | null;
  let cursor = 0;
  let index = 0;

  const pattern = new RegExp(SOCIAL_INLINE_IMAGE_TOKEN_PATTERN.source, "g");
  while ((match = pattern.exec(source)) !== null) {
    const start = match.index;
    const end = pattern.lastIndex;
    const storagePath = String(match[1] || "").trim();

    if (start > cursor) {
      const text = source.slice(cursor, start);
      if (text) {
        segments.push({ type: "text", key: `text-${index}`, text });
        index += 1;
      }
    }

    if (storagePath) {
      segments.push({ type: "image", key: `image-${index}`, storagePath });
      index += 1;
    }

    cursor = end;
  }

  if (cursor < source.length) {
    const text = source.slice(cursor);
    if (text) {
      segments.push({ type: "text", key: `text-${index}`, text });
    }
  }

  if (!segments.length) {
    return [{ type: "text", key: "text-0", text: source }];
  }

  return segments;
}
