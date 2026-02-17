"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const RECENT_INTERACTION_MS = 1500;
const SHOW_DELAY_MS = 120;
const FAILSAFE_HIDE_MS = 15000;

export default function GlobalLoadingIndicator() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();

  const [visible, setVisible] = useState(false);

  const interactionAtRef = useRef(0);
  const inflightUserRequestsRef = useRef(0);
  const navigationPendingRef = useRef(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failsafeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  const clearFailsafeTimer = useCallback(() => {
    if (failsafeTimerRef.current) {
      clearTimeout(failsafeTimerRef.current);
      failsafeTimerRef.current = null;
    }
  }, []);

  const startFailsafeTimer = useCallback(() => {
    clearFailsafeTimer();
    failsafeTimerRef.current = setTimeout(() => {
      inflightUserRequestsRef.current = 0;
      navigationPendingRef.current = false;
      setVisible(false);
    }, FAILSAFE_HIDE_MS);
  }, [clearFailsafeTimer]);

  const shouldTrackAsUserInitiated = useCallback(() => {
    return Date.now() - interactionAtRef.current <= RECENT_INTERACTION_MS;
  }, []);

  const startLoading = useCallback(() => {
    clearShowTimer();
    showTimerRef.current = setTimeout(() => {
      setVisible(true);
    }, SHOW_DELAY_MS);
    startFailsafeTimer();
  }, [clearShowTimer, startFailsafeTimer]);

  const stopLoadingIfIdle = useCallback(() => {
    if (inflightUserRequestsRef.current === 0 && !navigationPendingRef.current) {
      clearShowTimer();
      clearFailsafeTimer();
      setVisible(false);
    }
  }, [clearFailsafeTimer, clearShowTimer]);

  useEffect(() => {
    const markInteraction = () => {
      interactionAtRef.current = Date.now();
    };

    const handleLinkClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as Element | null;
      const link = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!link) return;
      if (link.target && link.target !== "_self") return;
      if (link.hasAttribute("download")) return;

      const href = link.getAttribute("href");
      if (!href) return;
      if (
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("javascript:")
      ) {
        return;
      }

      const nextUrl = new URL(link.href, window.location.href);
      if (nextUrl.origin !== window.location.origin) return;

      // Only hash changed, no route/data load expected.
      if (
        nextUrl.pathname === window.location.pathname &&
        nextUrl.search === window.location.search &&
        nextUrl.hash
      ) {
        return;
      }

      markInteraction();
      navigationPendingRef.current = true;
      startLoading();
    };

    const handleSubmit = () => {
      markInteraction();
      startLoading();
    };

    const handlePointerDown = () => {
      markInteraction();
    };

    const handleKeyDown = () => {
      markInteraction();
    };

    document.addEventListener("click", handleLinkClick, true);
    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const userInitiated = shouldTrackAsUserInitiated();
      if (userInitiated) {
        inflightUserRequestsRef.current += 1;
        startLoading();
      }

      try {
        return await originalFetch(...args);
      } finally {
        if (userInitiated) {
          inflightUserRequestsRef.current = Math.max(0, inflightUserRequestsRef.current - 1);
          stopLoadingIfIdle();
        }
      }
    };

    return () => {
      window.fetch = originalFetch;
      document.removeEventListener("click", handleLinkClick, true);
      document.removeEventListener("submit", handleSubmit, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      clearShowTimer();
      clearFailsafeTimer();
    };
  }, [
    clearFailsafeTimer,
    clearShowTimer,
    shouldTrackAsUserInitiated,
    startLoading,
    stopLoadingIfIdle,
  ]);

  useEffect(() => {
    navigationPendingRef.current = false;
    stopLoadingIfIdle();
  }, [pathname, searchKey, stopLoadingIfIdle]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700 bg-white/85 shadow-md"
        aria-hidden="true"
      />
      <span className="sr-only" role="status" aria-live="polite">
        Loading
      </span>
    </div>
  );
}
