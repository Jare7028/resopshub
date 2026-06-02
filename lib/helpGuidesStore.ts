import "server-only";

import {
  HELP_GUIDES,
  type HelpGuide,
  normalizeHelpGuide,
} from "@/app/(app)/help/_data/guides";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import { logError } from "@/lib/vercelLogger";

type HelpGuideOverrideRow = {
  slug: string;
  guide: unknown;
};

export type LoadedHelpGuide = HelpGuide & {
  storageSlug: string;
};

type LoadedHelpGuides = {
  guides: LoadedHelpGuide[];
  tableAvailable: boolean;
  overrideSlugs: Set<string>;
};

function mergeGuideOverrides(overridesByStorageSlug: Map<string, HelpGuide>) {
  const defaultByStorageSlug = new Map(HELP_GUIDES.map((guide) => [guide.slug, guide]));

  const mergedDefaults: LoadedHelpGuide[] = HELP_GUIDES.map((defaultGuide) => {
    const override = overridesByStorageSlug.get(defaultGuide.slug);
    if (!override) {
      return {
        ...defaultGuide,
        storageSlug: defaultGuide.slug,
      };
    }
    return {
      ...override,
      storageSlug: defaultGuide.slug,
    };
  });

  const customOnlyGuides: LoadedHelpGuide[] = Array.from(overridesByStorageSlug.entries())
    .filter(([storageSlug]) => !defaultByStorageSlug.has(storageSlug))
    .map(([storageSlug, guide]) => ({
      ...guide,
      storageSlug,
    }))
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
      logError("help.guides.load_failed", {
        message: error.message,
      });
    }
    return {
      guides: HELP_GUIDES.map((guide) => ({
        ...guide,
        storageSlug: guide.slug,
      })),
      tableAvailable: !isSupabaseMissingTableError(error),
      overrideSlugs: new Set<string>(),
    };
  }

  const overridesByStorageSlug = new Map<string, HelpGuide>();
  ((rowsRaw || []) as HelpGuideOverrideRow[]).forEach((row) => {
    const storageSlug = String(row.slug || "").trim();
    if (!storageSlug) return;
    const normalized = normalizeHelpGuide(row.guide);
    if (!normalized) return;
    overridesByStorageSlug.set(storageSlug, {
      ...normalized,
    });
  });

  return {
    guides: mergeGuideOverrides(overridesByStorageSlug),
    tableAvailable: true,
    overrideSlugs: new Set(overridesByStorageSlug.keys()),
  };
}

