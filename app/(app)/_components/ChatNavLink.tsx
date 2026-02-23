"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { isSupabaseMissingFunctionError } from "@/lib/supabaseErrors";
import AppNavLink from "./AppNavLink";

export default function ChatNavLink({
  initialUnreadCount,
  userId,
  className,
  labelClassName,
  badgeClassName,
  closeMobileSidebarOnClick,
}: {
  initialUnreadCount: number;
  userId: string;
  className?: string;
  labelClassName?: string;
  badgeClassName?: string;
  closeMobileSidebarOnClick?: boolean;
}) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);

  const refreshUnreadCount = useCallback(async () => {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }

    refreshInFlightRef.current = true;
    try {
      do {
        refreshQueuedRef.current = false;
        const { data: totalUnreadRaw, error: totalUnreadError } = await supabase.rpc(
          "chat_total_unread_count"
        );

        if (!totalUnreadError) {
          setUnreadCount(Number(totalUnreadRaw || 0));
          continue;
        }

        if (!isSupabaseMissingFunctionError(totalUnreadError)) {
          setUnreadCount(0);
          continue;
        }

        const { data: unreadRowsRaw, error: unreadRowsError } = await supabase.rpc(
          "chat_unread_counts"
        );

        if (!unreadRowsError) {
          const total = (
            (unreadRowsRaw || []) as Array<{ unread_count: number | null }>
          ).reduce((sum, row) => sum + Number(row.unread_count || 0), 0);
          setUnreadCount(total);
          continue;
        }

        if (!isSupabaseMissingFunctionError(unreadRowsError)) {
          setUnreadCount(0);
          continue;
        }

        // Avoid expensive N+1 fallback counts in the nav on every refresh.
        setUnreadCount(0);
      } while (refreshQueuedRef.current);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refreshUnreadCount();
  }, [refreshUnreadCount]);

  useEffect(() => {
    setUnreadCount(initialUnreadCount);
  }, [initialUnreadCount]);

  useEffect(() => {
    const handleReadUpdated = () => {
      void refreshUnreadCount();
    };
    window.addEventListener("chat-read-updated", handleReadUpdated);
    return () => {
      window.removeEventListener("chat-read-updated", handleReadUpdated);
    };
  }, [refreshUnreadCount]);

  useEffect(() => {
    const channel = supabase
      .channel(`chat-nav-unread-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        () => {
          void refreshUnreadCount();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_conversation_members",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void refreshUnreadCount();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refreshUnreadCount, userId]);

  const unreadLabel = useMemo(() => {
    if (!unreadCount) return "";
    return unreadCount > 99 ? "99+" : String(unreadCount);
  }, [unreadCount]);

  const showBadge = pathname !== "/chat" && unreadCount > 0;

  return (
    <AppNavLink
      href="/chat"
      closeMobileSidebarOnClick={closeMobileSidebarOnClick}
      className={`flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 ${className || ""}`}
      title="Chat"
      aria-label="Chat"
    >
      <span className="flex items-center gap-2">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 shrink-0"
        >
          <path d="M21 12a8.8 8.8 0 0 1-.9 3.8 9 9 0 0 1-8.1 5.2 8.8 8.8 0 0 1-3.8-.9L3 21l1.9-5.1a8.8 8.8 0 0 1-.9-3.8 9 9 0 0 1 5.2-8.1A8.8 8.8 0 0 1 13 3h.5a9 9 0 0 1 7.5 7.5V12Z" />
        </svg>
        <span className={labelClassName}>Chat</span>
      </span>
      {showBadge ? (
        <span
          className={`ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white ${
            badgeClassName || ""
          }`}
        >
          {unreadLabel}
        </span>
      ) : null}
    </AppNavLink>
  );
}
