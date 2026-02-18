import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingFunctionError } from "@/lib/supabaseErrors";
import FormSubmissionBuilder from "@/app/(app)/forms/FormSubmissionBuilder";
import {
  buildFieldKey,
  doesFormFieldVisibilityMatch,
  ensureUniqueFormFieldKeys,
  formatFormLabel,
  normalizeFormFieldMetadata,
  normalizeFormFieldType,
  normalizeFormFieldVisibility,
  validateFormFieldValue,
  type FormField,
} from "@/app/(app)/forms/types";

type ShareAccessMode = "public" | "authenticated";

function normalizeShareAccessMode(value: unknown): ShareAccessMode {
  return String(value || "").trim().toLowerCase() === "authenticated"
    ? "authenticated"
    : "public";
}

function parseFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) return [];
  const fields = value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const key = buildFieldKey(String(row.key || ""), `field_${index + 1}`);
      if (!key) return null;
      const visibility = normalizeFormFieldVisibility(row);
      const metadata = normalizeFormFieldMetadata(row);
      return {
        id: String(row.id || `field_${index + 1}`),
        key,
        label: String(row.label || key),
        type: normalizeFormFieldType(String(row.type || "text")),
        required: Boolean(row.required),
        options: Array.isArray(row.options)
          ? row.options.map((entry) => String(entry || "").trim()).filter(Boolean)
          : [],
        placeholder: metadata.placeholder,
        helpText: metadata.helpText,
        minValue: metadata.minValue,
        maxValue: metadata.maxValue,
        pattern: metadata.pattern,
        conditionMode: visibility.conditionMode,
        conditions: visibility.conditions,
        condition: visibility.condition,
      } satisfies FormField;
    })
    .filter(Boolean) as FormField[];
  return ensureUniqueFormFieldKeys(fields);
}

function shouldIncludeField(field: FormField, values: Record<string, string>) {
  return doesFormFieldVisibilityMatch(field, values);
}

function toErrorMessage(error: unknown, fallback: string) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message || "")
      : "";
  return message || fallback;
}

function buildSharedFormDetailUrl(
  detailPath: string,
  extra?: { error?: string; success?: string }
) {
  const sp = new URLSearchParams();
  if (extra?.error) sp.set("error", extra.error);
  if (extra?.success) sp.set("success", extra.success);
  return sp.toString() ? `${detailPath}?${sp.toString()}` : detailPath;
}

export default async function SharedFormPage(props: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ error?: string; success?: string }>;
}) {
  const { token } = await props.params;
  const searchParams = await props.searchParams;
  const safeToken = decodeURIComponent(String(token || "")).trim();
  if (!safeToken) {
    notFound();
  }

  const supabase = createSupabaseServerClient();
  const detailPath = `/forms/share/${encodeURIComponent(safeToken)}`;

  const resolveResult = await supabase.rpc("resolve_form_share_link", {
    p_token: safeToken,
  });
  if (isSupabaseMissingFunctionError(resolveResult.error)) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-6 py-10">
        <h1 className="text-2xl font-semibold text-slate-900">Shared Forms Not Configured</h1>
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Run <code>sql/forms_share_links.sql</code> in Supabase SQL editor to enable shared form links.
        </p>
      </div>
    );
  }
  if (resolveResult.error) {
    notFound();
  }

  const resolvedRows = (resolveResult.data || []) as Array<{
    form_id: string;
    form_title: string;
    form_description: string | null;
    form_status: string | null;
    form_fields: unknown;
    access_mode: string | null;
  }>;
  const resolved = resolvedRows[0];
  if (!resolved?.form_id) {
    notFound();
  }

  const accessMode = normalizeShareAccessMode(resolved.access_mode);
  const { data: authData } = await supabase.auth.getUser();
  const isAuthenticated = Boolean(authData.user);

  if (accessMode === "authenticated" && !isAuthenticated) {
    redirect(`/login?return_to=${encodeURIComponent(detailPath)}`);
  }

  const formFields = parseFields(resolved.form_fields);

  async function submitSharedForm(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();

    const resolveResult = await supabase.rpc("resolve_form_share_link", {
      p_token: safeToken,
    });
    if (resolveResult.error) {
      redirect(
        buildSharedFormDetailUrl(detailPath, {
          error: toErrorMessage(resolveResult.error, "Invalid form link."),
        })
      );
    }
    const resolvedRows = (resolveResult.data || []) as Array<{
      form_id: string;
      form_fields: unknown;
      access_mode: string | null;
    }>;
    const resolved = resolvedRows[0];
    if (!resolved?.form_id) {
      redirect(buildSharedFormDetailUrl(detailPath, { error: "Invalid or inactive form link." }));
    }

    const accessMode = normalizeShareAccessMode(resolved.access_mode);
    const { data: authData } = await supabase.auth.getUser();
    if (accessMode === "authenticated" && !authData.user) {
      redirect(`/login?return_to=${encodeURIComponent(detailPath)}`);
    }

    const fields = parseFields(resolved.form_fields);
    const rawValues: Record<string, string> = {};
    fields.forEach((field) => {
      const key = `field_${field.key}`;
      if (field.type === "checkbox") {
        rawValues[field.key] = formData.get(key) ? "true" : "false";
      } else {
        rawValues[field.key] = String(formData.get(key) || "").trim();
      }
    });

    const visibleFields = fields.filter((field) => shouldIncludeField(field, rawValues));
    const values: Record<string, string> = {};
    for (const field of visibleFields) {
      const value = rawValues[field.key] || "";
      if (field.required && !value) {
        const fieldLabel = field.label || formatFormLabel(field.key);
        redirect(buildSharedFormDetailUrl(detailPath, { error: `Required field missing: ${fieldLabel}` }));
      }
      const validationError = validateFormFieldValue(field, value);
      if (validationError) {
        redirect(buildSharedFormDetailUrl(detailPath, { error: validationError }));
      }
      values[field.key] = value;
    }

    const submitResult = await supabase.rpc("create_form_submission_via_share_link", {
      p_token: safeToken,
      p_values_json: values,
    });
    if (submitResult.error) {
      redirect(
        buildSharedFormDetailUrl(detailPath, {
          error: toErrorMessage(submitResult.error, "Failed to submit form."),
        })
      );
    }

    redirect(buildSharedFormDetailUrl(detailPath, { success: "Submission received." }));
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Shared form
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">{resolved.form_title}</h1>
        {resolved.form_description ? (
          <p className="text-sm text-slate-600">{resolved.form_description}</p>
        ) : null}
        <p
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
            accessMode === "authenticated"
              ? "bg-slate-100 text-slate-700"
              : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {accessMode === "authenticated" ? "Login required" : "Public link"}
        </p>
      </header>

      {(searchParams?.error || searchParams?.success) && (
        <div className="space-y-2">
          {searchParams?.error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {searchParams.error}
            </p>
          ) : null}
          {searchParams?.success ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              {searchParams.success}
            </p>
          ) : null}
        </div>
      )}

      {accessMode === "authenticated" && !isAuthenticated ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          You need to sign in before submitting this form.
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Submit response</h2>
        </div>
        <form action={submitSharedForm} className="space-y-4 px-6 py-4">
          <FormSubmissionBuilder fields={formFields} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Submit form
            </button>
            <Link
              href="/login"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
            >
              App login
            </Link>
          </div>
        </form>
      </section>
    </div>
  );
}
