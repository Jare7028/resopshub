"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type RouteModalOverlayProps = {
  closeHref: string;
  overlayLabel: string;
  children: ReactNode;
  fallbackDelayMs?: number;
};

export default function RouteModalOverlay({
  closeHref,
  overlayLabel,
  children,
  fallbackDelayMs = 1200,
}: RouteModalOverlayProps) {
  const router = useRouter();
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeModal = useCallback(() => {
    router.replace(closeHref, { scroll: false });
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
    }
    fallbackTimerRef.current = setTimeout(() => {
      window.location.assign(closeHref);
    }, fallbackDelayMs);
  }, [closeHref, fallbackDelayMs, router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      closeModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeModal]);

  useEffect(() => {
    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[200]">
      <button
        type="button"
        aria-label={overlayLabel}
        onClick={closeModal}
        className="absolute inset-0 block bg-slate-900/35 backdrop-blur-[2px]"
      />
      {children}
    </div>
  );
}
