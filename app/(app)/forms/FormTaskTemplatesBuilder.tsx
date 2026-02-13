"use client";

import { useMemo, useState } from "react";

type TaskTemplateOption = {
  id: string;
  name: string;
  title: string;
};

export default function FormTaskTemplatesBuilder({
  name = "task_template_ids_json",
  initialTemplateIds,
  taskTemplates,
}: {
  name?: string;
  initialTemplateIds: string[];
  taskTemplates: TaskTemplateOption[];
}) {
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>(
    Array.from(new Set(initialTemplateIds.filter(Boolean)))
  );
  const [pendingTemplateId, setPendingTemplateId] = useState("");

  const serialized = useMemo(
    () => JSON.stringify(selectedTemplateIds),
    [selectedTemplateIds]
  );

  const selectedSet = useMemo(() => new Set(selectedTemplateIds), [selectedTemplateIds]);
  const selectedTemplates = selectedTemplateIds
    .map((id) => taskTemplates.find((template) => template.id === id))
    .filter(Boolean) as TaskTemplateOption[];
  const availableTemplates = taskTemplates.filter((template) => !selectedSet.has(template.id));

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name={name} value={serialized} />
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-slate-900">Task templates</h3>
        <p className="text-xs text-slate-500">
          Selected templates will create tasks and subtasks when a submission is created.
        </p>
      </div>

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
          onClick={() => {
            if (!pendingTemplateId) return;
            setSelectedTemplateIds((current) => {
              if (current.includes(pendingTemplateId)) return current;
              return [...current, pendingTemplateId];
            });
            setPendingTemplateId("");
          }}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
        >
          Add template
        </button>
      </div>

      {selectedTemplates.length ? (
        <div className="space-y-2">
          {selectedTemplates.map((template, index) => (
            <div
              key={template.id}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2"
            >
              <p className="text-sm text-slate-800">
                <span className="font-semibold">{index + 1}.</span>{" "}
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
          No task templates selected.
        </p>
      )}
    </div>
  );
}

