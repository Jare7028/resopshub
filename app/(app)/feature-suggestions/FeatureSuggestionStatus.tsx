"use client";

import { type ChangeEvent, useTransition } from "react";
import { statusSelectStyle } from "@/lib/statusColorStyles";

type FeatureSuggestionStatusOption = {
  value: string;
  isVisible?: boolean;
};

type FeatureSuggestionStatusProps = {
  suggestionId: string;
  defaultStatus: string;
  statusOptions: readonly FeatureSuggestionStatusOption[];
  statusColorMap?: Record<string, string>;
  onUpdate: (formData: FormData) => Promise<unknown> | void;
  disabled?: boolean;
};

export default function FeatureSuggestionStatus({
  suggestionId,
  defaultStatus,
  statusOptions,
  statusColorMap = {},
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

  const normalizedCurrentStatus = defaultStatus.trim().toLowerCase();
  const normalizedOptionValues = statusOptions.map((status) => status.value.toLowerCase());
  const normalizedCurrentExists = normalizedOptionValues.includes(normalizedCurrentStatus);

  const visibleStatusOptions = statusOptions.filter((status) => status.isVisible !== false);
  const includesCurrentStatus =
    normalizedCurrentExists &&
    visibleStatusOptions.some((status) => status.value.toLowerCase() === normalizedCurrentStatus);

  const options = includesCurrentStatus
    ? visibleStatusOptions
    : normalizedCurrentStatus
    ? [...visibleStatusOptions, { value: normalizedCurrentStatus }]
    : visibleStatusOptions;
  const statusColor =
    statusColorMap[normalizedCurrentStatus] ||
    statusColorMap[defaultStatus] ||
    "#64748b";

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
        style={statusSelectStyle(statusColor)}
        disabled={disabled}
        onChange={handleChange}
      >
        {options.map((status) => (
          <option key={status.value} value={status.value}>
            {formatStatusLabel(status.value)}
          </option>
        ))}
      </select>
    </form>
  );
}

