"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const SHOW_DELAY_MS = 120;
const FAILSAFE_HIDE_MS = 15000;
const HARD_NAV_FALLBACK_MS = 2200;

export default function GlobalLoadingIndicator() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();

  const [visible, setVisible] = useState(false);

  const navigationPendingRef = useRef(false);
  const pendingNavigationHrefRef = useRef<string | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failsafeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const clearHardFallbackTimer = useCallback(() => {
    if (hardFallbackTimerRef.current) {
      clearTimeout(hardFallbackTimerRef.current);
      hardFallbackTimerRef.current = null;
    }
  }, []);

  const startFailsafeTimer = useCallback(() => {
    clearFailsafeTimer();
    failsafeTimerRef.current = setTimeout(() => {
      navigationPendingRef.current = false;
      pendingNavigationHrefRef.current = null;
      setVisible(false);
    }, FAILSAFE_HIDE_MS);
  }, [clearFailsafeTimer]);

  const startLoading = useCallback(() => {
    clearShowTimer();
    showTimerRef.current = setTimeout(() => {
      setVisible(true);
    }, SHOW_DELAY_MS);
    startFailsafeTimer();
  }, [clearShowTimer, startFailsafeTimer]);

  const stopLoading = useCallback(() => {
    navigationPendingRef.current = false;
    pendingNavigationHrefRef.current = null;
    clearShowTimer();
    clearFailsafeTimer();
    clearHardFallbackTimer();
    setVisible(false);
  }, [clearFailsafeTimer, clearHardFallbackTimer, clearShowTimer]);

  useEffect(() => {
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

      navigationPendingRef.current = true;
      pendingNavigationHrefRef.current = nextUrl.toString();
      startLoading();

      const originPathAndSearch = `${window.location.pathname}${window.location.search}`;
      clearHardFallbackTimer();
      hardFallbackTimerRef.current = setTimeout(() => {
        const pendingHref = pendingNavigationHrefRef.current;
        if (!navigationPendingRef.current || !pendingHref) {
          return;
        }
        const currentPathAndSearch = `${window.location.pathname}${window.location.search}`;
        if (currentPathAndSearch !== originPathAndSearch) {
          return;
        }
        window.location.assign(pendingHref);
      }, HARD_NAV_FALLBACK_MS);
    };

    const handleSubmit = () => {
      navigationPendingRef.current = true;
      pendingNavigationHrefRef.current = null;
      clearHardFallbackTimer();
      startLoading();
    };

    document.addEventListener("click", handleLinkClick, true);
    document.addEventListener("submit", handleSubmit, true);

    return () => {
      document.removeEventListener("click", handleLinkClick, true);
      document.removeEventListener("submit", handleSubmit, true);
      stopLoading();
    };
  }, [
    clearHardFallbackTimer,
    startLoading,
    stopLoading,
  ]);

  useEffect(() => {
    if (!navigationPendingRef.current) {
      return;
    }
    stopLoading();
  }, [pathname, searchKey, stopLoading]);

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
