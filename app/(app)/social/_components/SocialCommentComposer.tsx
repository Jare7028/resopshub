"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import EmojiPickerButton from "@/app/(app)/_components/EmojiPickerButton";
import { insertTextAtSelection } from "@/lib/emoji";

function SubmitButton({
  disabled,
  label,
}: {
  disabled: boolean;
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Adding..." : label}
    </button>
  );
}

export default function SocialCommentComposer({
  postId,
  canPost,
  commentAction,
  parentCommentId = "",
  placeholder = "Write a comment",
  submitLabel = "Add comment",
  className = "mt-2 flex flex-col gap-2",
}: {
  postId: string;
  canPost: boolean;
  commentAction: (formData: FormData) => Promise<void>;
  parentCommentId?: string;
  placeholder?: string;
  submitLabel?: string;
  className?: string;
}) {
  const [body, setBody] = useState("");
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const insertEmoji = (emoji: string) => {
    setBody((current) => {
      const textarea = bodyTextareaRef.current;
      const selectionStart = textarea?.selectionStart ?? current.length;
      const selectionEnd = textarea?.selectionEnd ?? current.length;
      const { nextValue, nextSelection } = insertTextAtSelection({
        value: current,
        selectionStart,
        selectionEnd,
        text: emoji,
      });
      requestAnimationFrame(() => {
        const nextTextarea = bodyTextareaRef.current;
        if (!nextTextarea) return;
        nextTextarea.focus();
        nextTextarea.setSelectionRange(nextSelection, nextSelection);
      });
      return nextValue;
    });
  };

  return (
    <form action={commentAction} className={className}>
      <input type="hidden" name="post_id" value={postId} />
      {parentCommentId ? (
        <input type="hidden" name="parent_comment_id" value={parentCommentId} />
      ) : null}
      <textarea
        ref={bodyTextareaRef}
        name="body"
        rows={2}
        placeholder={placeholder}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        disabled={!canPost}
        required
      />
      <div className="flex items-center justify-between">
        <EmojiPickerButton onSelect={insertEmoji} disabled={!canPost} />
        <SubmitButton disabled={!canPost || !body.trim()} label={submitLabel} />
      </div>
    </form>
  );
}
