"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FormAccessBuilder from "./FormAccessBuilder";
import type { FormAccessAssignment } from "./types";

type UserOption = {
  id: string;
  label: string;
  secondaryLabel?: string;
};

type SaveResult = {
  ok: boolean;
  error?: string;
};

export default function FormAccessPopover({
  users,
  initialAssignments,
  formAccessSchemaMissing,
  onSave,
}: {
  users: UserOption[];
  initialAssignments: FormAccessAssignment[];
  formAccessSchemaMissing: boolean;
  onSave: (formData: FormData) => Promise<SaveResult>;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedAtLabel, setSavedAtLabel] = useState("");

  const formatSavedAt = () =>
    new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const openPopover = () => {
    setSaveError("");
    setOpen(true);
  };

  const closePopover = () => {
    if (isSaving) return;
    setOpen(false);
  };

  const saveAccess = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = formRef.current;
    if (!form || formAccessSchemaMissing) return;

    setIsSaving(true);
    setSaveError("");

    try {
      const result = await onSave(new FormData(form));
      if (!result?.ok) {
        setSaveError(result?.error || "Failed to save form access.");
        return;
      }
      setSavedAtLabel(formatSavedAt());
      setOpen(false);
      router.refresh();
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String(error.message || "")
          : "";
      setSaveError(message || "Failed to save form access.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openPopover}
        className="rounded-md border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
      >
        Form access
      </button>
      {savedAtLabel ? <span className="self-center text-xs text-emerald-700">Saved at {savedAtLabel}</span> : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close form access"
            className="absolute inset-0 bg-slate-900/45"
            onClick={closePopover}
          />
          <section className="relative z-10 w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Form Access</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Grant view or edit access for specific people.
                </p>
              </div>
              <button
                type="button"
                onClick={closePopover}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                disabled={isSaving}
              >
                Close
              </button>
            </header>

            <form ref={formRef} onSubmit={saveAccess} className="space-y-4 px-5 py-4">
              {formAccessSchemaMissing ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                  Form user access is not set up yet. Run <code>sql/forms_form_permissions.sql</code> in
                  Supabase SQL editor.
                </p>
              ) : (
                <FormAccessBuilder
                  users={users}
                  initialAssignments={initialAssignments}
                  name="form_access_json"
                  disabled={isSaving}
                />
              )}

              {saveError ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  {saveError}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={closePopover}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || formAccessSchemaMissing}
                  className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? "Saving..." : "Save access"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
