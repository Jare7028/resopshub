"use client";

import { useEffect } from "react";

function isPopoverDetails(details: HTMLDetailsElement) {
  const explicitSetting = details.dataset.outsideClose;
  if (explicitSetting === "true") return true;
  if (explicitSetting === "false") return false;

  if (details.classList.contains("relative")) return true;

  const panel = Array.from(details.children).find(
    (child) => child.tagName !== "SUMMARY"
  ) as HTMLElement | undefined;
  if (!panel) return false;

  const position = window.getComputedStyle(panel).position;
  return position === "absolute" || position === "fixed";
}

function getOpenPopoverDetails() {
  return Array.from(
    document.querySelectorAll<HTMLDetailsElement>("details[open]")
  ).filter(isPopoverDetails);
}

export default function GlobalDetailsOutsideClose() {
  useEffect(() => {
    const closeOutside = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return;

      const openDetails = getOpenPopoverDetails();
      if (!openDetails.length) return;

      for (const details of openDetails) {
        if (details.contains(target)) continue;
        details.open = false;
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      closeOutside(event.target);
    };

    const handleFocusIn = (event: FocusEvent) => {
      closeOutside(event.target);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      for (const details of getOpenPopoverDetails()) {
        details.open = false;
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("keydown", handleEscape, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, []);

  return null;
}

