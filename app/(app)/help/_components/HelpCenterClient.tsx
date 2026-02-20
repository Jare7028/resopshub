"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  HELP_QUICKSTART,
  getHelpGuideSearchText,
  type HelpGuide,
} from "../_data/guides";

function includesQuery(guide: HelpGuide, query: string) {
  if (!query) {
    return true;
  }
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const haystack = getHelpGuideSearchText(guide);

  return haystack.includes(normalizedQuery);
}

function displayValue(value: string, fallback: string) {
  const trimmed = String(value || "").trim();
  return trimmed || fallback;
}

export default function HelpCenterClient({ guides }: { guides: HelpGuide[] }) {
  const [query, setQuery] = useState("");

  const filteredGuides = useMemo(
    () => guides.filter((guide) => includesQuery(guide, query)),
    [guides, query]
  );

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Help Center
          </p>
          <h1 className="text-3xl font-semibold text-slate-900">
            Help & Walkthrough
          </h1>
          <p className="max-w-3xl text-sm text-slate-600">
            Search guides, open detailed walkthrough pages, and follow step-by-step
            workflows for every major area of the app.
          </p>
        </div>

        <label className="block">
          <span className="sr-only">Search help guides</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search help guides (example: template tasks, repeatable tasks, forms, sharing)"
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          />
        </label>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          Quick Start (10-15 minutes)
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
          {HELP_QUICKSTART.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Section Guides</h2>
          <p className="text-xs text-slate-500">
            {filteredGuides.length} guide{filteredGuides.length === 1 ? "" : "s"} found
          </p>
        </div>

        {filteredGuides.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {filteredGuides.map((guide) => {
              const displayTitle = displayValue(guide.title, "Untitled guide");
              const summary = String(guide.summary || "").trim();
              const audience = String(guide.audience || "").trim();
              const estimatedTime = String(guide.estimatedTime || "").trim();
              const metadataParts: string[] = [];
              if (audience) {
                metadataParts.push(`Audience: ${audience}`);
              }
              if (estimatedTime) {
                metadataParts.push(`Time: ${estimatedTime}`);
              }

              return (
              <article
                key={guide.slug}
                className="rounded-lg border border-slate-200 bg-white p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-slate-900">
                      {displayTitle}
                    </h3>
                    {summary ? (
                      <p className="text-sm text-slate-600">{summary}</p>
                    ) : null}
                  </div>
                </div>

                {metadataParts.length ? (
                  <p className="mt-3 text-xs text-slate-500">
                    {metadataParts.join(" | ")}
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {guide.keywords.slice(0, 5).map((keyword) => (
                    <span
                      key={`${guide.slug}-${keyword}`}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>

                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Guide Includes
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {guide.sections.slice(0, 3).map((section) => (
                      <li key={`${guide.slug}-${section.id}`}>{section.title}</li>
                    ))}
                  </ul>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Link
                    href={`/help/${guide.slug}`}
                    className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Open Guide
                  </Link>
                  <Link
                    href={guide.appPath}
                    className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
                  >
                    Open App Section
                  </Link>
                </div>
              </article>
              );
            })}
          </div>
        ) : (
          <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            No guides matched your search. Try terms like{" "}
            <span className="font-semibold">templates</span>,{" "}
            <span className="font-semibold">repeatable tasks</span>,{" "}
            <span className="font-semibold">forms</span>, or{" "}
            <span className="font-semibold">sharing</span>.
          </p>
        )}
      </section>
    </div>
  );
}
