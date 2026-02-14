"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ChatNavLink({
  initialUnreadCount,
  userId,
  className,
  labelClassName,
  badgeClassName,
}: {
  initialUnreadCount: number;
  userId: string;
  className?: string;
  labelClassName?: string;
  badgeClassName?: string;
}) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);

  const refreshUnreadCount = useCallback(async () => {
    const { data: membershipsRaw, error: membershipsError } = await supabase
      .from("chat_conversation_members")
      .select("conversation_id,last_read_at")
      .eq("user_id", userId);

    if (membershipsError || !(membershipsRaw || []).length) {
      setUnreadCount(0);
      return;
    }

    const memberships = (membershipsRaw || []) as Array<{
      conversation_id: string;
      last_read_at: string | null;
    }>;

    const unreadCounts = await Promise.all(
      memberships.map(async (membership) => {
        let query = supabase
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", membership.conversation_id)
          .neq("sender_id", userId);
        if (membership.last_read_at) {
          query = query.gt("created_at", membership.last_read_at);
        }
        const { count } = await query;
        return count || 0;
      })
    );

    setUnreadCount(unreadCounts.reduce((sum, value) => sum + value, 0));
  }, [userId]);

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
    <Link
      href="/chat"
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
    </Link>
  );
}
