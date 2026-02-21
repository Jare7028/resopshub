export const COMMON_EMOJI_OPTIONS = [
  "\u{1F600}",
  "\u{1F604}",
  "\u{1F601}",
  "\u{1F60E}",
  "\u{1F973}",
  "\u{1F64F}",
  "\u{1F44F}",
  "\u{1F64C}",
  "\u{1F44D}",
  "\u{1F44E}",
  "\u{1F4AA}",
  "\u{1F525}",
  "\u{1F389}",
  "\u{2705}",
  "\u{1F680}",
  "\u{1F4A1}",
  "\u{2764}\u{FE0F}",
  "\u{1F440}",
  "\u{1F91D}",
  "\u{1F4CC}",
  "\u{1F9E0}",
  "\u{1F4AC}",
  "\u{1F4E3}",
  "\u{2B50}",
] as const;

export function insertTextAtSelection(input: {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  text: string;
}) {
  const { value, selectionStart, selectionEnd, text } = input;
  const boundedStart = Math.max(0, Math.min(selectionStart, value.length));
  const boundedEnd = Math.max(boundedStart, Math.min(selectionEnd, value.length));
  const nextValue = `${value.slice(0, boundedStart)}${text}${value.slice(boundedEnd)}`;
  const nextSelection = boundedStart + text.length;
  return { nextValue, nextSelection };
}
