"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

type ConfirmDeleteProps = {
  name: string;
  itemType: string;
  formAction?: (formData: FormData) => void;
  confirmLabel?: string;
  pendingLabel?: string;
  triggerLabel?: ReactNode;
};

export default function ConfirmDelete({
  name,
  itemType,
  formAction,
  confirmLabel = "Confirm delete",
  pendingLabel = "Deleting...",
  triggerLabel = "Delete",
}: ConfirmDeleteProps) {
  const { pending } = useFormStatus();
  const [confirming, setConfirming] = useState(false);
  const trimmedName = name.trim();
  const displayName = trimmedName || "this";

  if (!confirming) {
    return (
      <button
        type="button"
        className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => setConfirming(true)}
        disabled={pending}
      >
        {pending ? pendingLabel : triggerLabel}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-xs text-rose-700">
        Are you sure you want to delete{" "}
        <span className="inline-block max-w-[200px] truncate rounded bg-rose-50 px-1 font-semibold text-rose-800 align-bottom">
          {displayName}
        </span>{" "}
        {itemType}?
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          formAction={formAction}
          className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
        >
          {pending ? pendingLabel : confirmLabel}
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
