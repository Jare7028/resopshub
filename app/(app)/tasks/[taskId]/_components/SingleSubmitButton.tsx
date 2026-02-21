"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const isDisabled = Boolean(disabled) || pending;

  useEffect(() => {
    if (!pending) return;
    const refreshTimer = window.setTimeout(() => {
      router.refresh();
    }, 1800);
    return () => window.clearTimeout(refreshTimer);
  }, [pending, router]);

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
