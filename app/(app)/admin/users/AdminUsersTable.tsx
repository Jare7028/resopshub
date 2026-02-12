"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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

type SavePayload = {
  user_id: string;
  full_name?: string | null;
  email?: string;
  role?: string;
  status?: string;
};

type SaveResponse = {
  ok: boolean;
  user?: UserRow;
  error?: string;
};

type DeleteResponse = {
  ok: boolean;
  user_id?: string;
  error?: string;
};

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

async function saveUser(payload: SavePayload): Promise<SaveResponse> {
  const response = await fetch("/api/admin/users/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = (await response.json().catch(() => null)) as SaveResponse | null;
  if (!response.ok || !json?.ok || !json.user) {
    return {
      ok: false,
      error: json?.error || "Failed to save user",
    };
  }

  return {
    ok: true,
    user: json.user,
  };
}

async function permanentlyDeleteUser(userId: string): Promise<DeleteResponse> {
  const response = await fetch("/api/admin/users/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  });

  const json = (await response.json().catch(() => null)) as DeleteResponse | null;
  if (!response.ok || !json?.ok || !json.user_id) {
    return {
      ok: false,
      error: json?.error || "Failed to delete user",
    };
  }

  return {
    ok: true,
    user_id: json.user_id,
  };
}

export default function AdminUsersTable({
  users,
  roleOptions,
  statusOptions,
  currentUserId,
}: {
  users: UserRow[];
  roleOptions: readonly string[];
  statusOptions: readonly string[];
  currentUserId: string;
}) {
  const [tableUsers, setTableUsers] = useState(users);
  const [openMenu, setOpenMenu] = useState<HeaderMenuKey | null>(null);
  const [sortKey, setSortKey] = useState<UserSortKey>("name");
  const [sortDir, setSortDir] = useState<UserSortDir>("asc");
  const [filters, setFilters] = useState({
    name: "",
    email: "",
    role: [] as string[],
    status: [] as string[],
  });
  const [savingUserIds, setSavingUserIds] = useState<string[]>([]);
  const [deletingUserIds, setDeletingUserIds] = useState<string[]>([]);
  const [errorByUserId, setErrorByUserId] = useState<Record<string, string>>({});
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTableUsers(users);
  }, [users]);

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

    const filtered = tableUsers.filter((user) => {
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
  }, [tableUsers, filters, sortKey, sortDir]);

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

  const setUserPatch = (userId: string, patch: Partial<UserRow>) => {
    setTableUsers((current) =>
      current.map((user) => (user.id === userId ? { ...user, ...patch } : user))
    );
  };

  const runSave = async (
    payload: SavePayload,
    rollbackPatch: Partial<UserRow> | null = null
  ) => {
    setSavingUserIds((current) => Array.from(new Set([...current, payload.user_id])));
    setErrorByUserId((current) => ({ ...current, [payload.user_id]: "" }));

    const result = await saveUser(payload);

    if (!result.ok || !result.user) {
      if (rollbackPatch) {
        setUserPatch(payload.user_id, rollbackPatch);
      }
      setErrorByUserId((current) => ({
        ...current,
        [payload.user_id]: result.error || "Failed to save user",
      }));
      setSavingUserIds((current) => current.filter((id) => id !== payload.user_id));
      return;
    }

    setUserPatch(payload.user_id, result.user);
    setSavingUserIds((current) => current.filter((id) => id !== payload.user_id));
  };

  const onRoleChange = async (user: UserRow, role: string) => {
    const previousRole = user.role;
    setUserPatch(user.id, { role });
    await runSave({ user_id: user.id, role }, { role: previousRole });
  };

  const onStatusChange = async (user: UserRow, status: string) => {
    const previousStatus = user.status;
    setUserPatch(user.id, { status });
    await runSave({ user_id: user.id, status }, { status: previousStatus });
  };

  const onUpdateSubmit = async (event: FormEvent<HTMLFormElement>, userId: string) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const fullNameRaw = String(formData.get("full_name") || "").trim();
    const email = String(formData.get("email") || "")
      .trim()
      .toLowerCase();
    const role = String(formData.get("role") || "");
    const status = String(formData.get("status") || "");

    await runSave({
      user_id: userId,
      full_name: fullNameRaw || null,
      email,
      role,
      status,
    });
  };

  const onDeleteUser = async (user: UserRow) => {
    const confirmed = window.confirm(
      `Permanently delete ${user.full_name || user.email}? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingUserIds((current) => Array.from(new Set([...current, user.id])));
    setErrorByUserId((current) => ({ ...current, [user.id]: "" }));

    const result = await permanentlyDeleteUser(user.id);

    if (!result.ok || !result.user_id) {
      setErrorByUserId((current) => ({
        ...current,
        [user.id]: result.error || "Failed to delete user",
      }));
      setDeletingUserIds((current) => current.filter((id) => id !== user.id));
      return;
    }

    setTableUsers((current) => current.filter((row) => row.id !== result.user_id));
    setDeletingUserIds((current) => current.filter((id) => id !== user.id));
  };

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
              const isSaving = savingUserIds.includes(user.id);
              const isDeleting = deletingUserIds.includes(user.id);
              const error = errorByUserId[user.id];
              const isSelf = user.id === currentUserId;

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
                      value={user.role}
                      onChange={(event) => onRoleChange(user, event.target.value)}
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
                      value={user.status}
                      onChange={(event) => onStatusChange(user, event.target.value)}
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
                    <form id={formId} onSubmit={(event) => onUpdateSubmit(event, user.id)}>
                      <input type="hidden" name="user_id" value={user.id} />
                      <div className="flex items-center gap-3">
                        <button
                          type="submit"
                          className="rounded-md btn-primary px-3 py-1.5 text-xs font-semibold text-white"
                          disabled={isSaving || isDeleting}
                        >
                          {isSaving ? "Saving..." : "Update"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteUser(user)}
                          className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isDeleting || isSaving || isSelf}
                          title={isSelf ? "You cannot delete your own account" : undefined}
                        >
                          {isDeleting ? "Deleting..." : "Delete permanently"}
                        </button>
                        {error ? (
                          <span className="text-xs text-red-600">{error}</span>
                        ) : null}
                      </div>
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
