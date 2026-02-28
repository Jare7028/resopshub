"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  encodeAssignmentTarget,
  parseAssignmentTarget,
} from "@/lib/assignmentTargets";

type UserOption = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type GroupOption = {
  id: string;
  name: string;
  memberCount?: number;
};

type AssigneeMultiSelectProps = {
  users: UserOption[];
  groups?: GroupOption[];
  name: string;
  className?: string;
  defaultSelected?: string[];
  form?: string;
  onSelectionChange?: (selectedIds: string[]) => void;
};

export default function AssigneeMultiSelect({
  users,
  groups = [],
  name,
  className,
  defaultSelected = [],
  form,
  onSelectionChange,
}: AssigneeMultiSelectProps) {
  const normalizedDefaultSelection = useMemo(
    () =>
      Array.from(
        new Set(
          defaultSelected
            .map((value) => parseAssignmentTarget(value)?.value || "")
            .filter(Boolean)
        )
      ),
    [defaultSelected]
  );
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(normalizedDefaultSelection);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelectedIds(normalizedDefaultSelection);
  }, [normalizedDefaultSelection]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const usersById = useMemo(
    () =>
      users.reduce<Record<string, string>>((acc, user) => {
        const id = String(user.id || "").trim();
        if (!id) return acc;
        acc[id] = user.full_name || user.email || "Unknown user";
        return acc;
      }, {}),
    [users]
  );

  const groupOptions = useMemo(
    () =>
      groups
        .map((group) => ({
          value: encodeAssignmentTarget("group", group.id),
          label: group.name,
          memberCount: Number(group.memberCount || 0),
        }))
        .filter((group) => group.value && group.label),
    [groups]
  );

  const optionLabelByValue = useMemo(() => {
    const map = new Map<string, string>();
    Object.entries(usersById).forEach(([id, label]) => {
      map.set(id, label);
    });
    groupOptions.forEach((group) => {
      map.set(group.value, group.label);
    });
    return map;
  }, [groupOptions, usersById]);

  const label = useMemo(() => {
    if (!selectedIds.length) {
      return "Unassigned";
    }
    if (selectedIds.length > 1) {
      return `${selectedIds.length} selected`;
    }
    return optionLabelByValue.get(selectedIds[0]) || "Assigned";
  }, [optionLabelByValue, selectedIds]);

  const toggle = (value: string) => {
    setSelectedIds((current) => {
      const next = current.includes(value)
        ? current.filter((id) => id !== value)
        : [...current, value];
      onSelectionChange?.(next);
      return next;
    });
  };

  return (
    <div className={className} ref={containerRef}>
      <button
        type="button"
        className="relative h-10 w-full rounded-lg border border-slate-200 bg-white px-3 pr-8 text-left text-sm leading-5 text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
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
        <div className="absolute z-10 mt-1 w-full min-w-[16rem] max-h-56 overflow-auto rounded-lg bg-white p-2 ring-1 ring-slate-200 shadow-lg">
          {users.length ? (
            <div>
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                People
              </p>
              {users.map((user) => (
                <label
                  key={user.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
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
              ))}
            </div>
          ) : (
            <p className="px-2 py-1 text-sm text-slate-500">No users</p>
          )}
          {groupOptions.length ? (
            <div className={users.length ? "mt-2 border-t border-slate-100 pt-2" : ""}>
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Groups
              </p>
              {groupOptions.map((group) => (
                <label
                  key={group.value}
                  className="flex items-start gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    value={group.value}
                    form={form}
                    checked={selectedIds.includes(group.value)}
                    onChange={() => toggle(group.value)}
                    className="mt-0.5"
                  />
                  <span className="flex flex-col leading-tight">
                    <span>{group.label}</span>
                    <span className="text-[11px] text-slate-500">
                      {group.memberCount === 1
                        ? "1 member"
                        : `${group.memberCount} members`}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {!users.length && !groupOptions.length ? (
            <p className="px-2 py-1 text-sm text-slate-500">No assignees available</p>
          ) : null}
        </div>
      ) : null}
      {selectedIds.map((id) => (
        <input key={id} type="hidden" name={name} value={id} form={form} />
      ))}
    </div>
  );
}
