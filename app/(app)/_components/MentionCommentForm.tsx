"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import MentionTextarea from "@/app/(app)/_components/MentionTextarea";

function SubmitButton({
  disabled,
  submitLabel,
  pendingLabel,
  className,
}: {
  disabled: boolean;
  submitLabel: string;
  pendingLabel: string;
  className: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={disabled || pending} className={className}>
      {pending ? pendingLabel : submitLabel}
    </button>
  );
}

export default function MentionCommentForm({
  action,
  disabled = false,
  placeholder = "Add a comment",
  submitLabel = "Add comment",
  pendingLabel = "Adding...",
  rows = 3,
  className = "space-y-3",
  textareaClassName = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm",
  buttonClassName = "rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white",
}: {
  action: (formData: FormData) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  submitLabel?: string;
  pendingLabel?: string;
  rows?: number;
  className?: string;
  textareaClassName?: string;
  buttonClassName?: string;
}) {
  const [body, setBody] = useState("");

  return (
    <form action={action} className={className}>
      <MentionTextarea
        name="body"
        rows={rows}
        placeholder={placeholder}
        value={body}
        onValueChange={setBody}
        className={textareaClassName}
        required
        disabled={disabled}
      />
      <SubmitButton
        disabled={disabled || !body.trim()}
        submitLabel={submitLabel}
        pendingLabel={pendingLabel}
        className={buttonClassName}
      />
    </form>
  );
}
