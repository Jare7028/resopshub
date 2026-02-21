"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect, useState } from "react";
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
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!pending) {
      setSubmitted(false);
    }
  }, [pending]);

  const isDisabled = Boolean(disabled) || pending || submitted;

  return (
    <button
      type="submit"
      {...props}
      disabled={isDisabled}
      onClick={(event) => {
        if (isDisabled) {
          event.preventDefault();
          return;
        }
        setSubmitted(true);
      }}
    >
      {pending || submitted ? pendingLabel : children}
    </button>
  );
}
