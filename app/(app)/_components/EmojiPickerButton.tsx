"use client";

import { useEffect, useRef, useState } from "react";
import { COMMON_EMOJI_OPTIONS } from "@/lib/emoji";

type EmojiPickerButtonProps = {
  onSelect: (emoji: string) => void;
  disabled?: boolean;
  panelAlign?: "left" | "right";
  className?: string;
};

export default function EmojiPickerButton({
  onSelect,
  disabled = false,
  panelAlign = "left",
  className,
}: EmojiPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        title="Add emoji"
        aria-label="Add emoji"
        className={
          className ||
          "inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-[15px] w-[15px]"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M8 15s1.5 2 4 2 4-2 4-2" />
          <line x1="9" y1="10" x2="9.01" y2="10" />
          <line x1="15" y1="10" x2="15.01" y2="10" />
        </svg>
      </button>

      {open ? (
        <div
          className={`absolute bottom-9 z-30 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl ${
            panelAlign === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="grid grid-cols-8 gap-1">
            {COMMON_EMOJI_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="rounded-md p-1 text-lg leading-none hover:bg-slate-100"
                onClick={() => {
                  onSelect(emoji);
                  setOpen(false);
                }}
                aria-label={`Insert ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
