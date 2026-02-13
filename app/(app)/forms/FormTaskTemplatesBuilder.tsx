"use client";

import { useMemo, useState } from "react";

type TaskTemplateOption = {
  id: string;
  name: string;
  title: string;
};

type ManualTask = {
  id: string;
  title: string;
  description: string;
};

export default function FormTaskTemplatesBuilder({
  templateFieldName = "task_template_ids_json",
  manualTaskFieldName = "manual_tasks_json",
  initialTemplateIds,
  initialManualTasks,
  taskTemplates,
}: {
  templateFieldName?: string;
  manualTaskFieldName?: string;
  initialTemplateIds: string[];
  initialManualTasks: ManualTask[];
  taskTemplates: TaskTemplateOption[];
}) {
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>(
    Array.from(new Set(initialTemplateIds.filter(Boolean)))
  );
  const [manualTasks, setManualTasks] = useState<ManualTask[]>(initialManualTasks || []);
  const [pendingTemplateId, setPendingTemplateId] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const serializedTemplateIds = useMemo(
    () => JSON.stringify(selectedTemplateIds),
    [selectedTemplateIds]
  );
  const serializedManualTasks = useMemo(
    () =>
      JSON.stringify(
        manualTasks
          .map((task) => ({
            title: task.title.trim(),
            description: task.description.trim(),
          }))
          .filter((task) => task.title)
      ),
    [manualTasks]
  );

  const selectedSet = useMemo(() => new Set(selectedTemplateIds), [selectedTemplateIds]);
  const selectedTemplates = selectedTemplateIds
    .map((id) => taskTemplates.find((template) => template.id === id))
    .filter(Boolean) as TaskTemplateOption[];
  const availableTemplates = taskTemplates.filter((template) => !selectedSet.has(template.id));

  const addManualTask = () => {
    setManualTasks((current) => [
      ...current,
      { id: `manual_${Date.now()}_${current.length + 1}`, title: "", description: "" },
    ]);
    setIsPickerOpen(false);
  };

  const addTemplateTask = () => {
    if (!pendingTemplateId) return;
    setSelectedTemplateIds((current) =>
      current.includes(pendingTemplateId) ? current : [...current, pendingTemplateId]
    );
    setPendingTemplateId("");
    setIsPickerOpen(false);
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name={templateFieldName} value={serializedTemplateIds} />
      <input type="hidden" name={manualTaskFieldName} value={serializedManualTasks} />

      <div className="space-y-2">
        <h3 className="text-base font-semibold text-slate-900">Task triggers</h3>
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Add a new Task or use a Task Template to be triggered after submission.
        </p>
        <button
          type="button"
          onClick={() => setIsPickerOpen((current) => !current)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400"
        >
          Add Task
        </button>
      </div>

      {isPickerOpen ? (
        <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
          <button
            type="button"
            onClick={addManualTask}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:border-slate-400"
          >
            Add new task
          </button>
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Use task template
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={pendingTemplateId}
                onChange={(event) => setPendingTemplateId(event.target.value)}
                className="min-w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select a task template</option>
                {availableTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name || template.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addTemplateTask}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
              >
                Use template
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {(manualTasks.length || selectedTemplates.length) ? (
        <div className="space-y-2">
          {manualTasks.map((task, index) => (
            <div key={task.id} className="space-y-2 rounded-md border border-slate-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Task {index + 1}
              </p>
              <input
                value={task.title}
                onChange={(event) =>
                  setManualTasks((current) =>
                    current.map((item) =>
                      item.id === task.id ? { ...item, title: event.target.value } : item
                    )
                  )
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Task title"
              />
              <input
                value={task.description}
                onChange={(event) =>
                  setManualTasks((current) =>
                    current.map((item) =>
                      item.id === task.id
                        ? { ...item, description: event.target.value }
                        : item
                    )
                  )
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Task description (optional)"
              />
              <button
                type="button"
                onClick={() =>
                  setManualTasks((current) => current.filter((item) => item.id !== task.id))
                }
                className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:border-red-300 hover:text-red-800"
              >
                Remove
              </button>
            </div>
          ))}

          {selectedTemplates.map((template, index) => (
            <div
              key={template.id}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2"
            >
              <p className="text-sm text-slate-800">
                <span className="font-semibold">Template {index + 1}.</span>{" "}
                {template.name || template.title}
              </p>
              <button
                type="button"
                onClick={() =>
                  setSelectedTemplateIds((current) =>
                    current.filter((templateId) => templateId !== template.id)
                  )
                }
                className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:border-red-300 hover:text-red-800"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
          No tasks configured.
        </p>
      )}
    </div>
  );
}

