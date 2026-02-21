"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";

type ResilientCreateSubmitButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "children"
> & {
  children: ReactNode;
  pendingLabel?: ReactNode;
  softRefreshDelayMs?: number;
  hardReloadDelayMs?: number;
};

export default function ResilientCreateSubmitButton({
  children,
  pendingLabel = "Creating...",
  softRefreshDelayMs = 650,
  hardReloadDelayMs = 1800,
  disabled,
  ...props
}: ResilientCreateSubmitButtonProps) {
  const { pending } = useFormStatus();
  const router = useRouter();
  const softRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearTimers = () => {
      if (softRefreshTimerRef.current) {
        clearTimeout(softRefreshTimerRef.current);
        softRefreshTimerRef.current = null;
      }
      if (hardReloadTimerRef.current) {
        clearTimeout(hardReloadTimerRef.current);
        hardReloadTimerRef.current = null;
      }
    };

    if (!pending) {
      clearTimers();
      return clearTimers;
    }

    softRefreshTimerRef.current = setTimeout(() => {
      try {
        router.refresh();
      } catch {
        // no-op
      }
    }, softRefreshDelayMs);

    hardReloadTimerRef.current = setTimeout(() => {
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    }, hardReloadDelayMs);

    return clearTimers;
  }, [hardReloadDelayMs, pending, router, softRefreshDelayMs]);

  const isDisabled = Boolean(disabled) || pending;

  return (
    <button type="submit" disabled={isDisabled} {...props}>
      {pending ? pendingLabel : children}
    </button>
  );
}
