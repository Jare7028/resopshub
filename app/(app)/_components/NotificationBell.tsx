"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  task_id: string | null;
  metadata: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", { month: "short", day: "numeric" });
}

export default function NotificationBell({ userId }: { userId: string }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [items, setItems] = useState<NotificationRow[]>([]);

  const unreadLabel = useMemo(() => {
    if (!unreadCount) return "";
    return unreadCount > 99 ? "99+" : unreadCount.toString();
  }, [unreadCount]);

  const loadUnreadCount = useCallback(async () => {
    const countResult = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null);

    if (!countResult.error) {
      setUnreadCount(countResult.count || 0);
    }
  }, [userId]);

  const loadPanel = useCallback(async () => {
    setLoading(true);
    const listResult = await supabase
      .from("notifications")
      .select("id,type,title,body,task_id,metadata,read_at,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(12);

    if (!listResult.error) {
      const rows = (listResult.data || []) as NotificationRow[];
      const unreadInPanel = rows.reduce(
        (count, row) => count + (row.read_at ? 0 : 1),
        0
      );
      setUnreadCount((current) => Math.max(current, unreadInPanel));
      setItems(rows);
    }

    setLoading(false);
    void loadUnreadCount();
  }, [loadUnreadCount, userId]);

  useEffect(() => {
    void loadUnreadCount();
  }, [loadUnreadCount]);

  useEffect(() => {
    if (!open) return;
    void loadPanel();
  }, [loadPanel, open]);

  useEffect(() => {
    if (!open) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!containerRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [open]);

  const markRead = useCallback(
    async (id: string) => {
      const notification = items.find((item) => item.id === id);
      const wasUnread = !!notification && !notification.read_at;
      const now = new Date().toISOString();
      if (wasUnread) {
        setUnreadCount((prev) => Math.max(prev - 1, 0));
      }
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, read_at: item.read_at || now } : item))
      );

      const { error } = await supabase
        .from("notifications")
        .update({ read_at: now })
        .eq("id", id)
        .eq("user_id", userId);
      if (error) {
        if (open) {
          await loadPanel();
        } else {
          await loadUnreadCount();
        }
      }
    },
    [items, loadPanel, loadUnreadCount, open, userId]
  );

  const markAllRead = useCallback(async () => {
    if (!unreadCount) return;
    const now = new Date().toISOString();
    setUnreadCount(0);
    setItems((prev) =>
      prev.map((item) => (item.read_at ? item : { ...item, read_at: now }))
    );

    const { error } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", userId)
      .is("read_at", null);
    if (error) {
      await loadPanel();
    }
  }, [loadPanel, unreadCount, userId]);

  const handleItemClick = useCallback(
    async (notification: NotificationRow) => {
      if (!notification.read_at) {
        await markRead(notification.id);
      }
      setOpen(false);
      if (notification.task_id) {
        router.push(`/tasks/${notification.task_id}`);
        return;
      }

      const metadata = notification.metadata || {};
      const sourceUrl =
        typeof metadata.source_url === "string" ? metadata.source_url.trim() : "";
      if (sourceUrl.startsWith("/")) {
        router.push(sourceUrl);
        return;
      }

      const suggestionId =
        typeof metadata.feature_suggestion_id === "string"
          ? metadata.feature_suggestion_id
          : null;
      if (suggestionId) {
        router.push(`/feature-suggestions?open=${encodeURIComponent(suggestionId)}`);
      }
    },
    [markRead, router]
  );

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((prev) => !prev);
        }}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-md border border-slate-300 bg-white px-0 text-sm font-semibold text-slate-700 shadow-sm hover:border-slate-400 hover:text-slate-900 sm:w-auto sm:px-3"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Notifications"
      >
        <span className="inline-flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
          <span className="hidden sm:inline">Alerts</span>
        </span>
        {unreadLabel ? (
          <span className="absolute -right-1.5 -top-1.5 rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white">
            {unreadLabel}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
              disabled={!unreadCount}
            >
              Mark all read
            </button>
          </div>

          {loading ? (
            <div className="px-4 py-4 text-sm text-slate-500">Loading...</div>
          ) : items.length ? (
            <div className="max-h-96 overflow-y-auto">
              {items.map((notification) => {
                const isUnread = !notification.read_at;
                return (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => void handleItemClick(notification)}
                    className={`flex w-full flex-col gap-1 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                      isUnread ? "bg-slate-50" : "bg-white"
                    }`}
                    role="menuitem"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">
                        {notification.title}
                      </p>
                      <span className="shrink-0 text-xs text-slate-500">
                        {formatTimestamp(notification.created_at)}
                      </span>
                    </div>
                    {notification.body ? (
                      <p className="text-sm text-slate-600">{notification.body}</p>
                    ) : null}
                    {isUnread ? (
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-rose-600">
                        Unread
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-6 text-sm text-slate-500">
              No notifications yet.
            </div>
          )}

          <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
            Reminders are generated daily for due and overdue tasks.
          </div>
        </div>
      ) : null}
    </div>
  );
}

