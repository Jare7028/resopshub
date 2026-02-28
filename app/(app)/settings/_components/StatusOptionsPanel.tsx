"use client";

import { useEffect, useMemo, useState } from "react";
import { isCoreStatus, type StatusEntityType } from "@/lib/statusOptions";
import StatusOptionAutoRow from "./StatusOptionAutoRow";

type StatusUpdateResult = { ok: boolean; error?: string } | void;

type StatusSectionRow = {
  id: string;
  value: string;
  position: number;
  isVisible: boolean;
  countsAsCompleted: boolean;
  colorHex: string | null;
};

type StatusSection = {
  title: string;
  entityType: StatusEntityType;
  placeholder: string;
  rows: StatusSectionRow[];
};

function formatCountLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function formatStatusValue(value: string) {
  return value.replace(/_/g, " ");
}

export default function StatusOptionsPanel({
  sections,
  onCreate,
  onUpdate,
  onDelete,
}: {
  sections: StatusSection[];
  onCreate: (formData: FormData) => Promise<void>;
  onUpdate: (formData: FormData) => Promise<StatusUpdateResult>;
  onDelete: (formData: FormData) => Promise<void>;
}) {
  const [openEntityType, setOpenEntityType] = useState<StatusEntityType | null>(null);

  const activeSection = useMemo(
    () => sections.find((section) => section.entityType === openEntityType) || null,
    [openEntityType, sections]
  );

  useEffect(() => {
    if (!openEntityType) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenEntityType(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openEntityType]);

  useEffect(() => {
    if (!openEntityType || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [openEntityType]);

  return (
    <>
      <div className="space-y-2">
        {sections.map((section) => {
          const openCount = section.rows.filter((row) => row.isVisible).length;
          const closedCount = section.rows.filter((row) => row.countsAsCompleted).length;
          const previewStatuses = section.rows.slice(0, 3);

          return (
            <button
              key={section.entityType}
              type="button"
              onClick={() => setOpenEntityType(section.entityType)}
              aria-haspopup="dialog"
              aria-expanded={openEntityType === section.entityType}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{section.title}</p>
                  <p className="text-xs text-slate-500">
                    {formatCountLabel(section.rows.length, "status")} - {formatCountLabel(openCount, "open")} -{" "}
                    {formatCountLabel(closedCount, "closed")}
                  </p>
                  {previewStatuses.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {previewStatuses.map((status) => (
                        <span
                          key={`${section.entityType}-${status.value}`}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: status.colorHex || "#64748b" }}
                          />
                          {formatStatusValue(status.value)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <span className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600">
                  Configure
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {activeSection ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[170] bg-slate-900/45"
            aria-label="Close status settings"
            onClick={() => setOpenEntityType(null)}
          />
          <div className="fixed inset-0 z-[180] flex items-center justify-center p-4 md:p-6">
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`${activeSection.title} settings`}
              className="w-full max-w-5xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">{activeSection.title}</h3>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      {formatCountLabel(activeSection.rows.length, "status")}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Open statuses stay in list views. Closed statuses are hidden by default.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenEntityType(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                  aria-label="Close"
                >
                  x
                </button>
              </div>

              <div className="space-y-4 px-5 py-5">
                <form action={onCreate} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <input type="hidden" name="entity_type" value={activeSection.entityType} />
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_88px_88px_104px_auto] sm:items-center">
                    <input
                      name="value"
                      placeholder={activeSection.placeholder}
                      className="h-9 min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      required
                    />
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 sm:justify-center">
                      <input
                        type="checkbox"
                        name="is_visible"
                        defaultChecked
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Open
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 sm:justify-center">
                      <input
                        type="checkbox"
                        name="counts_as_completed"
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Closed
                    </label>
                    <input
                      name="color_hex"
                      placeholder="#64748b"
                      defaultValue="#64748b"
                      className="h-8 w-full rounded-md border border-slate-300 px-2 py-1 text-xs font-mono uppercase"
                    />
                    <button
                      type="submit"
                      className="h-9 rounded-md btn-primary px-3 py-2 text-sm font-semibold text-white"
                    >
                      Add status
                    </button>
                  </div>
                </form>

                <div className="hidden grid-cols-[minmax(0,1fr)_88px_88px_144px_auto] px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid">
                  <span>Status</span>
                  <span className="text-center">Open</span>
                  <span className="text-center">Closed</span>
                  <span className="text-right">Color</span>
                  <span className="text-right">Actions</span>
                </div>

                <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
                  {activeSection.rows.length ? (
                    activeSection.rows.map((status) => (
                      <StatusOptionAutoRow
                        key={`${activeSection.entityType}-${status.value}`}
                        entityType={activeSection.entityType}
                        id={status.id}
                        value={status.value}
                        position={status.position}
                        isVisible={status.isVisible}
                        countsAsCompleted={status.countsAsCompleted}
                        colorHex={status.colorHex}
                        isCore={isCoreStatus(activeSection.entityType, status.value)}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                      />
                    ))
                  ) : (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      No statuses yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
