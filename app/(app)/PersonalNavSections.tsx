"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Section = {
  id: string;
  title: string;
};

type Page = {
  id: string;
  title: string;
  section_id: string | null;
};

export default function PersonalNavSections({
  sections,
  pages,
}: {
  sections: Section[];
  pages: Page[];
}) {
  const pathname = usePathname();

  if (!pathname?.startsWith("/personal")) {
    return null;
  }

  const generalPages = pages.filter((page) => !page.section_id);
  const grouped = sections.map((section) => ({
    section,
    pages: pages.filter((page) => page.section_id === section.id),
  }));

  return (
    <div className="mt-6 border-t app-border pt-4">
      <div className="px-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Personal sections
        </p>
      </div>
      <div className="mt-2 px-3 space-y-3">
        <Link
          href="/personal"
          className={`block rounded-md px-2 py-1 text-sm ${
            pathname === "/personal"
              ? "bg-slate-100 text-slate-900"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          All pages
        </Link>
        {generalPages.length ? (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              General
            </p>
            {generalPages.map((page) => (
              <Link
                key={page.id}
                href={`/personal/${page.id}`}
                className={`block rounded-md px-2 py-1 text-sm ${
                  pathname === `/personal/${page.id}`
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {page.title}
              </Link>
            ))}
          </div>
        ) : null}
        {grouped.map((group) => (
          <div key={group.section.id} className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {group.section.title}
            </p>
            {group.pages.length ? (
              group.pages.map((page) => (
                <Link
                  key={page.id}
                  href={`/personal/${page.id}`}
                  className={`block rounded-md px-2 py-1 text-sm ${
                    pathname === `/personal/${page.id}`
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {page.title}
                </Link>
              ))
            ) : (
              <p className="text-xs text-slate-400">No pages yet</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
