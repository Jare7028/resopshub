"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";

type MentionSuggestion = {
  id: string;
  handle: string;
  full_name: string | null;
  email: string | null;
};

type MentionRange = {
  start: number;
  end: number;
  query: string;
};

type MentionTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
> & {
  value: string;
  onValueChange: (value: string) => void;
  containerClassName?: string;
  menuClassName?: string;
  suggestionLimit?: number;
  onMentionSelect?: (item: MentionSuggestion) => void;
};

type MentionMenuState = {
  open: boolean;
  query: string;
  range: MentionRange | null;
  items: MentionSuggestion[];
  index: number;
  loading: boolean;
  error: string;
};

const DEFAULT_LIMIT = 8;
const FETCH_DEBOUNCE_MS = 120;
const HANDLE_ALLOWED_CHAR_REGEX = /^[a-z0-9._@-]*$/i;

const initialMentionMenuState: MentionMenuState = {
  open: false,
  query: "",
  range: null,
  items: [],
  index: 0,
  loading: false,
  error: "",
};

function assignForwardedRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) {
    ref.current = value;
  }
}

function parseMentionRange(value: string, caret: number): MentionRange | null {
  if (!Number.isFinite(caret) || caret < 0 || caret > value.length) {
    return null;
  }

  const beforeCaret = value.slice(0, caret);
  const atIndex = beforeCaret.lastIndexOf("@");
  if (atIndex < 0) {
    return null;
  }

  const previousChar = atIndex > 0 ? beforeCaret.charAt(atIndex - 1) : "";
  if (previousChar && /[a-z0-9._-]/i.test(previousChar)) {
    return null;
  }

  const token = beforeCaret.slice(atIndex + 1);
  if (/\s/.test(token)) {
    return null;
  }
  if (!HANDLE_ALLOWED_CHAR_REGEX.test(token)) {
    return null;
  }

  return {
    start: atIndex,
    end: caret,
    query: token.toLowerCase(),
  };
}

function isMentionSuggestion(value: unknown): value is MentionSuggestion {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.handle === "string" &&
    (typeof item.full_name === "string" || item.full_name === null) &&
    (typeof item.email === "string" || item.email === null)
  );
}

function getSuggestionPrimaryLabel(item: MentionSuggestion) {
  return String(item.full_name || item.email || item.handle || "Unknown user");
}

function getSuggestionSecondaryLabel(item: MentionSuggestion) {
  const normalizedHandle = String(item.handle || "").trim();
  const mentionHandle = normalizedHandle ? `@${normalizedHandle}` : "";
  if (item.full_name && item.email) {
    return `${item.email} - ${mentionHandle}`;
  }
  if (item.email) {
    return mentionHandle ? `${item.email} - ${mentionHandle}` : item.email;
  }
  return mentionHandle;
}

function getSuggestionInitials(item: MentionSuggestion) {
  const label = getSuggestionPrimaryLabel(item);
  const words = label
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (!words.length) return "NA";
  return words.map((word) => word.charAt(0).toUpperCase()).join("");
}

const MentionTextarea = forwardRef<HTMLTextAreaElement, MentionTextareaProps>(
  function MentionTextarea(props, forwardedRef) {
    const {
      value,
      onValueChange,
      containerClassName = "",
      menuClassName = "",
      className = "",
      disabled,
      suggestionLimit = DEFAULT_LIMIT,
      onMentionSelect,
      onKeyDown,
      onBlur,
      onClick,
      onSelect,
      onFocus,
      ...textareaProps
    } = props;

    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const mentionRequestIdRef = useRef(0);
    const mentionFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mentionFetchAbortRef = useRef<AbortController | null>(null);
    const [mentionMenu, setMentionMenu] =
      useState<MentionMenuState>(initialMentionMenuState);

    const closeMentionMenu = useCallback(() => {
      setMentionMenu((previous) =>
        previous.open ||
        previous.query ||
        previous.range ||
        previous.items.length ||
        previous.loading ||
        previous.error
          ? initialMentionMenuState
          : previous
      );
    }, []);

    const setTextareaRef = useCallback(
      (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node;
        assignForwardedRef(forwardedRef, node);
      },
      [forwardedRef]
    );

    const updateMentionMenuFromCaret = useCallback(
      (nextValue: string, caret: number | null) => {
        if (disabled || caret === null) {
          closeMentionMenu();
          return;
        }
        const range = parseMentionRange(nextValue, caret);
        if (!range) {
          closeMentionMenu();
          return;
        }

        setMentionMenu((previous) => {
          const keepItems = previous.open && previous.query === range.query;
          const nextItems = keepItems ? previous.items : [];
          const maxIndex = Math.max(nextItems.length - 1, 0);
          return {
            open: true,
            query: range.query,
            range,
            items: nextItems,
            index: keepItems ? Math.min(previous.index, maxIndex) : 0,
            loading: keepItems ? previous.loading : true,
            error: keepItems ? previous.error : "",
          };
        });
      },
      [closeMentionMenu, disabled]
    );

    const applyMentionSuggestion = useCallback(
      (item: MentionSuggestion) => {
        const activeRange = mentionMenu.range;
        const textarea = textareaRef.current;
        if (!activeRange || !textarea) {
          return;
        }

        const before = value.slice(0, activeRange.start);
        const after = value.slice(activeRange.end);
        const nextText = `${before}@${item.handle} ${after}`;
        const nextCaretPosition = before.length + item.handle.length + 2;
        onValueChange(nextText);
        closeMentionMenu();
        onMentionSelect?.(item);

        requestAnimationFrame(() => {
          const nextTextarea = textareaRef.current;
          if (!nextTextarea) return;
          nextTextarea.focus();
          nextTextarea.setSelectionRange(nextCaretPosition, nextCaretPosition);
          updateMentionMenuFromCaret(nextText, nextCaretPosition);
        });
      },
      [
        closeMentionMenu,
        mentionMenu.range,
        onMentionSelect,
        onValueChange,
        updateMentionMenuFromCaret,
        value,
      ]
    );

    useEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        closeMentionMenu();
        return;
      }
      const selectionStart = textarea.selectionStart;
      const caret =
        typeof selectionStart === "number" ? selectionStart : value.length;
      updateMentionMenuFromCaret(value, caret);
    }, [closeMentionMenu, disabled, updateMentionMenuFromCaret, value]);

    useEffect(() => {
      if (!mentionMenu.open) {
        if (mentionFetchTimerRef.current) {
          clearTimeout(mentionFetchTimerRef.current);
          mentionFetchTimerRef.current = null;
        }
        if (mentionFetchAbortRef.current) {
          mentionFetchAbortRef.current.abort();
          mentionFetchAbortRef.current = null;
        }
        return;
      }

      const query = mentionMenu.query;
      const requestId = mentionRequestIdRef.current + 1;
      mentionRequestIdRef.current = requestId;
      const nextLimit = Math.max(1, Math.min(12, Number(suggestionLimit) || DEFAULT_LIMIT));

      setMentionMenu((previous) =>
        previous.open && previous.query === query
          ? { ...previous, loading: true, error: "" }
          : previous
      );

      const controller = new AbortController();
      mentionFetchAbortRef.current = controller;
      mentionFetchTimerRef.current = setTimeout(() => {
        const searchParams = new URLSearchParams();
        if (query) {
          searchParams.set("q", query);
        }
        searchParams.set("limit", String(nextLimit));

        void fetch(`/api/mentions/suggestions?${searchParams.toString()}`, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        })
          .then(async (response) => {
            const payload = (await response.json().catch(() => ({}))) as {
              error?: string;
              items?: unknown[];
            };
            if (!response.ok) {
              throw new Error(payload.error || "Unable to load mentions");
            }
            const nextItems = Array.isArray(payload.items)
              ? payload.items.filter(isMentionSuggestion)
              : [];

            if (controller.signal.aborted || mentionRequestIdRef.current !== requestId) {
              return;
            }

            setMentionMenu((previous) => {
              if (!previous.open || previous.query !== query) {
                return previous;
              }
              const maxIndex = Math.max(nextItems.length - 1, 0);
              return {
                ...previous,
                items: nextItems,
                index: Math.min(previous.index, maxIndex),
                loading: false,
                error: "",
              };
            });
          })
          .catch((error) => {
            if (controller.signal.aborted || mentionRequestIdRef.current !== requestId) {
              return;
            }
            setMentionMenu((previous) => {
              if (!previous.open || previous.query !== query) {
                return previous;
              }
              return {
                ...previous,
                items: [],
                index: 0,
                loading: false,
                error: error instanceof Error ? error.message : "Unable to load mentions",
              };
            });
          });
      }, FETCH_DEBOUNCE_MS);

      return () => {
        if (mentionFetchTimerRef.current) {
          clearTimeout(mentionFetchTimerRef.current);
          mentionFetchTimerRef.current = null;
        }
        controller.abort();
      };
    }, [mentionMenu.open, mentionMenu.query, suggestionLimit]);

    useEffect(() => {
      if (!mentionMenu.open) {
        return;
      }
      const onWindowPointerDown = (event: PointerEvent) => {
        const target = event.target as Node | null;
        if (!target) return;
        if (textareaRef.current?.contains(target)) return;
        if (menuRef.current?.contains(target)) return;
        closeMentionMenu();
      };

      window.addEventListener("pointerdown", onWindowPointerDown);
      return () => {
        window.removeEventListener("pointerdown", onWindowPointerDown);
      };
    }, [closeMentionMenu, mentionMenu.open]);

    useEffect(() => {
      return () => {
        if (mentionFetchTimerRef.current) {
          clearTimeout(mentionFetchTimerRef.current);
        }
        if (mentionFetchAbortRef.current) {
          mentionFetchAbortRef.current.abort();
        }
      };
    }, []);

    const activeMentionItem = useMemo(() => {
      if (!mentionMenu.items.length) return null;
      return mentionMenu.items[mentionMenu.index] || mentionMenu.items[0] || null;
    }, [mentionMenu.index, mentionMenu.items]);

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionMenu.open) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setMentionMenu((previous) => {
            if (!previous.open || !previous.items.length) return previous;
            return {
              ...previous,
              index: (previous.index + 1) % previous.items.length,
            };
          });
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setMentionMenu((previous) => {
            if (!previous.open || !previous.items.length) return previous;
            return {
              ...previous,
              index:
                (previous.index - 1 + previous.items.length) % previous.items.length,
            };
          });
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          if (activeMentionItem) {
            event.preventDefault();
            applyMentionSuggestion(activeMentionItem);
            return;
          }
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeMentionMenu();
          return;
        }
      }

      onKeyDown?.(event);
    };

    const normalizedContainerClassName = containerClassName.trim();
    const normalizedTextareaClassName = className.trim();
    const normalizedMenuClassName = menuClassName.trim();

    return (
      <div
        className={
          normalizedContainerClassName
            ? `relative ${normalizedContainerClassName}`
            : "relative"
        }
      >
        <textarea
          {...textareaProps}
          ref={setTextareaRef}
          value={value}
          disabled={disabled}
          className={normalizedTextareaClassName}
          onChange={(event) => {
            const nextValue = event.target.value;
            onValueChange(nextValue);
            const selectionStart = event.target.selectionStart;
            updateMentionMenuFromCaret(
              nextValue,
              typeof selectionStart === "number" ? selectionStart : null
            );
          }}
          onClick={(event) => {
            const selectionStart = event.currentTarget.selectionStart;
            updateMentionMenuFromCaret(
              event.currentTarget.value,
              typeof selectionStart === "number" ? selectionStart : null
            );
            onClick?.(event);
          }}
          onFocus={(event) => {
            const selectionStart = event.currentTarget.selectionStart;
            updateMentionMenuFromCaret(
              event.currentTarget.value,
              typeof selectionStart === "number" ? selectionStart : null
            );
            onFocus?.(event);
          }}
          onSelect={(event) => {
            const selectionStart = event.currentTarget.selectionStart;
            const selectionEnd = event.currentTarget.selectionEnd;
            if (selectionStart === selectionEnd) {
              updateMentionMenuFromCaret(
                event.currentTarget.value,
                typeof selectionStart === "number" ? selectionStart : null
              );
            } else {
              closeMentionMenu();
            }
            onSelect?.(event);
          }}
          onBlur={(event) => {
            onBlur?.(event);
            window.setTimeout(() => {
              const activeElement = document.activeElement as Node | null;
              if (activeElement && menuRef.current?.contains(activeElement)) {
                return;
              }
              if (
                activeElement &&
                textareaRef.current &&
                textareaRef.current.contains(activeElement)
              ) {
                return;
              }
              closeMentionMenu();
            }, 0);
          }}
          onKeyDown={handleKeyDown}
        />

        {mentionMenu.open ? (
          <div
            ref={menuRef}
            className={
              normalizedMenuClassName
                ? `absolute left-0 top-full z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl ${normalizedMenuClassName}`
                : "absolute left-0 top-full z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
            }
          >
            {mentionMenu.loading ? (
              <p className="px-2 py-1.5 text-xs text-slate-500">Finding people...</p>
            ) : mentionMenu.error ? (
              <p className="px-2 py-1.5 text-xs text-red-600">{mentionMenu.error}</p>
            ) : mentionMenu.items.length ? (
              mentionMenu.items.map((item, index) => {
                const active = index === mentionMenu.index;
                return (
                  <button
                    key={`${item.id}-${item.handle}`}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => applyMentionSuggestion(item)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                      active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span
                      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                        active
                          ? "border-slate-200/40 bg-slate-700 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                      }`}
                    >
                      {getSuggestionInitials(item)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {getSuggestionPrimaryLabel(item)}
                      </span>
                      <span
                        className={`block truncate text-xs ${
                          active ? "text-slate-200" : "text-slate-500"
                        }`}
                      >
                        {getSuggestionSecondaryLabel(item)}
                      </span>
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="px-2 py-1.5 text-xs text-slate-500">
                No people found for @{mentionMenu.query || "..."}
              </p>
            )}
          </div>
        ) : null}
      </div>
    );
  }
);

export default MentionTextarea;
