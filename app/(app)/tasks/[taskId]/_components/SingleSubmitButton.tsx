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
    const softRefreshTimer = window.setTimeout(() => {
      router.refresh();
    }, 900);
    const hardRefreshTimer = window.setTimeout(() => {
      window.location.reload();
    }, 3200);
    return () => {
      window.clearTimeout(softRefreshTimer);
      window.clearTimeout(hardRefreshTimer);
    };
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
