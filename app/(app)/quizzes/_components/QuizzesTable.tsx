"use client";

import { useRouter } from "next/navigation";
import { type KeyboardEvent } from "react";

type QuizTableRowStatus = "draft" | "published" | "archived";

type QuizTableRow = {
  id: string;
  title: string;
  status: QuizTableRowStatus;
  passingScorePercent: number;
  maxAttempts: number;
  publishedAt: string | null;
  versions: number;
  questions: number;
  submissions: number;
  openHref: string;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function quizStatusBadgeClass(status: QuizTableRowStatus) {
  if (status === "published") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "draft") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export default function QuizzesTable({
  rows,
}: {
  rows: QuizTableRow[];
}) {
  const router = useRouter();

  const openRow = (href: string) => {
    router.push(href);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    href: string
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openRow(href);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2">Quiz</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Versions</th>
            <th className="px-3 py-2">Questions</th>
            <th className="px-3 py-2">Submissions</th>
            <th className="px-3 py-2">Published</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {rows.length ? (
            rows.map((row) => (
              <tr
                key={row.id}
                role="button"
                tabIndex={0}
                className="border-t border-slate-200 cursor-pointer hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
                onClick={() => openRow(row.openHref)}
                onKeyDown={(event) => handleKeyDown(event, row.openHref)}
              >
                <td className="px-3 py-2">
                  <p className="font-medium text-slate-900">{row.title}</p>
                  <p className="text-xs text-slate-500">
                    Pass {row.passingScorePercent}% - Max attempts {row.maxAttempts}
                  </p>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${quizStatusBadgeClass(row.status)}`}
                  >
                    {row.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-700">{row.versions}</td>
                <td className="px-3 py-2 text-slate-700">{row.questions}</td>
                <td className="px-3 py-2 text-slate-700">{row.submissions}</td>
                <td className="px-3 py-2 text-slate-700">{formatDateTime(row.publishedAt)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-3 py-6 text-sm text-slate-500" colSpan={6}>
                No quizzes found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
