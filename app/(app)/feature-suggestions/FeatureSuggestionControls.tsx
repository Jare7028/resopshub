"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type FeatureSuggestionControlsProps = {
  hideCompleted: boolean;
  selectedSort: "latest" | "most_upvoted";
};

export default function FeatureSuggestionControls({
  hideCompleted,
  selectedSort,
}: FeatureSuggestionControlsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const params = useMemo(() => {
    const next = new URLSearchParams(searchParams?.toString());
    if (!hideCompleted) {
      next.delete("hide");
    }
    if (selectedSort === "latest") {
      next.delete("sort");
    }
    return next;
  }, [hideCompleted, selectedSort, searchParams]);

  const updateParams = (nextHide: boolean, nextSort: string) => {
    const next = new URLSearchParams(params.toString());
    if (nextHide) {
      next.set("hide", "1");
    } else {
      next.delete("hide");
    }
    if (nextSort && nextSort !== "latest") {
      next.set("sort", nextSort);
    } else {
      next.delete("sort");
    }
    const query = next.toString();
    router.push(query ? `/feature-suggestions?${query}` : "/feature-suggestions");
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-2 text-slate-600">
        <input
          type="checkbox"
          checked={hideCompleted}
          onChange={(event) => updateParams(event.target.checked, selectedSort)}
        />
        Hide completed suggestions
      </label>
      <select
        value={selectedSort}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
        onChange={(event) => updateParams(hideCompleted, event.target.value)}
      >
        <option value="latest">Latest</option>
        <option value="most_upvoted">Most upvoted</option>
      </select>
    </div>
  );
}
