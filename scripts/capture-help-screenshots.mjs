#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_OUTPUT_DIR = "docs/help/screenshots";

const DEFAULT_ROUTES = [
  { name: "dashboard", path: "/dashboard" },
  { name: "clients", path: "/clients" },
  { name: "projects", path: "/projects" },
  { name: "tasks", path: "/tasks" },
  { name: "forms", path: "/forms" },
  { name: "chat", path: "/chat" },
  { name: "personal", path: "/personal" },
  { name: "notes", path: "/notes" },
  { name: "feature-suggestions", path: "/feature-suggestions" },
  { name: "search", path: "/search" },
  { name: "settings", path: "/settings" },
];

function printUsage() {
  console.log(`
Capture help screenshots for ResOpsHub.

Usage:
  node scripts/capture-help-screenshots.mjs [options]

Options:
  --base-url <url>         App base URL (default: ${DEFAULT_BASE_URL})
  --out <dir>              Output directory (default: ${DEFAULT_OUTPUT_DIR})
  --storage-state <file>   Playwright storage state JSON (recommended)
  --full-page              Capture full-page screenshots
  --route <name>=<path>    Add extra route (repeatable)
  --only-extra-routes      Skip defaults and capture only --route entries
  --help                   Show this help

Examples:
  node scripts/capture-help-screenshots.mjs --storage-state .tmp/help-auth.json
  node scripts/capture-help-screenshots.mjs --route client-overview=/clients/CLIENT_ID
  node scripts/capture-help-screenshots.mjs --only-extra-routes --route form-detail=/forms/FORM_ID
`.trim());
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function parseRouteOption(raw) {
  const value = String(raw || "").trim();
  const splitIndex = value.indexOf("=");
  if (splitIndex <= 0 || splitIndex === value.length - 1) {
    throw new Error(`Invalid --route value "${raw}". Expected <name>=<path>.`);
  }
  const name = value.slice(0, splitIndex).trim();
  const routePath = value.slice(splitIndex + 1).trim();
  if (!routePath.startsWith("/")) {
    throw new Error(`Invalid route path "${routePath}". Route paths must start with "/".`);
  }
  return { name, path: routePath };
}

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    outDir: DEFAULT_OUTPUT_DIR,
    storageState: "",
    fullPage: false,
    onlyExtraRoutes: false,
    extraRoutes: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--full-page") {
      options.fullPage = true;
      continue;
    }
    if (arg === "--only-extra-routes") {
      options.onlyExtraRoutes = true;
      continue;
    }
    if (arg === "--base-url") {
      options.baseUrl = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg === "--out") {
      options.outDir = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg === "--storage-state") {
      options.storageState = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg === "--route") {
      options.extraRoutes.push(parseRouteOption(argv[i + 1]));
      i += 1;
      continue;
    }
    if (arg.startsWith("--base-url=")) {
      options.baseUrl = arg.slice("--base-url=".length).trim();
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.outDir = arg.slice("--out=".length).trim();
      continue;
    }
    if (arg.startsWith("--storage-state=")) {
      options.storageState = arg.slice("--storage-state=".length).trim();
      continue;
    }
    if (arg.startsWith("--route=")) {
      options.extraRoutes.push(parseRouteOption(arg.slice("--route=".length)));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.baseUrl) {
    throw new Error("Missing --base-url value.");
  }
  if (!options.outDir) {
    throw new Error("Missing --out value.");
  }

  return options;
}

function buildRouteList(options) {
  const base = options.onlyExtraRoutes ? [] : DEFAULT_ROUTES;
  const merged = [...base, ...options.extraRoutes];
  const deduped = [];
  const seen = new Set();
  merged.forEach((route) => {
    const key = `${route.name}:${route.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(route);
    }
  });
  return deduped;
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: `${stderr}\n${String(error)}` });
    });
  });
}

async function captureScreenshots() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const routes = buildRouteList(args);
  if (!routes.length) {
    throw new Error("No routes to capture. Add --route entries or remove --only-extra-routes.");
  }

  await fs.mkdir(args.outDir, { recursive: true });

  console.log(`Capturing ${routes.length} route(s) from ${args.baseUrl}`);
  if (!args.storageState) {
    console.log(
      "No --storage-state provided. Protected routes may capture the login screen."
    );
  }

  const results = [];

  for (let i = 0; i < routes.length; i += 1) {
    const route = routes[i];
    const index = String(i + 1).padStart(2, "0");
    const fileName = `${index}-${slugify(route.name)}.png`;
    const outputPath = path.resolve(args.outDir, fileName);
    const url = new URL(route.path, args.baseUrl).toString();

    process.stdout.write(`[${index}/${String(routes.length).padStart(2, "0")}] ${route.path} ... `);

    try {
      const cliArgs = [
        "playwright",
        "screenshot",
        "--browser",
        "chromium",
        "--viewport-size",
        `${DEFAULT_VIEWPORT.width},${DEFAULT_VIEWPORT.height}`,
        "--wait-for-timeout",
        "750",
      ];
      if (args.storageState) {
        cliArgs.push("--load-storage", args.storageState);
      }
      if (args.fullPage) {
        cliArgs.push("--full-page");
      }
      cliArgs.push(url, outputPath);

      const result = await runCommand("npx", cliArgs);
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || "playwright screenshot failed");
      }

      results.push({ route: route.path, file: outputPath, ok: true });
      console.log("ok");
    } catch (error) {
      results.push({
        route: route.path,
        file: outputPath,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      console.log("failed");
    }
  }

  const failures = results.filter((result) => !result.ok);
  const successes = results.filter((result) => result.ok);

  console.log(`\nCaptured ${successes.length}/${results.length} screenshots.`);
  successes.forEach((result) => {
    console.log(`  ok  ${result.route} -> ${result.file}`);
  });

  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((result) => {
      console.log(`  err ${result.route} -> ${result.error}`);
    });
    process.exitCode = 1;
  }
}

captureScreenshots().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
