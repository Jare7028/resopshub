"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LOGIN_QUICK_READ_SNOOZE_KEY,
  buildEndOfLocalDayTimestamp,
} from "@/lib/loginQuickRead";

type QuickReadTaskItem = {
  id: string;
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  dueAt: string;
  url: string;
};

type QuickReadMentionItem = {
  id: string;
  title: string;
  body: string | null;
  createdAt: string;
  url: string | null;
};

type QuickReadPayload = {
  generatedAt: string;
  overdue: {
    count: number;
    items: QuickReadTaskItem[];
  };
  dueSoon: {
    count: number;
    items: QuickReadTaskItem[];
  };
  mentions: {
    count: number;
    items: QuickReadMentionItem[];
  };
};

function formatDueLabel(item: QuickReadTaskItem) {
  const parsed = new Date(item.dueAt);
  if (!Number.isNaN(parsed.getTime())) {
    const now = new Date();
    const isToday = now.toDateString() === parsed.toDateString();
    const dateLabel = parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const timeLabel = parsed.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    return isToday ? `Today ${timeLabel}` : `${dateLabel} ${timeLabel}`;
  }
  if (item.dueDate && item.dueTime) {
    return `${item.dueDate} ${item.dueTime.slice(0, 5)}`;
  }
  if (item.dueDate) {
    return item.dueDate;
  }
  return "Due soon";
}

function formatMentionTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const now = Date.now();
  const diffMs = Math.max(0, now - parsed.getTime());
  const minute = 60 * 1000;
  const hour = 60 * minute;
  if (diffMs < minute) return "Now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m`;
  if (diffMs < 24 * hour) return `${Math.floor(diffMs / hour)}h`;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function readSnoozedUntil() {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(LOGIN_QUICK_READ_SNOOZE_KEY);
  const value = Number(raw || "");
  return Number.isFinite(value) ? value : 0;
}

export default function LoginQuickReadPrompt({
  shouldCheckOnLoad,
}: {
  shouldCheckOnLoad: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<QuickReadPayload | null>(null);

  useEffect(() => {
    if (!shouldCheckOnLoad) return;
    let active = true;
    const controller = new AbortController();
    const snoozedUntil = readSnoozedUntil();
    const shouldSuppress = snoozedUntil > Date.now();

    void fetch("/api/briefing/quick-read", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = (await response.json()) as QuickReadPayload;
        return data;
      })
      .then((data) => {
        if (!active || !data || shouldSuppress) return;
        const total = data.overdue.count + data.dueSoon.count + data.mentions.count;
        if (!total) return;
        setPayload(data);
        setOpen(true);
      })
      .catch(() => {
        // Non-blocking by design.
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [shouldCheckOnLoad]);

  const totalCount = useMemo(() => {
    if (!payload) return 0;
    return payload.overdue.count + payload.dueSoon.count + payload.mentions.count;
  }, [payload]);

  if (!open || !payload || !totalCount) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[190] flex justify-end px-4">
      <section
        role="dialog"
        aria-label="Quick read"
        className="pointer-events-auto w-full max-w-[30rem] rounded-xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Quick read</p>
            <p className="text-xs text-slate-600">
              {totalCount} thing{totalCount === 1 ? "" : "s"} need attention.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
            aria-label="Dismiss quick read"
          >
            x
          </button>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-4 py-3">
          {payload.overdue.count ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                  Overdue
                </p>
                <span className="rounded-full border border-rose-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                  {payload.overdue.count}
                </span>
              </div>
              <ul className="space-y-1.5">
                {payload.overdue.items.map((item) => (
                  <li key={`overdue-${item.id}`}>
                    <Link
                      href={item.url}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between gap-3 rounded-md border border-rose-100 bg-white px-2 py-1.5 text-sm text-slate-800 hover:bg-rose-50"
                    >
                      <span className="line-clamp-1 font-medium">{item.title}</span>
                      <span className="shrink-0 text-[11px] font-semibold uppercase text-rose-700">
                        {formatDueLabel(item)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {payload.dueSoon.count ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                  Due in 24 hours
                </p>
                <span className="rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  {payload.dueSoon.count}
                </span>
              </div>
              <ul className="space-y-1.5">
                {payload.dueSoon.items.map((item) => (
                  <li key={`soon-${item.id}`}>
                    <Link
                      href={item.url}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between gap-3 rounded-md border border-amber-100 bg-white px-2 py-1.5 text-sm text-slate-800 hover:bg-amber-50"
                    >
                      <span className="line-clamp-1 font-medium">{item.title}</span>
                      <span className="shrink-0 text-[11px] font-semibold uppercase text-amber-800">
                        {formatDueLabel(item)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {payload.mentions.count ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  Unread mentions
                </p>
                <span className="rounded-full border border-blue-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                  {payload.mentions.count}
                </span>
              </div>
              <ul className="space-y-1.5">
                {payload.mentions.items.map((mention) => {
                  const destination = mention.url || "/settings?tab=notifications";
                  return (
                    <li key={`mention-${mention.id}`}>
                      <Link
                        href={destination}
                        onClick={() => setOpen(false)}
                        className="block rounded-md border border-blue-100 bg-white px-2 py-1.5 hover:bg-blue-50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="line-clamp-1 text-sm font-medium text-slate-800">
                            {mention.title}
                          </span>
                          <span className="shrink-0 text-[11px] font-semibold text-blue-700">
                            {formatMentionTime(mention.createdAt)}
                          </span>
                        </div>
                        {mention.body ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{mention.body}</p>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.localStorage.setItem(
                  LOGIN_QUICK_READ_SNOOZE_KEY,
                  String(buildEndOfLocalDayTimestamp())
                );
              }
              setOpen(false);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Snooze for today
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/settings?tab=notifications");
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Open mentions
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/tasks?due=next_7");
              }}
              className="rounded-md btn-primary px-3 py-1.5 text-xs font-semibold text-white"
            >
              Open tasks
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
