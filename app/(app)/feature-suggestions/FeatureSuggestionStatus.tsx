"use client";

import { type ChangeEvent, useTransition } from "react";

type FeatureSuggestionStatusProps = {
  suggestionId: string;
  defaultStatus: string;
  statusOptions: readonly string[];
  onUpdate: (formData: FormData) => Promise<unknown> | void;
  disabled?: boolean;
};

export default function FeatureSuggestionStatus({
  suggestionId,
  defaultStatus,
  statusOptions,
  onUpdate,
  disabled = false,
}: FeatureSuggestionStatusProps) {
  const [, startTransition] = useTransition();

  const formatStatusLabel = (status: string) =>
    status
      .split("_")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const form = event.currentTarget.form;
    if (!form) return;
    const formData = new FormData(form);
    startTransition(() => {
      void onUpdate(formData);
    });
  };

  return (
    <form className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="suggestion_id" value={suggestionId} />
      <select
        name="status"
        defaultValue={defaultStatus}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
        disabled={disabled}
        onChange={handleChange}
      >
        {statusOptions.map((status) => (
          <option key={status} value={status}>
            {formatStatusLabel(status)}
          </option>
        ))}
      </select>
    </form>
  );
}

