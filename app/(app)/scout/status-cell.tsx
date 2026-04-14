"use client";

import { useEffect, useRef, useState } from "react";
import { updateScoutJobStatusAction } from "./actions";
import { type ScoutStatus } from "@/lib/scout";

type StatusCellProps = {
  jobId: string;
  status: ScoutStatus;
  ignoreReason?: string | null;
};

const STATUS_LABELS: Record<ScoutStatus, string> = {
  active: "Active",
  watchlist: "Watchlist",
  contacted: "Contacted",
  ignore: "Ignore",
};

const STATUS_STYLES: Record<ScoutStatus, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-800",
  watchlist: "border-amber-200 bg-amber-50 text-amber-800",
  contacted: "border-sky-200 bg-sky-50 text-sky-800",
  ignore: "border-rose-200 bg-rose-50 text-rose-800",
};

export function ScoutStatusCell({ jobId, status, ignoreReason }: StatusCellProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ignoreReasonRef = useRef<HTMLInputElement>(null);
  const [selectedStatus, setSelectedStatus] = useState<ScoutStatus>(status);
  const [draftReason, setDraftReason] = useState(ignoreReason ?? "");

  useEffect(() => {
    setSelectedStatus(status);
    setDraftReason(ignoreReason ?? "");
  }, [status, ignoreReason]);

  function submitStatus(nextStatus: ScoutStatus, reason?: string) {
    if (!formRef.current) return;
    if (selectRef.current) {
      selectRef.current.value = nextStatus;
    }
    if (ignoreReasonRef.current) {
      ignoreReasonRef.current.value = reason?.trim() || "";
    }
    setSelectedStatus(nextStatus);
    formRef.current.requestSubmit();
  }

  function handleStatusChange(nextStatus: ScoutStatus) {
    if (nextStatus === "ignore") {
      setSelectedStatus(nextStatus);
      dialogRef.current?.showModal();
      return;
    }
    setDraftReason("");
    submitStatus(nextStatus, "");
  }

  function handleCancel() {
    dialogRef.current?.close();
    setSelectedStatus(status);
    setDraftReason(ignoreReason ?? "");
    if (selectRef.current) {
      selectRef.current.value = status;
    }
  }

  function handleSaveIgnore() {
    const reason = draftReason.trim();
    if (!reason) return;
    dialogRef.current?.close();
    submitStatus("ignore", reason);
  }

  return (
    <>
      <form ref={formRef} action={updateScoutJobStatusAction}>
        <input name="jobId" type="hidden" value={jobId} />
        <input ref={ignoreReasonRef} name="ignoreReason" type="hidden" defaultValue={ignoreReason ?? ""} />
        <select
          ref={selectRef}
          name="status"
          defaultValue={status}
          aria-label="Scout status"
          onChange={(event) => handleStatusChange(event.target.value as ScoutStatus)}
          className={`min-w-[8.5rem] rounded-full border px-3 py-2 text-sm font-semibold outline-none transition ${STATUS_STYLES[selectedStatus]}`}
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </form>

      <dialog
        ref={dialogRef}
        className="w-full max-w-md rounded-3xl border border-zinc-200 p-0 shadow-2xl backdrop:bg-zinc-950/40"
      >
        <div className="space-y-4 p-6">
          <div>
            <h3 className="text-lg font-semibold text-zinc-950">Why are you ignoring this one?</h3>
            <p className="mt-1 text-sm text-zinc-500">Add a short reason, then I’ll move it to Ignore.</p>
          </div>

          <textarea
            value={draftReason}
            onChange={(event) => setDraftReason(event.target.value)}
            placeholder="Reason for ignoring"
            className="min-h-[120px] w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
            autoFocus
          />

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-2xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveIgnore}
              disabled={!draftReason.trim()}
              className="rounded-2xl bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              Save ignore reason
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
