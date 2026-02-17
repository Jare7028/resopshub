"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type FormShareLink = {
  id: string;
  token: string;
  access_mode: "public" | "authenticated";
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
};

type SaveResult = {
  ok: boolean;
  error?: string;
};

function normalizeBaseUrl(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const withoutTrailingSlash = normalized.replace(/\/+$/, "");
  if (
    withoutTrailingSlash.startsWith("http://") ||
    withoutTrailingSlash.startsWith("https://")
  ) {
    return withoutTrailingSlash;
  }
  return `https://${withoutTrailingSlash}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export default function FormShareLinksPopover({
  appBaseUrl,
  links,
  schemaMissing,
  loadErrorMessage,
  onCreateLink,
  onToggleLink,
}: {
  appBaseUrl: string;
  links: FormShareLink[];
  schemaMissing: boolean;
  loadErrorMessage: string | null;
  onCreateLink: (formData: FormData) => Promise<SaveResult>;
  onToggleLink: (formData: FormData) => Promise<SaveResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const shareBaseUrl = useMemo(() => normalizeBaseUrl(appBaseUrl), [appBaseUrl]);

  const buildShareUrl = (token: string) => {
    const path = `/forms/share/${encodeURIComponent(token)}`;
    return shareBaseUrl ? `${shareBaseUrl}${path}` : path;
  };

  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setErrorMessage("");
      setSuccessMessage("Link copied");
    } catch {
      setErrorMessage("Could not copy link. Please copy it manually.");
    }
  };

  const createLink = async (mode: "public" | "authenticated") => {
    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const formData = new FormData();
      formData.set("access_mode", mode);
      const result = await onCreateLink(formData);
      if (!result?.ok) {
        setErrorMessage(result?.error || "Failed to create link.");
        return;
      }
      setSuccessMessage(
        mode === "public"
          ? "Public link created."
          : "Login-required link created."
      );
      router.refresh();
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String(error.message || "")
          : "";
      setErrorMessage(message || "Failed to create link.");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleLink = async (linkId: string, nextActive: boolean) => {
    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const formData = new FormData();
      formData.set("link_id", linkId);
      formData.set("next_is_active", nextActive ? "true" : "false");
      const result = await onToggleLink(formData);
      if (!result?.ok) {
        setErrorMessage(result?.error || "Failed to update link.");
        return;
      }
      setSuccessMessage(nextActive ? "Link activated." : "Link deactivated.");
      router.refresh();
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String(error.message || "")
          : "";
      setErrorMessage(message || "Failed to update link.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setErrorMessage("");
          setSuccessMessage("");
          setOpen(true);
        }}
        className="rounded-md border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
      >
        Share links
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close form share links"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => {
              if (isSaving) return;
              setOpen(false);
            }}
          />
          <section className="relative z-10 w-full max-w-5xl rounded-xl border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Form Share Links</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Create links for public submissions or links that require app login.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isSaving) return;
                  setOpen(false);
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                disabled={isSaving}
              >
                Close
              </button>
            </header>

            <div className="space-y-4 px-5 py-4">
              {schemaMissing ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                  Form share links are not set up yet. Run <code>sql/forms_share_links.sql</code> in
                  Supabase SQL editor.
                </p>
              ) : null}
              {loadErrorMessage ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                  {loadErrorMessage}
                </p>
              ) : null}
              {errorMessage ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  {errorMessage}
                </p>
              ) : null}
              {successMessage ? (
                <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
                  {successMessage}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void createLink("public")}
                  disabled={isSaving || schemaMissing}
                  className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Create Public Link
                </button>
                <button
                  type="button"
                  onClick={() => void createLink("authenticated")}
                  disabled={isSaving || schemaMissing}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Create Login-Required Link
                </button>
              </div>

              {links.length ? (
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Link</th>
                        <th className="px-3 py-2">Created</th>
                        <th className="px-3 py-2">Last used</th>
                        <th className="px-3 py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {links.map((link) => {
                        const linkUrl = buildShareUrl(link.token);
                        return (
                          <tr key={link.id}>
                            <td className="px-3 py-2">
                              {link.access_mode === "authenticated"
                                ? "Login required"
                                : "Public"}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                  link.is_active
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {link.is_active ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex min-w-[420px] items-center gap-2">
                                <input
                                  type="text"
                                  readOnly
                                  value={linkUrl}
                                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-700"
                                />
                                <button
                                  type="button"
                                  onClick={() => void copyToClipboard(linkUrl)}
                                  className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400"
                                >
                                  Copy
                                </button>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-600">
                              {formatDateTime(link.created_at)}
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-600">
                              {formatDateTime(link.last_used_at)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => void toggleLink(link.id, !link.is_active)}
                                disabled={isSaving}
                                className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {link.is_active ? "Deactivate" : "Activate"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
                  No share links yet.
                </p>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
