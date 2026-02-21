import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
let supabaseStoragePattern:
  | {
      protocol: "http" | "https";
      hostname: string;
      pathname: string;
    }
  | undefined;

try {
  const parsed = new URL(supabaseUrl);
  supabaseStoragePattern = {
    protocol: parsed.protocol === "http:" ? "http" : "https",
    hostname: parsed.hostname,
    pathname: "/storage/v1/object/public/**",
  };
} catch {
  supabaseStoragePattern = undefined;
}

const nextConfig: NextConfig = {
  // This repo lives in a larger workspace that also has a lockfile.
  // Explicitly set tracing root so Next.js doesn't infer the wrong directory.
  outputFileTracingRoot: process.cwd(),
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  images: supabaseStoragePattern
    ? {
        remotePatterns: [supabaseStoragePattern],
      }
    : undefined,
};

export default nextConfig;
