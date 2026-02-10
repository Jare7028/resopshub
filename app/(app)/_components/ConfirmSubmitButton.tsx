"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type ConfirmSubmitButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "onClick"
> & {
  confirmText: string;
  children: ReactNode;
};

export default function ConfirmSubmitButton({
  confirmText,
  children,
  ...props
}: ConfirmSubmitButtonProps) {
  return (
    <button
      type="submit"
      {...props}
      onClick={(event) => {
        if (!confirm(confirmText)) {
          event.preventDefault();
        }
      }}
    >
      {children}
    </button>
  );
}

