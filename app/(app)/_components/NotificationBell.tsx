"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MentionText from "@/app/(app)/_components/MentionText";
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

type NotificationFilterKey =
  | "all"
  | "unread"
  | "mentions"
  | "tasks"
  | "features"
  | "schedule";

type NotificationCategory = "mentions" | "tasks" | "features" | "schedule" | "general";

const filterOrder: NotificationFilterKey[] = [
  "all",
  "unread",
  "mentions",
  "tasks",
  "features",
  "schedule",
];

const filterLabel: Record<NotificationFilterKey, string> = {
  all: "All",
  unread: "Unread",
  mentions: "Mentions",
  tasks: "Tasks",
  features: "Ideas",
  schedule: "Schedule",
};

function toCategory(type: string): NotificationCategory {
  const normalized = String(type || "").trim().toLowerCase();
  if (normalized === "user_mentioned") return "mentions";
  if (
    normalized === "task_assigned" ||
    normalized === "task_updated" ||
    normalized === "task_due_today" ||
    normalized === "task_overdue"
  ) {
    return "tasks";
  }
  if (normalized.startsWith("feature_suggestion")) return "features";
  if (normalized.startsWith("schedule_")) return "schedule";
  return "general";
}

function matchesFilter(
  notification: NotificationRow,
  filter: NotificationFilterKey
): boolean {
  if (filter === "all") return true;
  if (filter === "unread") return !notification.read_at;
  const category = toCategory(notification.type);
  if (filter === "mentions") return category === "mentions";
  if (filter === "tasks") return category === "tasks";
  if (filter === "features") return category === "features";
  if (filter === "schedule") return category === "schedule";
  return true;
}

function formatRelativeTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const now = Date.now();
  const diffMs = Math.max(0, now - date.getTime());
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "Now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatExactTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function categoryBadgeClass(category: NotificationCategory) {
  if (category === "mentions") return "bg-amber-50 text-amber-700 border-amber-200";
  if (category === "tasks") return "bg-blue-50 text-blue-700 border-blue-200";
  if (category === "features") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (category === "schedule") return "bg-violet-50 text-violet-700 border-violet-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function categoryLabel(category: NotificationCategory) {
  if (category === "mentions") return "Mention";
  if (category === "tasks") return "Task";
  if (category === "features") return "Feature";
  if (category === "schedule") return "Schedule";
  return "Update";
}

function iconForCategory(category: NotificationCategory) {
  if (category === "mentions") return "@";
  if (category === "tasks") return "T";
  if (category === "features") return "F";
  if (category === "schedule") return "S";
  return "U";
}

export default function NotificationBell({ userId }: { userId: string }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [activeFilter, setActiveFilter] = useState<NotificationFilterKey>("all");

  const unreadLabel = useMemo(() => {
    if (!unreadCount) return "";
    return unreadCount > 99 ? "99+" : unreadCount.toString();
  }, [unreadCount]);

  const filteredItems = useMemo(
    () => items.filter((item) => matchesFilter(item, activeFilter)),
    [activeFilter, items]
  );

  const filterCounts = useMemo(() => {
    const counts: Record<NotificationFilterKey, number> = {
      all: items.length,
      unread: items.filter((item) => !item.read_at).length,
      mentions: items.filter((item) => toCategory(item.type) === "mentions").length,
      tasks: items.filter((item) => toCategory(item.type) === "tasks").length,
      features: items.filter((item) => toCategory(item.type) === "features").length,
      schedule: items.filter((item) => toCategory(item.type) === "schedule").length,
    };
    return counts;
  }, [items]);

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
      .limit(30);

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
        router.push(`/feature-suggestions/${encodeURIComponent(suggestionId)}`);
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
          className="absolute right-0 z-50 mt-2 w-[24rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
        >
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">Notifications</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    router.push("/settings?tab=notifications");
                  }}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                >
                  Settings
                </button>
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                  disabled={!unreadCount}
                >
                  Mark all read
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {filterOrder.map((filterKey) => {
                const isActive = activeFilter === filterKey;
                const count = filterCounts[filterKey];
                return (
                  <button
                    key={filterKey}
                    type="button"
                    onClick={() => setActiveFilter(filterKey)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                      isActive
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {filterLabel[filterKey]} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {loading ? (
            <div className="px-4 py-6 text-sm text-slate-500">Loading...</div>
          ) : filteredItems.length ? (
            <div className="max-h-96 overflow-y-auto">
              {filteredItems.map((notification) => {
                const isUnread = !notification.read_at;
                const category = toCategory(notification.type);
                const createdAtLabel = formatExactTimestamp(notification.created_at);
                return (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => void handleItemClick(notification)}
                    className={`flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                      isUnread ? "bg-slate-50/70" : "bg-white"
                    }`}
                    role="menuitem"
                    title={createdAtLabel}
                  >
                    <span
                      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${categoryBadgeClass(
                        category
                      )}`}
                    >
                      {iconForCategory(category)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-sm font-semibold text-slate-900">
                          {notification.title}
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-500">
                          {formatRelativeTimestamp(notification.created_at)}
                        </span>
                      </span>
                      {notification.body ? (
                        <MentionText
                          as="span"
                          text={notification.body}
                          className="mt-0.5 block line-clamp-2 text-sm text-slate-600"
                        />
                      ) : null}
                      <span className="mt-1.5 flex items-center gap-2">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${categoryBadgeClass(
                            category
                          )}`}
                        >
                          {categoryLabel(category)}
                        </span>
                        {isUnread ? (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-rose-600">
                            Unread
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-6 text-sm text-slate-500">
              No notifications in this view.
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
            <span>Task reminder alerts run daily.</span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/settings?tab=notifications");
              }}
              className="font-semibold text-slate-600 hover:text-slate-900"
            >
              Open notification settings
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
