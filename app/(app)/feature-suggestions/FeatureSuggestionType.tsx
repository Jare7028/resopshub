"use client";

import { type ChangeEvent, useTransition } from "react";

type FeatureSuggestionTypeProps = {
  suggestionId: string;
  defaultType: string;
  typeOptions: readonly string[];
  onUpdate: (formData: FormData) => Promise<unknown> | void;
  disabled?: boolean;
};

export default function FeatureSuggestionType({
  suggestionId,
  defaultType,
  typeOptions,
  onUpdate,
  disabled = false,
}: FeatureSuggestionTypeProps) {
  const [, startTransition] = useTransition();

  const formatTypeLabel = (type: string) =>
    type
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
        name="type"
        defaultValue={defaultType}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
        disabled={disabled}
        onChange={handleChange}
      >
        {typeOptions.map((type) => (
          <option key={type} value={type}>
            {formatTypeLabel(type)}
          </option>
        ))}
      </select>
    </form>
  );
}
