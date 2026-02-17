"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import FormFieldsBuilder from "./FormFieldsBuilder";
import FormTaskTemplatesBuilder from "./FormTaskTemplatesBuilder";
import FormAccessBuilder from "./FormAccessBuilder";
import { formStatusOptions, formatFormLabel, type FormAccessAssignment, type FormField, type FormStatus } from "./types";

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

type UserOption = {
  id: string;
  label: string;
  secondaryLabel?: string;
};

type SaveResult = {
  ok: boolean;
  error?: string;
};

export default function FormConfigureAutosave({
  initialTitle,
  initialDescription,
  initialStatus,
  initialFields,
  initialTemplateIds,
  initialManualTasks,
  taskTemplates,
  userOptions,
  initialFormAccessAssignments,
  taskTemplatesMissing,
  formAccessSchemaMissing,
  onAutoSave,
}: {
  initialTitle: string;
  initialDescription: string;
  initialStatus: FormStatus;
  initialFields: FormField[];
  initialTemplateIds: string[];
  initialManualTasks: ManualTask[];
  taskTemplates: TaskTemplateOption[];
  userOptions: UserOption[];
  initialFormAccessAssignments: FormAccessAssignment[];
  taskTemplatesMissing: boolean;
  formAccessSchemaMissing: boolean;
  onAutoSave: (formData: FormData) => Promise<SaveResult>;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedAtLabel, setSavedAtLabel] = useState("");
  const saveInFlightRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const saveQueuedForceRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPayloadRef = useRef("");

  const formatSavedAt = () =>
    new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const clearPendingTimer = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  };

  useEffect(() => () => clearPendingTimer(), []);

  const buildPayloadKey = (formData: FormData) =>
    JSON.stringify({
      title: String(formData.get("title") || "").trim(),
      description: String(formData.get("description") || "").trim(),
      status: String(formData.get("status") || "draft").trim(),
      fields_json: String(formData.get("fields_json") || "[]"),
      task_template_ids_json: String(formData.get("task_template_ids_json") || "[]"),
      manual_tasks_json: String(formData.get("manual_tasks_json") || "[]"),
      form_access_json: String(formData.get("form_access_json") || "[]"),
    });

  const initialPayloadKey = useMemo(
    () =>
      JSON.stringify({
        title: initialTitle.trim(),
        description: initialDescription.trim(),
        status: initialStatus,
        fields_json: JSON.stringify(initialFields),
        task_template_ids_json: JSON.stringify(
          Array.from(new Set(initialTemplateIds.map((value) => String(value || "").trim()).filter(Boolean)))
        ),
        manual_tasks_json: JSON.stringify(
          initialManualTasks
            .map((task) => ({
              title: String(task.title || "").trim(),
              description: String(task.description || "").trim(),
            }))
            .filter((task) => task.title)
        ),
        form_access_json: JSON.stringify(initialFormAccessAssignments),
      }),
    [
      initialDescription,
      initialFields,
      initialFormAccessAssignments,
      initialManualTasks,
      initialStatus,
      initialTemplateIds,
      initialTitle,
    ]
  );

  useEffect(() => {
    lastPayloadRef.current = initialPayloadKey;
  }, [initialPayloadKey]);

  const runSave = async ({ force = false }: { force?: boolean } = {}) => {
    const form = formRef.current;
    if (!form) return;

    if (saveInFlightRef.current) {
      saveQueuedRef.current = true;
      saveQueuedForceRef.current = saveQueuedForceRef.current || force;
      return;
    }

    const formData = new FormData(form);
    const title = String(formData.get("title") || "").trim();
    if (!title) {
      setSaveError("Form title is required");
      return;
    }
    const payloadKey = buildPayloadKey(formData);
    if (!force && payloadKey === lastPayloadRef.current) {
      return;
    }

    saveInFlightRef.current = true;
    setIsSaving(true);
    setSaveError("");

    try {
      const result = await onAutoSave(formData);
      if (!result?.ok) {
        setSaveError(result?.error || "Failed to save form");
        return;
      }
      lastPayloadRef.current = payloadKey;
      setSavedAtLabel(formatSavedAt());
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String(error.message || "")
          : "";
      setSaveError(message || "Failed to save form");
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
      if (saveQueuedRef.current) {
        const queuedForce = saveQueuedForceRef.current;
        saveQueuedRef.current = false;
        saveQueuedForceRef.current = false;
        void runSave({ force: queuedForce });
      }
    }
  };

  const queueSave = () => {
    clearPendingTimer();
    saveTimerRef.current = setTimeout(() => {
      void runSave();
    }, 700);
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-slate-900">Form configuration</h2>
      </div>
      <form
        ref={formRef}
        className="space-y-4 px-6 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          void runSave({ force: true });
        }}
        onChangeCapture={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          if (!target.matches("input,select,textarea")) return;
          queueSave();
        }}
        onBlurCapture={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          if (!target.matches("input,select,textarea")) return;
          clearPendingTimer();
          void runSave({ force: true });
        }}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Form title
            <input
              name="title"
              required
              defaultValue={initialTitle}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Status
            <select
              name="status"
              defaultValue={initialStatus}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
            >
              {formStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {formatFormLabel(status)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
          Description
          <textarea
            name="description"
            rows={3}
            defaultValue={initialDescription}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
          />
        </label>

        <FormFieldsBuilder initialFields={initialFields} />
        <FormTaskTemplatesBuilder
          initialTemplateIds={initialTemplateIds}
          initialManualTasks={initialManualTasks}
          taskTemplates={taskTemplates}
        />
        <FormAccessBuilder
          users={userOptions}
          initialAssignments={initialFormAccessAssignments}
        />

        {(taskTemplatesMissing || formAccessSchemaMissing) ? (
          <div className="space-y-2">
            {taskTemplatesMissing ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                Task templates are not set up yet. Run <code>sql/templates.sql</code> (and the latest
                forms SQL migration) in Supabase SQL editor.
              </p>
            ) : null}
            {formAccessSchemaMissing ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                Form user access is not set up yet. Run <code>sql/forms_form_permissions.sql</code> in
                Supabase SQL editor.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <p
            className={`text-xs ${
              saveError
                ? "text-red-700"
                : isSaving
                  ? "text-slate-700"
                  : savedAtLabel
                    ? "text-emerald-700"
                    : "text-slate-500"
            }`}
          >
            {saveError
              ? saveError
              : isSaving
                ? "Saving..."
                : savedAtLabel
                  ? `Saved at ${savedAtLabel}`
                  : "Changes auto-save as you edit."}
          </p>
          <button
            type="button"
            onClick={() => {
              clearPendingTimer();
              void runSave({ force: true });
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save now"}
          </button>
        </div>
      </form>
    </section>
  );
}
