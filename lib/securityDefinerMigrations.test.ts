import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function listSqlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return listSqlFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith(".sql") ? [fullPath] : [];
  });
}

describe("security-definer migrations", () => {
  it("pin search_path near every security definer declaration", () => {
    const migrationsDir = join(process.cwd(), "supabase", "migrations");
    const sqlFiles = listSqlFiles(migrationsDir);
    const declarations: string[] = [];
    const missingSearchPath: string[] = [];

    sqlFiles.forEach((filePath) => {
      const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!/^\s*security\s+definer\b/i.test(line)) {
          return;
        }

        const label = `${filePath.replace(process.cwd(), ".")}:${index + 1}`;
        declarations.push(label);
        const nearbyClause = lines.slice(index, index + 8).join("\n");
        if (!/\bset\s+search_path\s*=/i.test(nearbyClause)) {
          missingSearchPath.push(label);
        }
      });
    });

    expect(declarations.length).toBeGreaterThan(0);
    expect(missingSearchPath).toEqual([]);
  });
});
