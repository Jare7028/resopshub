"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FormFieldsBuilder from "./FormFieldsBuilder";
import FormTaskTemplatesBuilder from "./FormTaskTemplatesBuilder";
import FormAccessBuilder from "./FormAccessBuilder";
import { formStatusOptions } from "./types";

type TaskTemplateOption = {
  id: string;
  name: string;
  title: string;
};

type UserOption = {
  id: string;
  label: string;
  secondaryLabel?: string;
};

type GroupOption = {
  id: string;
  name: string;
  memberCount: number;
};

type AutoSaveResult = {
  ok: boolean;
  formId?: string;
  error?: string;
};

export default function FormCreateAutosave({
  taskTemplates,
  userOptions,
  groupOptions,
  taskTemplatesMissing,
  formAccessSchemaMissing,
  returnTo,
  onAutoSave,
}: {
  taskTemplates: TaskTemplateOption[];
  userOptions: UserOption[];
  groupOptions: GroupOption[];
  taskTemplatesMissing: boolean;
  formAccessSchemaMissing: boolean;
  returnTo: string;
  onAutoSave: (formData: FormData) => Promise<AutoSaveResult>;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [draftFormId, setDraftFormId] = useState("");
  const draftFormIdRef = useRef("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedAtLabel, setSavedAtLabel] = useState("");
  const [isAccessOpen, setIsAccessOpen] = useState(false);
  const lastPayloadRef = useRef("");
  const saveQueuedRef = useRef(false);
  const saveQueuedForceRef = useRef(false);
  const saveInFlightRef = useRef(false);

  const buildConfigureUrl = (formId: string) =>
    `/forms/${formId}?return_to=${encodeURIComponent(returnTo)}&tab=configure`;

  const formatSavedAt = () =>
    new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const runSave = async ({
    force = false,
    openAfterSave = false,
  }: {
    force?: boolean;
    openAfterSave?: boolean;
  } = {}) => {
    const form = formRef.current;
    if (!form) return;

    if (saveInFlightRef.current) {
      saveQueuedRef.current = true;
      saveQueuedForceRef.current = saveQueuedForceRef.current || force;
      return;
    }

    const formData = new FormData(form);
    const currentDraftFormId = draftFormIdRef.current;
    formData.set("form_id", currentDraftFormId);

    const title = String(formData.get("title") || "").trim();
    if (!title) {
      if (openAfterSave) {
        setSaveError("Form title is required");
      }
      return;
    }

    const payloadKey = JSON.stringify({
      form_id: currentDraftFormId,
      title,
      description: String(formData.get("description") || "").trim(),
      status: String(formData.get("status") || "draft").trim(),
      fields_json: String(formData.get("fields_json") || "[]"),
      task_template_ids_json: String(formData.get("task_template_ids_json") || "[]"),
      manual_tasks_json: String(formData.get("manual_tasks_json") || "[]"),
      form_access_json: String(formData.get("form_access_json") || "[]"),
    });

    if (!force && payloadKey === lastPayloadRef.current) {
      if (openAfterSave && currentDraftFormId) {
        router.push(buildConfigureUrl(currentDraftFormId));
      }
      return;
    }

    saveInFlightRef.current = true;
    setIsSaving(true);
    setSaveError("");
    try {
      const result = await onAutoSave(formData);
      if (!result?.ok || !result.formId) {
        setSaveError(result?.error || "Failed to save form");
        return;
      }

      draftFormIdRef.current = result.formId;
      setDraftFormId(result.formId);
      lastPayloadRef.current = JSON.stringify({
        form_id: result.formId,
        title,
        description: String(formData.get("description") || "").trim(),
        status: String(formData.get("status") || "draft").trim(),
        fields_json: String(formData.get("fields_json") || "[]"),
        task_template_ids_json: String(formData.get("task_template_ids_json") || "[]"),
        manual_tasks_json: String(formData.get("manual_tasks_json") || "[]"),
        form_access_json: String(formData.get("form_access_json") || "[]"),
      });
      setSavedAtLabel(formatSavedAt());

      if (openAfterSave) {
        router.push(buildConfigureUrl(result.formId));
      }
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

  useEffect(() => {
    if (!isAccessOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAccessOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isAccessOpen]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Create form</h2>
        <button
          type="button"
          onClick={() => setIsAccessOpen(true)}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Form access
        </button>
      </div>
      <form
        ref={formRef}
        className="mt-4 space-y-4"
        onBlurCapture={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          if (!target.matches("input,select,textarea")) return;
          void runSave();
        }}
      >
        <input type="hidden" name="form_id" value={draftFormId} />

        <div className="grid gap-4 md:grid-cols-3">
          <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Form title
            <input
              name="title"
              required
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              placeholder="New employee onboarding"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Status
            <select
              name="status"
              defaultValue="draft"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
            >
              {formStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
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
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
            placeholder="Capture details and trigger onboarding tasks."
          />
        </label>

        <FormFieldsBuilder initialFields={[]} />
        <FormTaskTemplatesBuilder
          initialTemplateIds={[]}
          initialManualTasks={[]}
          taskTemplates={taskTemplates}
        />

        <div className={isAccessOpen ? "fixed inset-0 z-50 flex items-center justify-center p-4" : "hidden"}>
          <button
            type="button"
            aria-label="Close form access"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => setIsAccessOpen(false)}
          />
          <section className="relative z-10 w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Form access</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Grant view or edit access for specific people.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAccessOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
            </header>
            <div className="space-y-4 px-5 py-4">
              <FormAccessBuilder
                users={userOptions}
                groups={groupOptions}
                initialAssignments={[]}
                disabled={isSaving}
              />
              {formAccessSchemaMissing ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                  Form user access is not set up yet. Run <code>sql/forms_form_permissions.sql</code>{" "}
                  in Supabase SQL editor.
                </p>
              ) : null}
              <div className="flex justify-end border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setIsAccessOpen(false)}
                  className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  Done
                </button>
              </div>
            </div>
          </section>
        </div>

        {taskTemplatesMissing ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            Task templates are not set up yet. Run `sql/templates.sql` in Supabase SQL editor.
          </p>
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
                  : "Autosave starts after you enter a form title and leave a field."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {draftFormId ? (
              <button
                type="button"
                onClick={() => void runSave({ force: true, openAfterSave: true })}
                className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                disabled={isSaving}
              >
                Open form
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void runSave({ force: true, openAfterSave: true })}
                className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                disabled={isSaving}
              >
                Create form
              </button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
