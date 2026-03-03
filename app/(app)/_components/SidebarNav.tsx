"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { SidebarNavIcon, SidebarNavLink } from "@/lib/appSidebarLinks";
import AppNavLink from "./AppNavLink";
import ChatNavLink from "./ChatNavLink";

type SidebarLinkData = {
  links: SidebarNavLink[];
  userId: string;
  chatUnreadCount: number;
};

function isNavLinkActive(pathname: string | null, href: string) {
  const currentPath = String(pathname || "").trim();
  if (!currentPath || !href.startsWith("/")) {
    return false;
  }
  if (currentPath === href) {
    return true;
  }
  if (href === "/") {
    return currentPath === "/";
  }
  return currentPath.startsWith(`${href}/`);
}

function SidebarIcon({ name }: { name: SidebarNavIcon }) {
  const iconClassName = "h-4 w-4 shrink-0";

  switch (name) {
    case "dashboard":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M3 13h8V3H3v10Z" />
          <path d="M13 21h8v-6h-8v6Z" />
          <path d="M13 3h8v8h-8V3Z" />
          <path d="M3 21h8v-4H3v4Z" />
        </svg>
      );
    case "clients":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
          <path d="M15.5 3.1a4 4 0 0 1 0 7.8" />
        </svg>
      );
    case "projects":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
        </svg>
      );
    case "tasks":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M9 11 6.5 8.5 5 10" />
          <path d="M9 17 6.5 14.5 5 16" />
          <path d="M11 10h8" />
          <path d="M11 16h8" />
          <path d="M5 4h14" />
        </svg>
      );
    case "employeeInfo":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M18 8h5" />
          <path d="M18 12h5" />
          <path d="M18 16h5" />
        </svg>
      );
    case "schedules":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4" />
          <path d="M8 2v4" />
          <path d="M3 10h18" />
          <path d="M8 14h3" />
          <path d="M13 14h3" />
          <path d="M8 18h3" />
          <path d="M13 18h3" />
        </svg>
      );
    case "quizzes":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M9 11.5 11 13.5l4-4" />
          <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
          <path d="M16 4v3h3" />
        </svg>
      );
    case "forms":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M6 3h9l4 4v14H6V3Z" />
          <path d="M15 3v4h4" />
          <path d="M9 12h6" />
          <path d="M9 16h6" />
        </svg>
      );
    case "chat":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M21 12a8.8 8.8 0 0 1-.9 3.8 9 9 0 0 1-8.1 5.2 8.8 8.8 0 0 1-3.8-.9L3 21l1.9-5.1a8.8 8.8 0 0 1-.9-3.8 9 9 0 0 1 5.2-8.1A8.8 8.8 0 0 1 13 3h.5a9 9 0 0 1 7.5 7.5V12Z" />
        </svg>
      );
    case "social":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <path d="M20 8v6" />
          <path d="M17 11h6" />
        </svg>
      );
    case "personal":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <circle cx="12" cy="7" r="4" />
          <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
        </svg>
      );
    case "notes":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M4 4h16v16H4z" />
          <path d="M8 8h8" />
          <path d="M8 12h8" />
          <path d="M8 16h5" />
        </svg>
      );
    case "featureSuggestions":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M9 18h6" />
          <path d="M10 22h4" />
          <path d="M12 2a7 7 0 0 0-4 12.7c.7.5 1 1.3 1 2.1V18h6v-1.2c0-.8.3-1.6 1-2.1A7 7 0 0 0 12 2Z" />
        </svg>
      );
    case "help":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.25 9.5a2.75 2.75 0 1 1 4.74 1.88c-.7.74-1.46 1.24-1.46 2.37" />
          <path d="M12 17.5h.01" />
        </svg>
      );
    case "settings":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
          <path d="M19.4 15a7.9 7.9 0 0 0 .1-1 7.9 7.9 0 0 0-.1-1l2.1-1.6-2-3.4-2.5 1a8.8 8.8 0 0 0-1.7-1l-.4-2.7H9.1l-.4 2.7a8.8 8.8 0 0 0-1.7 1l-2.5-1-2 3.4L4.6 13a7.9 7.9 0 0 0-.1 1 7.9 7.9 0 0 0 .1 1L2.5 16.6l2 3.4 2.5-1a8.8 8.8 0 0 0 1.7 1l.4 2.7h5.8l.4-2.7a8.8 8.8 0 0 0 1.7-1l2.5 1 2-3.4L19.4 15Z" />
        </svg>
      );
    case "inventory":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClassName}>
          <path d="M3 3h18v4H3z" />
          <path d="M5 7h14v14H5z" />
          <path d="M5 10h14" />
          <path d="M8 13h8" />
        </svg>
      );
    default:
      return <span aria-hidden="true" className={iconClassName} />;
  }
}

function ArrowIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      {direction === "up" ? <path d="m17 14-5-5-5 5" /> : <path d="m7 10 5 5 5-5" />}
    </svg>
  );
}

export default function SidebarNav({ links, userId, chatUnreadCount }: SidebarLinkData) {
  const router = useRouter();
  const pathname = usePathname();
  const [editableLinks, setEditableLinks] = useState<SidebarNavLink[]>(() => [...links]);
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  useEffect(() => {
    setEditableLinks([...links]);
  }, [links]);

  const currentLinks = useMemo(() => links, [links]);

  useEffect(() => {
    if (!isEditing) {
      setErrorText(null);
      setStatusText(null);
    }
  }, [isEditing]);

  const hasChanges = useMemo(() => {
    if (!isEditing) return false;
    if (editableLinks.length !== currentLinks.length) return true;
    return editableLinks.some((link, index) => currentLinks[index]?.pageKey !== link.pageKey);
  }, [isEditing, editableLinks, currentLinks]);

  const canReorder = currentLinks.length > 1;

  const moveLink = (index: number, direction: -1 | 1) => {
    setEditableLinks((previous) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= previous.length) {
        return previous;
      }

      const next = [...previous];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const startReorder = () => {
    setIsEditing(true);
    setErrorText(null);
    setStatusText(null);
  };

  const cancelReorder = () => {
    setIsEditing(false);
    setEditableLinks(currentLinks);
    setErrorText(null);
    setStatusText(null);
  };

  const saveReorder = async () => {
    if (isSubmitting) return;
    if (!hasChanges) {
      setIsEditing(false);
      return;
    }

    setIsSubmitting(true);
    setErrorText(null);

    const orderedPageKeys = editableLinks.map((link) => link.pageKey);

    try {
      const response = await fetch("/api/app-nav/reorder", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderedPageKeys }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        setErrorText(payload.error || "Could not save menu order.");
        return;
      }

      setStatusText("Menu order saved.");
      setIsEditing(false);
      router.refresh();
    } catch (error) {
      setErrorText(
        error instanceof Error ? error.message : "Could not save menu order."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <nav className="min-h-0 flex-1 overflow-y-auto px-3">
      <div className="px-3 pt-2 pb-3 text-xs uppercase text-slate-500">
        <div className="flex items-center justify-between gap-2">
          <span>Main menu</span>
          {canReorder ? (
            isEditing ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={cancelReorder}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-md border border-slate-900 bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={saveReorder}
                  disabled={isSubmitting || !hasChanges}
                >
                  {isSubmitting ? "Saving..." : "Save"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                onClick={startReorder}
              >
                Reorder
              </button>
            )
          ) : null}
        </div>
        {errorText ? <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-red-700">{errorText}</p> : null}
        {statusText ? <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-emerald-700">{statusText}</p> : null}
      </div>

      <div className="space-y-1">
        {(isEditing ? editableLinks : currentLinks).map((link, index, renderedLinks) => {
          const isActive = isNavLinkActive(pathname, link.href);
          const isFirst = index === 0;
          const isLast = index === renderedLinks.length - 1;
          const canMoveUp = isEditing && !isFirst;
          const canMoveDown = isEditing && !isLast;
          const moveButtons = isEditing ? (
            <div className="flex shrink-0 items-center gap-1 pl-2" aria-hidden={!isEditing ? true : undefined}>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => moveLink(index, -1)}
                disabled={isSubmitting || !canMoveUp}
                aria-label={`Move ${link.label} up`}
                title="Move up"
              >
                <ArrowIcon direction="up" />
              </button>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => moveLink(index, 1)}
                disabled={isSubmitting || !canMoveDown}
                aria-label={`Move ${link.label} down`}
                title="Move down"
              >
                <ArrowIcon direction="down" />
              </button>
            </div>
          ) : null;

          if (link.pageKey === "chat") {
            return (
              <div className="flex items-center gap-2" key={link.pageKey}>
                <ChatNavLink
                  initialUnreadCount={chatUnreadCount}
                  userId={userId}
                  className="nav-item flex-1"
                  labelClassName="nav-label"
                  badgeClassName="chat-badge"
                />
                {moveButtons}
              </div>
            );
          }

          return (
            <div className="flex items-center gap-2" key={link.pageKey}>
              <AppNavLink
                href={link.href}
                prefetch={false}
                className={`nav-item app-nav-item relative flex min-h-11 flex-1 items-center gap-2 border px-3 py-2 text-sm font-semibold ${
                  isActive ? "app-nav-item-active" : "text-slate-700"
                }`}
                title={link.label}
                aria-label={link.label}
              >
                <SidebarIcon name={link.icon} />
                <span className="nav-label">{link.label}</span>
              </AppNavLink>
              {moveButtons}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
