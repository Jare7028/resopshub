"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCsvParam } from "@/lib/queryParams";
import {
  FilterIcon,
  FilterMenuDateRange,
  FilterMenuMulti,
} from "@/app/(app)/_components/TableHeaderFilters";

type PageRow = {
  id: string;
  title: string | null;
  section_id: string | null;
  share_mode: string | null;
  updated_at: string | null;
  personal_sections?:
    | { title?: string | null }
    | { title?: string | null }[]
    | null
    | undefined;
};

type SectionOption = { id: string; title: string };

export type PersonalPageRow = PageRow;
export type PersonalSectionOption = SectionOption;

type HeaderMenuKey = "section" | "sharing" | "updated";

const sharingOptions = [
  { value: "private", label: "Private" },
  { value: "inherit", label: "Shared (Section)" },
  { value: "custom", label: "Shared (Page)" },
] as const;

function getRelationTitle(
  relation:
    | { title?: string | null }
    | { title?: string | null }[]
    | null
    | undefined,
  fallback: string
) {
  if (Array.isArray(relation)) {
    return relation[0]?.title ?? fallback;
  }
  return relation?.title ?? fallback;
}

export default function PersonalPagesView({
  pages,
  sections,
  initialFilters,
}: {
  pages: PageRow[];
  sections: SectionOption[];
  initialFilters: {
    section: string[];
    shareMode: string[];
    updatedFrom: string;
    updatedTo: string;
  };
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState(initialFilters);
  const [openMenu, setOpenMenu] = useState<HeaderMenuKey | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const initialKey = useMemo(() => JSON.stringify(initialFilters), [initialFilters]);

  useEffect(() => {
    setFilters(initialFilters);
  }, [initialKey, initialFilters]);

  useEffect(() => {
    if (!openMenu) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    };

    const onPointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setOpenMenu(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openMenu]);

  const applyFilters = (next: typeof filters) => {
    setFilters(next);

    const params = new URLSearchParams(window.location.search);

    // Ensure we remain in pages view (pages is the default tab).
    if (params.get("tab") === "pages") {
      params.delete("tab");
    }

    setCsvParam(params, "section", next.section);
    setCsvParam(params, "share_mode", next.shareMode);

    if (next.updatedFrom) params.set("updated_from", next.updatedFrom);
    else params.delete("updated_from");

    if (next.updatedTo) params.set("updated_to", next.updatedTo);
    else params.delete("updated_to");

    // If the user explicitly uses share_mode filters, ignore the legacy `filter`.
    if (next.shareMode.length) {
      params.delete("filter");
    }

    const query = params.toString();
    startTransition(() => {
      router.replace(query ? `/personal?${query}` : "/personal", { scroll: false });
    });
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-6 py-3">Page</th>
            <th className="px-6 py-3">
              <div className="relative flex items-center justify-between gap-2">
                <span>Section</span>
                <button
                  type="button"
                  aria-label="Filter section"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpenMenu((current) =>
                      current === "section" ? null : "section"
                    );
                  }}
                >
                  <FilterIcon active={filters.section.length > 0} />
                </button>
                {openMenu === "section" ? (
                  <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                    <FilterMenuMulti
                      title="Section"
                      options={sections.map((section) => ({
                        value: section.id,
                        label: section.title,
                      }))}
                      selectedValues={filters.section}
                      onChange={(next) => applyFilters({ ...filters, section: next })}
                      onClear={() => applyFilters({ ...filters, section: [] })}
                    />
                  </div>
                ) : null}
              </div>
            </th>
            <th className="px-6 py-3">
              <div className="relative flex items-center justify-between gap-2">
                <span>Sharing</span>
                <button
                  type="button"
                  aria-label="Filter sharing"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpenMenu((current) =>
                      current === "sharing" ? null : "sharing"
                    );
                  }}
                >
                  <FilterIcon active={filters.shareMode.length > 0} />
                </button>
                {openMenu === "sharing" ? (
                  <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                    <FilterMenuMulti
                      title="Sharing"
                      options={sharingOptions}
                      selectedValues={filters.shareMode}
                      onChange={(next) => applyFilters({ ...filters, shareMode: next })}
                      onClear={() => applyFilters({ ...filters, shareMode: [] })}
                    />
                  </div>
                ) : null}
              </div>
            </th>
            <th className="px-6 py-3">
              <div className="relative flex items-center justify-between gap-2">
                <span>Updated</span>
                <button
                  type="button"
                  aria-label="Filter updated date range"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpenMenu((current) =>
                      current === "updated" ? null : "updated"
                    );
                  }}
                >
                  <FilterIcon active={Boolean(filters.updatedFrom || filters.updatedTo)} />
                </button>
                {openMenu === "updated" ? (
                  <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                    <FilterMenuDateRange
                      title="Updated"
                      from={filters.updatedFrom}
                      to={filters.updatedTo}
                      onApply={(next) =>
                        applyFilters({
                          ...filters,
                          updatedFrom: next.from,
                          updatedTo: next.to,
                        })
                      }
                      onClear={() =>
                        applyFilters({ ...filters, updatedFrom: "", updatedTo: "" })
                      }
                    />
                  </div>
                ) : null}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {pages?.length ? (
            pages.map((page) => (
              <tr key={page.id} className="border-t border-slate-200">
                <td className="px-6 py-3 font-medium text-slate-900">
                  <Link href={`/personal/${page.id}`} className="hover:underline">
                    {page.title || "Untitled"}
                  </Link>
                </td>
                <td className="px-6 py-3 text-slate-600">
                  {getRelationTitle(page.personal_sections, "General")}
                </td>
                <td className="px-6 py-3 text-slate-600">
                  {sharingOptions.find((o) => o.value === (page.share_mode || "private"))
                    ?.label || "Private"}
                </td>
                <td className="px-6 py-3 text-slate-600">
                  {page.updated_at
                    ? new Date(page.updated_at).toLocaleDateString("en-US")
                    : "-"}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-6 py-6 text-slate-500" colSpan={4}>
                No pages found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
