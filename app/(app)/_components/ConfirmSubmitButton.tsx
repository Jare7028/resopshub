"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

type ConfirmSubmitButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "onClick"
> & {
  confirmText: string;
  children: ReactNode;
  pendingLabel?: ReactNode;
};

export default function ConfirmSubmitButton({
  confirmText,
  children,
  pendingLabel = "Working...",
  ...props
}: ConfirmSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      {...props}
      disabled={pending || props.disabled}
      onClick={(event) => {
        if (pending || props.disabled) {
          event.preventDefault();
          return;
        }
        if (!confirm(confirmText)) {
          event.preventDefault();
        }
      }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
