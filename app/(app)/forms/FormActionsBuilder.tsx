"use client";

import { useMemo, useState } from "react";
import {
  formActionPriorityOptions,
  formatFormLabel,
  normalizeFormActionPriority,
  type FormAction,
} from "./types";

function createAction(seed: number): FormAction {
  return {
    id: `action_${seed}`,
    label: "",
    taskTitleTemplate: "",
    taskDescriptionTemplate: "",
    assigneeUserId: null,
    priority: "medium",
    enabled: true,
  };
}

export default function FormActionsBuilder({
  name = "actions_json",
  initialActions,
  users,
}: {
  name?: string;
  initialActions: FormAction[];
  users: Array<{ id: string; full_name: string | null; email: string | null }>;
}) {
  const normalizedInitialActions = useMemo(() => {
    if (!initialActions.length) return [];
    return initialActions.map((action, index) => ({
      ...action,
      id: action.id || `action_${index + 1}`,
      label: action.label || "",
      taskTitleTemplate: action.taskTitleTemplate || "",
      taskDescriptionTemplate: action.taskDescriptionTemplate || "",
      assigneeUserId: action.assigneeUserId || null,
      priority: normalizeFormActionPriority(action.priority),
      enabled: action.enabled !== false,
    }));
  }, [initialActions]);

  const [actions, setActions] = useState<FormAction[]>(normalizedInitialActions);
  const serialized = useMemo(() => JSON.stringify(actions), [actions]);

  return (
    <div className="space-y-4">
      <input type="hidden" name={name} value={serialized} />
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-900">Post-submission actions</h3>
        <button
          type="button"
          onClick={() =>
            setActions((current) => [...current, createAction(current.length + 1)])
          }
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
        >
          Add action
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Use placeholders like {"{{first_name}}"} in task title/description. They map to form field
        keys.
      </p>

      <div className="space-y-3">
        {actions.length ? (
          actions.map((action, index) => (
            <div key={action.id} className="rounded-md border border-slate-200 p-4">
              <div className="grid gap-3 md:grid-cols-6">
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Action label
                  <input
                    value={action.label}
                    onChange={(event) =>
                      setActions((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                label: event.target.value,
                              }
                            : item
                        )
                      )
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    placeholder="Create onboarding tasks"
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Assign task to
                  <select
                    value={action.assigneeUserId || ""}
                    onChange={(event) =>
                      setActions((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                assigneeUserId: event.target.value || null,
                              }
                            : item
                        )
                      )
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  >
                    <option value="">Unassigned</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name || user.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="md:col-span-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Priority
                  <select
                    value={action.priority}
                    onChange={(event) =>
                      setActions((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                priority: normalizeFormActionPriority(event.target.value),
                              }
                            : item
                        )
                      )
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  >
                    {formActionPriorityOptions.map((priority) => (
                      <option key={priority} value={priority}>
                        {formatFormLabel(priority)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="md:col-span-1 flex items-end">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={action.enabled}
                      onChange={(event) =>
                        setActions((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  enabled: event.target.checked,
                                }
                              : item
                          )
                        )
                      }
                    />
                    Enabled
                  </label>
                </div>
                <label className="md:col-span-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Task title template
                  <input
                    value={action.taskTitleTemplate}
                    onChange={(event) =>
                      setActions((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                taskTitleTemplate: event.target.value,
                              }
                            : item
                        )
                      )
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    placeholder="Create email account for {{employee_name}}"
                  />
                </label>
                <label className="md:col-span-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Task description template
                  <input
                    value={action.taskDescriptionTemplate}
                    onChange={(event) =>
                      setActions((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                taskDescriptionTemplate: event.target.value,
                              }
                            : item
                        )
                      )
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    placeholder="Include department {{department}}."
                  />
                </label>
                <div className="md:col-span-6 flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      setActions((current) => current.filter((_, itemIndex) => itemIndex !== index))
                    }
                    className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:border-red-300 hover:text-red-800"
                  >
                    Remove action
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-md border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
            No actions configured yet.
          </p>
        )}
      </div>
    </div>
  );
}
