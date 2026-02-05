"use client";

type FeatureSuggestionStatusProps = {
  suggestionId: string;
  defaultStatus: string;
  statusOptions: readonly string[];
  onUpdate: (formData: FormData) => void;
};

export default function FeatureSuggestionStatus({
  suggestionId,
  defaultStatus,
  statusOptions,
  onUpdate,
}: FeatureSuggestionStatusProps) {
  return (
    <form action={onUpdate} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="suggestion_id" value={suggestionId} />
      <select
        name="status"
        defaultValue={defaultStatus}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {statusOptions.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
    </form>
  );
}
