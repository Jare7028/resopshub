"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export default function AppResumeRefresh({
  idleThresholdMs = 90_000,
  minRefreshGapMs = 10_000,
}: {
  idleThresholdMs?: number;
  minRefreshGapMs?: number;
}) {
  const router = useRouter();
  const hiddenAtRef = useRef<number | null>(null);
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    const maybeRefresh = () => {
      const now = Date.now();
      const hiddenAt = hiddenAtRef.current;
      const wasIdle = hiddenAt !== null && now - hiddenAt >= idleThresholdMs;
      if (!wasIdle) return;
      if (now - lastRefreshAtRef.current < minRefreshGapMs) return;

      lastRefreshAtRef.current = now;
      hiddenAtRef.current = null;
      router.refresh();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      maybeRefresh();
    };

    const onFocus = () => {
      maybeRefresh();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
    };
  }, [idleThresholdMs, minRefreshGapMs, router]);

  return null;
}

