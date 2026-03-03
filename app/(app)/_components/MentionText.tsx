import { splitTextWithMentions } from "@/lib/mentions";

type MentionTextProps = {
  text: string;
  className?: string;
  mentionClassName?: string;
  as?: "p" | "span" | "div";
};

export default function MentionText({
  text,
  className = "",
  mentionClassName = "mention-highlight",
  as = "p",
}: MentionTextProps) {
  const Component = as;
  const segments = splitTextWithMentions(String(text || ""));

  return (
    <Component className={className}>
      {segments.map((segment, index) =>
        segment.type === "mention" ? (
          <mark key={`mention-${index}`} className={mentionClassName}>
            {segment.value}
          </mark>
        ) : (
          <span key={`text-${index}`}>{segment.value}</span>
        )
      )}
    </Component>
  );
}

