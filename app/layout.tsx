import type { Metadata } from "next";
import "./globals.css";

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
        {children}
      </body>
    </html>
  );
}
