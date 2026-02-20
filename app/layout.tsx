import type { Metadata } from "next";
import { Suspense } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import GlobalLoadingIndicator from "./GlobalLoadingIndicator";

export const metadata: Metadata = {
  title: "ResOpsHub",
  description: "Internal operations platform for clients, projects, and billing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen overflow-x-hidden bg-white text-slate-900">
        <Suspense fallback={null}>
          <GlobalLoadingIndicator />
        </Suspense>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
