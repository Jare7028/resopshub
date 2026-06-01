"use client";

import Link from "next/link";
import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import QuickSubtasksField from "./QuickSubtasksField";
import type { QuickCreateTaskResult } from "../actions";

type QuickCreateTaskSuccess = Extract<QuickCreateTaskResult, { ok: true }>;

type QuickAddTaskModalProps = {
  open: boolean;
  advancedHref?: string;
  onClose: () => void;
  onCreate: (formData: FormData) => Promise<QuickCreateTaskResult>;
  onCreated: (result: QuickCreateTaskSuccess) => void;
};

export default function QuickAddTaskModal({
  open,
  advancedHref,
  onClose,
  onCreate,
  onCreated,
}: QuickAddTaskModalProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => titleInputRef.current?.focus(), 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isSubmitting, onClose, open]);

  useEffect(() => {
    if (open) return;
    setError("");
  }, [open]);

  if (!open) return null;

  const resetForm = () => {
    formRef.current?.reset();
    setFormKey((current) => current + 1);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    setError("");
    setIsSubmitting(true);
    try {
      const result = await onCreate(new FormData(event.currentTarget));
      if (!result.ok) {
        setError(result.error || "Unable to create task");
        return;
      }
      onCreated(result);
      resetForm();
      onClose();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Unable to create task"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[280] flex items-end justify-center bg-slate-950/30 px-3 py-4 backdrop-blur-[1px] sm:items-center"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-add-task-title"
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
          <h2 id="quick-add-task-title" className="text-base font-semibold text-slate-900">
            Add task
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close add task"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            X
          </button>
        </div>

        <form
          ref={formRef}
          key={formKey}
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
            {error ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                {error}
              </div>
            ) : null}

            <div>
              <label
                htmlFor="quick-task-title"
                className="text-[11px] font-semibold uppercase text-slate-500"
              >
                Title
              </label>
              <input
                ref={titleInputRef}
                id="quick-task-title"
                name="title"
                type="text"
                maxLength={180}
                required
                className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </div>

            <div>
              <label
                htmlFor="quick-task-notes"
                className="text-[11px] font-semibold uppercase text-slate-500"
              >
                Task notes
              </label>
              <textarea
                id="quick-task-notes"
                name="notes"
                rows={7}
                maxLength={12000}
                className="mt-1 min-h-32 w-full resize-y rounded-md border border-slate-300 px-3 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </div>

            <QuickSubtasksField className="border-t border-slate-200 pt-3" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 sm:px-5">
            {advancedHref ? (
              <Link
                href={advancedHref}
                prefetch={false}
                aria-disabled={isSubmitting}
                onClick={(event) => {
                  if (isSubmitting) {
                    event.preventDefault();
                    return;
                  }
                  onClose();
                }}
                className="text-sm font-semibold text-slate-600 hover:text-slate-900"
              >
                Advanced options
              </Link>
            ) : (
              <span aria-hidden="true" />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="inline-flex h-10 items-center rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-10 items-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Adding..." : "Add task"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
