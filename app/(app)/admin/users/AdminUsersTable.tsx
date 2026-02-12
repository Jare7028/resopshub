"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FilterIcon,
  FilterMenuMulti,
  FilterMenuText,
} from "@/app/(app)/_components/TableHeaderFilters";

type UserRow = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  status: string;
  created_at: string | null;
};

type HeaderMenuKey = "name" | "email" | "role" | "status";
type UserSortKey = "name" | "email" | "role" | "status";
type UserSortDir = "asc" | "desc";

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export default function AdminUsersTable({
  users,
  roleOptions,
  statusOptions,
  onUpdate,
}: {
  users: UserRow[];
  roleOptions: readonly string[];
  statusOptions: readonly string[];
  onUpdate: (formData: FormData) => void;
}) {
  const [openMenu, setOpenMenu] = useState<HeaderMenuKey | null>(null);
  const [sortKey, setSortKey] = useState<UserSortKey>("name");
  const [sortDir, setSortDir] = useState<UserSortDir>("asc");
  const [filters, setFilters] = useState({
    name: "",
    email: "",
    role: [] as string[],
    status: [] as string[],
  });
  const menuRef = useRef<HTMLDivElement | null>(null);

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

  const filteredAndSortedUsers = useMemo(() => {
    const normalizedName = filters.name.trim().toLowerCase();
    const normalizedEmail = filters.email.trim().toLowerCase();

    const filtered = users.filter((user) => {
      const userName = (user.full_name || "").toLowerCase();
      const userEmail = user.email.toLowerCase();

      if (normalizedName && !userName.includes(normalizedName)) return false;
      if (normalizedEmail && !userEmail.includes(normalizedEmail)) return false;
      if (filters.role.length > 0 && !filters.role.includes(user.role)) return false;
      if (filters.status.length > 0 && !filters.status.includes(user.status)) return false;

      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === "name") {
        return compareText(a.full_name || "", b.full_name || "");
      }
      if (sortKey === "email") {
        return compareText(a.email, b.email);
      }
      if (sortKey === "role") {
        return compareText(a.role, b.role);
      }
      return compareText(a.status, b.status);
    });

    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [users, filters, sortKey, sortDir]);

  const toggleSort = (nextSortKey: UserSortKey) => {
    if (sortKey === nextSortKey) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextSortKey);
    setSortDir("asc");
  };

  const sortLabel = (key: UserSortKey, label: string) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className={`font-semibold hover:text-slate-900 ${sortKey === key ? "text-slate-900" : "text-slate-500"}`}
    >
      {label}
      {sortKey === key ? (
        <span className="ml-1 text-[10px]">{sortDir === "asc" ? "^" : "v"}</span>
      ) : null}
    </button>
  );

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-6 py-3">
              <div className="relative flex items-center justify-between gap-2">
                {sortLabel("name", "Name")}
                <button
                  type="button"
                  aria-label="Filter name"
                  onClick={() => setOpenMenu((current) => (current === "name" ? null : "name"))}
                >
                  <FilterIcon active={Boolean(filters.name.trim())} />
                </button>
                {openMenu === "name" ? (
                  <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                    <FilterMenuText
                      title="Name"
                      value={filters.name}
                      placeholder="Search by name..."
                      onApply={(next) => {
                        setFilters((current) => ({ ...current, name: next }));
                        setOpenMenu(null);
                      }}
                      onClear={() => {
                        setFilters((current) => ({ ...current, name: "" }));
                        setOpenMenu(null);
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </th>
            <th className="px-6 py-3">
              <div className="relative flex items-center justify-between gap-2">
                {sortLabel("email", "Email")}
                <button
                  type="button"
                  aria-label="Filter email"
                  onClick={() => setOpenMenu((current) => (current === "email" ? null : "email"))}
                >
                  <FilterIcon active={Boolean(filters.email.trim())} />
                </button>
                {openMenu === "email" ? (
                  <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                    <FilterMenuText
                      title="Email"
                      value={filters.email}
                      placeholder="Search by email..."
                      onApply={(next) => {
                        setFilters((current) => ({ ...current, email: next }));
                        setOpenMenu(null);
                      }}
                      onClear={() => {
                        setFilters((current) => ({ ...current, email: "" }));
                        setOpenMenu(null);
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </th>
            <th className="px-6 py-3">
              <div className="relative flex items-center justify-between gap-2">
                {sortLabel("role", "Role")}
                <button
                  type="button"
                  aria-label="Filter role"
                  onClick={() => setOpenMenu((current) => (current === "role" ? null : "role"))}
                >
                  <FilterIcon active={filters.role.length > 0} />
                </button>
                {openMenu === "role" ? (
                  <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                    <FilterMenuMulti
                      title="Role"
                      options={roleOptions.map((role) => ({ value: role, label: role }))}
                      selectedValues={filters.role}
                      onChange={(next) => setFilters((current) => ({ ...current, role: next }))}
                      onClear={() => setFilters((current) => ({ ...current, role: [] }))}
                    />
                  </div>
                ) : null}
              </div>
            </th>
            <th className="px-6 py-3">
              <div className="relative flex items-center justify-between gap-2">
                {sortLabel("status", "Status")}
                <button
                  type="button"
                  aria-label="Filter status"
                  onClick={() => setOpenMenu((current) => (current === "status" ? null : "status"))}
                >
                  <FilterIcon active={filters.status.length > 0} />
                </button>
                {openMenu === "status" ? (
                  <div ref={menuRef} className="absolute right-0 top-full z-30 mt-2">
                    <FilterMenuMulti
                      title="Status"
                      options={statusOptions.map((status) => ({ value: status, label: status }))}
                      selectedValues={filters.status}
                      onChange={(next) => setFilters((current) => ({ ...current, status: next }))}
                      onClear={() => setFilters((current) => ({ ...current, status: [] }))}
                    />
                  </div>
                ) : null}
              </div>
            </th>
            <th className="px-6 py-3 text-slate-700">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredAndSortedUsers.length ? (
            filteredAndSortedUsers.map((user) => {
              const formId = `user-update-${user.id}`;

              return (
                <tr key={user.id} className="border-t border-slate-200">
                  <td className="px-6 py-3 font-medium text-slate-900">
                    <input
                      form={formId}
                      name="full_name"
                      defaultValue={user.full_name || ""}
                      placeholder="Full name"
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-6 py-3 text-slate-600">
                    <input
                      form={formId}
                      type="email"
                      name="email"
                      defaultValue={user.email}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                      required
                    />
                  </td>
                  <td className="px-6 py-3">
                    <select
                      form={formId}
                      name="role"
                      defaultValue={user.role}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      {roleOptions.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-3">
                    <select
                      form={formId}
                      name="status"
                      defaultValue={user.status}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-3">
                    <form id={formId} action={onUpdate}>
                      <input type="hidden" name="user_id" value={user.id} />
                      <button
                        type="submit"
                        className="rounded-md btn-primary px-3 py-1.5 text-xs font-semibold text-white "
                      >
                        Update
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td className="px-6 py-6 text-slate-500" colSpan={5}>
                No users found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
