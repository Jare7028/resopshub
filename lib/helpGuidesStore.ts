import "server-only";

import {
  HELP_GUIDES,
  type HelpGuide,
  normalizeHelpGuide,
} from "@/app/(app)/help/_data/guides";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";

type HelpGuideOverrideRow = {
  slug: string;
  guide: unknown;
};

type LoadedHelpGuides = {
  guides: HelpGuide[];
  tableAvailable: boolean;
  overrideSlugs: Set<string>;
};

function mergeGuideOverrides(overrides: Map<string, HelpGuide>) {
  const defaultBySlug = new Map(HELP_GUIDES.map((guide) => [guide.slug, guide]));
  const mergedDefaults = HELP_GUIDES.map(
    (defaultGuide) => overrides.get(defaultGuide.slug) || defaultGuide
  );
  const customOnlyGuides = Array.from(overrides.values())
    .filter((guide) => !defaultBySlug.has(guide.slug))
    .sort((left, right) => left.title.localeCompare(right.title));
  return [...mergedDefaults, ...customOnlyGuides];
}

export async function loadHelpGuides(): Promise<LoadedHelpGuides> {
  const supabase = createSupabaseServerClient();
  const { data: rowsRaw, error } = await supabase
    .from("help_guides")
    .select("slug,guide");

  if (error) {
    if (!isSupabaseMissingTableError(error)) {
      console.error("[help.guides.load]", error.message);
    }
    return {
      guides: HELP_GUIDES,
      tableAvailable: !isSupabaseMissingTableError(error),
      overrideSlugs: new Set<string>(),
    };
  }

  const overrides = new Map<string, HelpGuide>();
  ((rowsRaw || []) as HelpGuideOverrideRow[]).forEach((row) => {
    const slug = String(row.slug || "").trim();
    if (!slug) return;
    const normalized = normalizeHelpGuide(row.guide);
    if (!normalized) return;
    overrides.set(slug, {
      ...normalized,
      slug,
    });
  });

  return {
    guides: mergeGuideOverrides(overrides),
    tableAvailable: true,
    overrideSlugs: new Set(overrides.keys()),
  };
}

