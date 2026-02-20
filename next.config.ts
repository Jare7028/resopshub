import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This repo lives in a larger workspace that also has a lockfile.
  // Explicitly set tracing root so Next.js doesn't infer the wrong directory.
  outputFileTracingRoot: process.cwd(),
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
