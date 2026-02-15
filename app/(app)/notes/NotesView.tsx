"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ConfirmDelete from "../_components/ConfirmDelete";
import MultiSelect from "../_components/MultiSelect";
import { setCsvParam } from "@/lib/queryParams";
import {
  FilterIcon,
  FilterMenuDateRange,
  FilterMenuMulti,
} from "../_components/TableHeaderFilters";

type NoteRow = {
  id: string;
  title?: string | null;
  content?: string | null;
  created_at?: string | null;
  user_id?: string | null;
  client_id?: string | null;
  last_edited_at?: string | null;
  last_edited_by_user_id?: string | null;
  clients?:
    | { name?: string | null }
    | { name?: string | null }[]
    | null
    | undefined;
};

type ClientOption = { id: string; name: string };
type UserOption = { id: string; full_name: string | null; email: string | null };

type HeaderMenuKey = "client" | "user" | "date";

function truncate(value: string, max = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}...`;
}

export default function NotesView({
  notes,
  supportsNotePages,
  clients,
  users,
  editorLabelsById,
  initialFilters,
  onDelete,
}: {
  notes: NoteRow[];
  supportsNotePages: boolean;
  clients: ClientOption[];
  users: UserOption[];
  editorLabelsById: Record<string, string>;
  initialFilters: {
    client: string[];
    user: string[];
    dateFrom: string;
    dateTo: string;
  };
  onDelete: (formData: FormData) => void;
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

  const buildQuery = (next: typeof filters) => {
    const params = new URLSearchParams();
    setCsvParam(params, "client", next.client);
    setCsvParam(params, "user", next.user);
    if (next.dateFrom) params.set("date_from", next.dateFrom);
    if (next.dateTo) params.set("date_to", next.dateTo);
    return params.toString();
  };

  const applyFilters = (next: typeof filters) => {
    setFilters(next);
    const query = buildQuery(next);
    startTransition(() => {
      router.replace(query ? `/notes?${query}` : "/notes", { scroll: false });
    });
  };

  const getRelationName = (
    relation:
      | { name?: string | null }
      | { name?: string | null }[]
      | null
      | undefined,
    fallback: string
  ) => {
    if (Array.isArray(relation)) {
      return relation[0]?.name ?? fallback;
    }
    return relation?.name ?? fallback;
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-slate-900">All notes</h2>
      </div>
      <div className="mobile-filter-panel md:hidden">
        <div className="grid gap-3 sm:grid-cols-2">
          <MultiSelect
            options={clients.map((client) => ({ value: client.id, label: client.name }))}
            selectedValues={filters.client}
            placeholder="All clients"
            onChange={(next) => applyFilters({ ...filters, client: next })}
          />
          <MultiSelect
            options={users.map((user) => ({
              value: user.id,
              label: user.full_name || user.email || "Unnamed user",
            }))}
            selectedValues={filters.user}
            placeholder={supportsNotePages ? "All editors" : "All users"}
            onChange={(next) => applyFilters({ ...filters, user: next })}
          />
          <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span className="block">From</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(event) =>
                applyFilters({ ...filters, dateFrom: event.target.value })
              }
              className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-700"
            />
          </label>
          <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span className="block">To</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(event) =>
                applyFilters({ ...filters, dateTo: event.target.value })
              }
              className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-700"
            />
          </label>
        </div>
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">
                <div className="relative flex items-center justify-between gap-2">
                  <span>Client</span>
                  <button
                    type="button"
                    aria-label="Filter client"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setOpenMenu((current) => (current === "client" ? null : "client"));
                    }}
                  >
                    <FilterIcon active={filters.client.length > 0} />
                  </button>
                  {openMenu === "client" ? (
                    <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                      <FilterMenuMulti
                        title="Client"
                        options={clients.map((client) => ({
                          value: client.id,
                          label: client.name,
                        }))}
                        selectedValues={filters.client}
                        onChange={(next) => applyFilters({ ...filters, client: next })}
                        onClear={() => applyFilters({ ...filters, client: [] })}
                      />
                    </div>
                  ) : null}
                </div>
              </th>

              {supportsNotePages ? (
                <>
                  <th className="px-4 py-2">Title</th>
                  <th className="px-4 py-2">Preview</th>
                  <th className="px-4 py-2">
                    <div className="relative flex items-center justify-between gap-2">
                      <span>Last edited</span>
                      <button
                        type="button"
                        aria-label="Filter date range"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setOpenMenu((current) => (current === "date" ? null : "date"));
                        }}
                      >
                        <FilterIcon active={Boolean(filters.dateFrom || filters.dateTo)} />
                      </button>
                      {openMenu === "date" ? (
                        <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                          <FilterMenuDateRange
                            title="Last edited"
                            from={filters.dateFrom}
                            to={filters.dateTo}
                            onApply={(next) =>
                              applyFilters({
                                ...filters,
                                dateFrom: next.from,
                                dateTo: next.to,
                              })
                            }
                            onClear={() =>
                              applyFilters({ ...filters, dateFrom: "", dateTo: "" })
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                  </th>
                  <th className="px-4 py-2">
                    <div className="relative flex items-center justify-between gap-2">
                      <span>Edited by</span>
                      <button
                        type="button"
                        aria-label="Filter user"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setOpenMenu((current) => (current === "user" ? null : "user"));
                        }}
                      >
                        <FilterIcon active={filters.user.length > 0} />
                      </button>
                      {openMenu === "user" ? (
                        <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                          <FilterMenuMulti
                            title="Edited by"
                            options={users.map((user) => ({
                              value: user.id,
                              label: user.full_name || user.email || "Unnamed user",
                            }))}
                            selectedValues={filters.user}
                            onChange={(next) => applyFilters({ ...filters, user: next })}
                            onClear={() => applyFilters({ ...filters, user: [] })}
                          />
                        </div>
                      ) : null}
                    </div>
                  </th>
                </>
              ) : (
                <>
                  <th className="px-4 py-2">Note</th>
                  <th className="px-4 py-2">
                    <div className="relative flex items-center justify-between gap-2">
                      <span>Date added</span>
                      <button
                        type="button"
                        aria-label="Filter date range"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setOpenMenu((current) => (current === "date" ? null : "date"));
                        }}
                      >
                        <FilterIcon active={Boolean(filters.dateFrom || filters.dateTo)} />
                      </button>
                      {openMenu === "date" ? (
                        <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                          <FilterMenuDateRange
                            title="Date added"
                            from={filters.dateFrom}
                            to={filters.dateTo}
                            onApply={(next) =>
                              applyFilters({
                                ...filters,
                                dateFrom: next.from,
                                dateTo: next.to,
                              })
                            }
                            onClear={() =>
                              applyFilters({ ...filters, dateFrom: "", dateTo: "" })
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                  </th>
                  <th className="px-4 py-2">
                    <div className="relative flex items-center justify-between gap-2">
                      <span>User added</span>
                      <button
                        type="button"
                        aria-label="Filter user"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setOpenMenu((current) => (current === "user" ? null : "user"));
                        }}
                      >
                        <FilterIcon active={filters.user.length > 0} />
                      </button>
                      {openMenu === "user" ? (
                        <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                          <FilterMenuMulti
                            title="User added"
                            options={users.map((user) => ({
                              value: user.id,
                              label: user.full_name || user.email || "Unnamed user",
                            }))}
                            selectedValues={filters.user}
                            onChange={(next) => applyFilters({ ...filters, user: next })}
                            onClear={() => applyFilters({ ...filters, user: [] })}
                          />
                        </div>
                      ) : null}
                    </div>
                  </th>
                </>
              )}

              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>

          <tbody>
            {notes.length ? (
              notes.map((note) => {
                const lastEditedAt = note.last_edited_at || note.created_at || null;
                const editedById = note.last_edited_by_user_id || note.user_id || "";
                const editedByLabel = editedById
                  ? editorLabelsById[editedById] || "Unknown user"
                  : "Unknown user";

                return (
                  <tr key={note.id} className="border-t border-slate-200">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {getRelationName(note.clients, "Unknown client")}
                    </td>
                    {supportsNotePages ? (
                      <>
                        <td className="px-4 py-3">
                          <Link
                            href={`/clients/${note.client_id}/notes/${note.id}`}
                            className="font-semibold text-slate-900 hover:underline"
                          >
                            {note.title || "Untitled"}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {truncate(note.content || "") || "-"}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {lastEditedAt
                            ? new Date(lastEditedAt).toLocaleString("en-US")
                            : ""}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{editedByLabel}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 whitespace-pre-line text-slate-700">
                          {note.content}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {note.created_at
                            ? new Date(note.created_at).toLocaleDateString("en-US")
                            : ""}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {editedByLabel}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-3">
                      <form action={onDelete}>
                        <input type="hidden" name="note_id" value={note.id} />
                        <ConfirmDelete
                          name={
                            (note.content || "")
                              .replace(/\s+/g, " ")
                              .trim()
                              .slice(0, 40) || "this"
                          }
                          itemType="Note"
                        />
                      </form>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  className="px-4 py-6 text-slate-500"
                  colSpan={supportsNotePages ? 6 : 5}
                >
                  No notes found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mobile-list-stack md:hidden">
        {notes.length ? (
          notes.map((note) => {
            const lastEditedAt = note.last_edited_at || note.created_at || null;
            const editedById = note.last_edited_by_user_id || note.user_id || "";
            const editedByLabel = editedById
              ? editorLabelsById[editedById] || "Unknown user"
              : "Unknown user";
            const clientName = getRelationName(note.clients, "Unknown client");
            const noteTitle = note.title || "Untitled";
            return (
              <article
                key={`mobile-${note.id}`}
                className="mobile-list-card space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 font-semibold text-slate-700">
                    {clientName}
                  </span>
                  <span>
                    {lastEditedAt
                      ? new Date(lastEditedAt).toLocaleDateString("en-US")
                      : ""}
                  </span>
                </div>
                {supportsNotePages ? (
                  <>
                    <Link
                      href={`/clients/${note.client_id}/notes/${note.id}`}
                      className="block text-base font-semibold text-slate-900 hover:underline"
                    >
                      {noteTitle}
                    </Link>
                    <p className="text-sm text-slate-700">
                      {truncate(note.content || "") || "-"}
                    </p>
                  </>
                ) : (
                  <p className="whitespace-pre-line text-sm text-slate-700">
                    {note.content || "-"}
                  </p>
                )}
                <div className="text-xs text-slate-500">
                  {supportsNotePages ? "Last edited by" : "Added by"} {editedByLabel}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {supportsNotePages ? (
                    <Link
                      href={`/clients/${note.client_id}/notes/${note.id}`}
                      className="mobile-card-action"
                    >
                      Open
                    </Link>
                  ) : (
                    <span />
                  )}
                  <form action={onDelete}>
                    <input type="hidden" name="note_id" value={note.id} />
                    <ConfirmDelete
                      name={
                        (note.content || "")
                          .replace(/\s+/g, " ")
                          .trim()
                          .slice(0, 40) || "this"
                      }
                      itemType="Note"
                    />
                  </form>
                </div>
              </article>
            );
          })
        ) : (
          <p className="mobile-empty-state">
            No notes found.
          </p>
        )}
      </div>
    </section>
  );
}
