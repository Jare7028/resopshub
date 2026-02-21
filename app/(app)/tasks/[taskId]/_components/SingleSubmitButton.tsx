"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

type SingleSubmitButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "children"
> & {
  children: ReactNode;
  pendingLabel?: ReactNode;
};

export default function SingleSubmitButton({
  children,
  pendingLabel = "Saving...",
  disabled,
  ...props
}: SingleSubmitButtonProps) {
  const { pending } = useFormStatus();
  const isDisabled = Boolean(disabled) || pending;

  return (
    <button
      type="submit"
      {...props}
      disabled={isDisabled}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
