"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type UserOption = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type AssigneeMultiSelectProps = {
  users: UserOption[];
  name: string;
  className?: string;
  defaultSelected?: string[];
  form?: string;
};

export default function AssigneeMultiSelect({
  users,
  name,
  className,
  defaultSelected = [],
  form,
}: AssigneeMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(defaultSelected);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const label = useMemo(() => {
    if (!selectedIds.length) {
      return "Unassigned";
    }
    if (selectedIds.length > 1) {
      return "Multiple";
    }
    const user = users.find((candidate) => candidate.id === selectedIds[0]);
    return user?.full_name || user?.email || "Assigned";
  }, [selectedIds, users]);

  const toggle = (userId: string) => {
    setSelectedIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    );
  };

  return (
    <div className={className} ref={containerRef}>
      <button
        type="button"
        className="relative w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-8 text-left text-sm text-slate-700"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="block truncate">{label}</span>
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-slate-400">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </button>
      {open ? (
        <div className="absolute z-10 mt-1 w-full min-w-[16rem] max-h-56 overflow-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
          {users.length ? (
            users.map((user) => (
              <label
                key={user.id}
                className="flex items-center gap-2 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  value={user.id}
                  form={form}
                  checked={selectedIds.includes(user.id)}
                  onChange={() => toggle(user.id)}
                />
                <span>{user.full_name || user.email}</span>
              </label>
            ))
          ) : (
            <p className="px-2 py-1 text-sm text-slate-500">No users</p>
          )}
        </div>
      ) : null}
      {selectedIds.map((id) => (
        <input key={id} type="hidden" name={name} value={id} form={form} />
      ))}
    </div>
  );
}
