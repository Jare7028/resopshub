import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingColumnError, isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import {
  buildEmployeeInfoExchangeRateMap,
  columnIndexToLetter,
  convertEmployeeInfoCurrencyAmount,
  evaluateEmployeeFormula,
  formatEmployeeInfoCurrencyAmount,
  normalizeEmployeeInfoCurrencyCode,
  normalizeEmployeeInfoFormulaCurrencyMode,
  parseEmployeeInfoCurrencyCodeFromOptions,
  toEmployeeInfoColumnKey,
  toFormulaNumber,
  type EmployeeInfoCurrencyCode,
  type EmployeeInfoExchangeRateRow,
} from "@/lib/employeeInfo";

const statusOptions = ["pending", "approved", "paid", "void"] as const;

type EmployeeInfoRecordRow = {
  id: string;
  full_name: string;
  client_id: string | null;
};

type EmployeeInfoColumnRow = {
  id: string;
  key: string;
  label: string;
  column_kind: "text" | "dropdown" | "formula" | "number" | "date" | "currency";
  formula: string | null;
  formula_currency_mode: "display" | "fixed";
  formula_currency_code: "USD" | "GBP" | "MUR";
  options_json: unknown;
  position: number;
};

type EmployeeInfoValueRow = {
  record_id: string;
  column_id: string;
  text_value: string | null;
  option_value: string | null;
  money_currency_code: string | null;
};

type EmployeeMonthlyCostSummary = {
  amount: number;
  currencyCode: EmployeeInfoCurrencyCode;
  clientRowCount: number;
  contributingRowCount: number;
  isConfigured: boolean;
  hasMissingExchangeRate: boolean;
  errorMessage: string | null;
};

function buildEmployeeInfoValueMap(
  rows: EmployeeInfoValueRow[]
): Record<
  string,
  Record<string, { text_value: string | null; option_value: string | null; money_currency_code: string | null }>
> {
  return rows.reduce<
    Record<
      string,
      Record<string, { text_value: string | null; option_value: string | null; money_currency_code: string | null }>
    >
  >((acc, row) => {
    if (!acc[row.record_id]) acc[row.record_id] = {};
    acc[row.record_id][row.column_id] = {
      text_value: row.text_value,
      option_value: row.option_value,
      money_currency_code: row.money_currency_code,
    };
    return acc;
  }, {});
}

function isTotalMonthlyCostColumn(column: EmployeeInfoColumnRow) {
  const expectedKey = "total_monthly_cost";
  return (
    toEmployeeInfoColumnKey(column.key) === expectedKey ||
    toEmployeeInfoColumnKey(column.label) === expectedKey
  );
}

function parseNumericCellValue(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .replace(/,/g, "");
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

export default async function ClientBillingPage(props: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{ error?: string; success?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const clientId = params.clientId;
  const supabase = createSupabaseServerClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id,name")
    .eq("id", clientId)
    .single();

  if (!client) {
    notFound();
  }

  const { data: billingProfile } = await supabase
    .from("billing_profiles")
    .select("id,display_name,billing_address,currency,tax_id,payment_terms,default_rate")
    .eq("client_id", clientId)
    .maybeSingle();
  const billingCurrencyCode = normalizeEmployeeInfoCurrencyCode(billingProfile?.currency || "USD");
  const employeeMonthlyCostSummary: EmployeeMonthlyCostSummary = {
    amount: 0,
    currencyCode: billingCurrencyCode,
    clientRowCount: 0,
    contributingRowCount: 0,
    isConfigured: false,
    hasMissingExchangeRate: false,
    errorMessage: null,
  };

  const { data: employeeRecordsRaw, error: employeeRecordsError } = await supabase
    .from("employee_info_records")
    .select("id,full_name,client_id")
    .eq("client_id", clientId);

  if (isSupabaseMissingTableError(employeeRecordsError)) {
    employeeMonthlyCostSummary.errorMessage = "Employee Info is not set up yet.";
  } else if (employeeRecordsError) {
    employeeMonthlyCostSummary.errorMessage = `Could not load Employee Info rows (${employeeRecordsError.message}).`;
  } else {
    let { data: employeeColumnsRaw, error: employeeColumnsError } = await supabase
      .from("employee_info_columns")
      .select(
        "id,key,label,column_kind,formula,formula_currency_mode,formula_currency_code,options_json,position"
      )
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });

    if (isSupabaseMissingColumnError(employeeColumnsError)) {
      const fallbackColumns = await supabase
        .from("employee_info_columns")
        .select("id,key,label,column_kind,formula,options_json,position")
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      employeeColumnsError = fallbackColumns.error;
      employeeColumnsRaw = (fallbackColumns.data || []).map((column) => ({
        ...column,
        formula_currency_mode: "display",
        formula_currency_code: "USD",
      }));
    }

    if (isSupabaseMissingTableError(employeeColumnsError)) {
      employeeMonthlyCostSummary.errorMessage = "Employee Info is not set up yet.";
    } else if (employeeColumnsError) {
      employeeMonthlyCostSummary.errorMessage = `Could not load Employee Info columns (${employeeColumnsError.message}).`;
    } else {
      const employeeRecords = (employeeRecordsRaw || []) as EmployeeInfoRecordRow[];
      const employeeColumns = (employeeColumnsRaw || []) as EmployeeInfoColumnRow[];
      const monthlyCostColumn = employeeColumns.find(isTotalMonthlyCostColumn);

      if (monthlyCostColumn) {
        employeeMonthlyCostSummary.isConfigured = true;
        employeeMonthlyCostSummary.clientRowCount = employeeRecords.length;

        const employeeRecordIds = employeeRecords.map((row) => row.id).filter(Boolean);
        let employeeValuesRaw: EmployeeInfoValueRow[] = [];
        let employeeValuesError: { message?: string; code?: string } | null = null;
        if (employeeRecordIds.length) {
          const employeeValuesResult = await supabase
            .from("employee_info_values")
            .select("record_id,column_id,text_value,option_value,money_currency_code")
            .in("record_id", employeeRecordIds);
          employeeValuesRaw = (employeeValuesResult.data || []) as EmployeeInfoValueRow[];
          employeeValuesError = employeeValuesResult.error;

          if (isSupabaseMissingColumnError(employeeValuesError)) {
            const fallbackValuesResult = await supabase
              .from("employee_info_values")
              .select("record_id,column_id,text_value,option_value")
              .in("record_id", employeeRecordIds);
            employeeValuesError = fallbackValuesResult.error;
            employeeValuesRaw = ((fallbackValuesResult.data || []) as Array<
              Omit<EmployeeInfoValueRow, "money_currency_code">
            >).map((row) => ({
              ...row,
              money_currency_code: null,
            }));
          }
        }

        if (employeeValuesError && !isSupabaseMissingTableError(employeeValuesError)) {
          employeeMonthlyCostSummary.errorMessage = `Could not load Employee Info values (${employeeValuesError.message}).`;
        } else {
          const employeeValueRows = (
            isSupabaseMissingTableError(employeeValuesError) ? [] : employeeValuesRaw || []
          ) as EmployeeInfoValueRow[];
          const valuesByRecordId = buildEmployeeInfoValueMap(employeeValueRows);

          const { data: exchangeRateRowsRaw, error: exchangeRateError } = await supabase
            .from("employee_info_exchange_rates")
            .select("base_currency_code,quote_currency_code,rate,effective_month_start")
            .order("effective_month_start", { ascending: false });

          if (exchangeRateError && !isSupabaseMissingTableError(exchangeRateError)) {
            employeeMonthlyCostSummary.errorMessage = `Could not load Employee Info exchange rates (${exchangeRateError.message}).`;
          } else {
            const exchangeRateRows = (
              isSupabaseMissingTableError(exchangeRateError) ? [] : exchangeRateRowsRaw || []
            ) as EmployeeInfoExchangeRateRow[];
            const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
            const exchangeRateMap = buildEmployeeInfoExchangeRateMap(exchangeRateRows, monthStart);

            const namedReferenceToDisplayIndex: Record<string, number> = {};
            const registerReference = (token: string, displayIndex: number) => {
              const cleaned = String(token || "").trim().toLowerCase();
              if (!cleaned) return;
              if (namedReferenceToDisplayIndex[cleaned] !== undefined) return;
              namedReferenceToDisplayIndex[cleaned] = displayIndex;
            };

            registerReference("A", 0);
            registerReference("full_name", 0);
            registerReference("fullname", 0);
            registerReference("B", 1);
            registerReference("client", 1);
            employeeColumns.forEach((column, index) => {
              const displayIndex = index + 2;
              registerReference(column.key, displayIndex);
              registerReference(toEmployeeInfoColumnKey(column.label), displayIndex);
              registerReference(columnIndexToLetter(displayIndex), displayIndex);
            });

            const resolveFormulaTargetCurrencyCode = (column: EmployeeInfoColumnRow) => {
              const formulaMode = normalizeEmployeeInfoFormulaCurrencyMode(
                column.formula_currency_mode
              );
              if (formulaMode === "fixed") {
                return normalizeEmployeeInfoCurrencyCode(column.formula_currency_code);
              }
              return billingCurrencyCode;
            };

            const monthlyCostDisplayIndex =
              employeeColumns.findIndex((column) => column.id === monthlyCostColumn.id) + 2;

            employeeRecords.forEach((record) => {
              const valuesByColumnId = valuesByRecordId[record.id] || {};

              const resolveDisplayIndexValue = (
                displayIndex: number,
                visiting: Set<number>,
                targetCurrencyCode: EmployeeInfoCurrencyCode,
                onMissingExchangeRate: () => void,
                onCurrencyOperand: () => void
              ): unknown => {
                if (displayIndex === 0) return record.full_name;
                if (displayIndex === 1) return record.client_id === client.id ? client.name : "";

                const dynamicIndex = displayIndex - 2;
                if (dynamicIndex < 0 || dynamicIndex >= employeeColumns.length) return "";
                const dynamicColumn = employeeColumns[dynamicIndex];

                if (dynamicColumn.column_kind === "formula") {
                  if (visiting.has(displayIndex)) return 0;
                  visiting.add(displayIndex);
                  const nestedValue = evaluateEmployeeFormula(
                    dynamicColumn.formula,
                    (refIndex) =>
                      resolveDisplayIndexValue(
                        refIndex,
                        new Set(visiting),
                        targetCurrencyCode,
                        onMissingExchangeRate,
                        onCurrencyOperand
                      ),
                    (reference) =>
                      resolveNamedReferenceValue(
                        reference,
                        new Set(visiting),
                        targetCurrencyCode,
                        onMissingExchangeRate,
                        onCurrencyOperand
                      )
                  );
                  visiting.delete(displayIndex);
                  return nestedValue ?? 0;
                }

                const cellValue = valuesByColumnId[dynamicColumn.id];
                if (!cellValue) return "";
                if (dynamicColumn.column_kind === "dropdown") return cellValue.option_value || "";

                if (dynamicColumn.column_kind === "currency") {
                  onCurrencyOperand();
                  const sourceAmount = Number(cellValue.text_value);
                  if (!Number.isFinite(sourceAmount)) return 0;
                  const sourceCurrencyCode = normalizeEmployeeInfoCurrencyCode(
                    cellValue.money_currency_code ||
                      parseEmployeeInfoCurrencyCodeFromOptions(dynamicColumn.options_json)
                  );
                  const convertedAmount = convertEmployeeInfoCurrencyAmount({
                    amount: sourceAmount,
                    fromCurrencyCode: sourceCurrencyCode,
                    toCurrencyCode: targetCurrencyCode,
                    exchangeRateMap,
                  });
                  if (convertedAmount === null) {
                    onMissingExchangeRate();
                    return 0;
                  }
                  return convertedAmount;
                }

                return cellValue.text_value || "";
              };

              const resolveNamedReferenceValue = (
                reference: string,
                visiting: Set<number>,
                targetCurrencyCode: EmployeeInfoCurrencyCode,
                onMissingExchangeRate: () => void,
                onCurrencyOperand: () => void
              ) => {
                const displayIndex =
                  namedReferenceToDisplayIndex[String(reference || "").trim().toLowerCase()];
                if (displayIndex === undefined) return undefined;
                return resolveDisplayIndexValue(
                  displayIndex,
                  visiting,
                  targetCurrencyCode,
                  onMissingExchangeRate,
                  onCurrencyOperand
                );
              };

              let amountToAdd: number | null = null;
              if (monthlyCostColumn.column_kind === "formula") {
                const formulaTargetCurrencyCode = resolveFormulaTargetCurrencyCode(monthlyCostColumn);
                let hasMissingExchangeRate = false;
                let hasCurrencyOperand = false;
                const evaluated = evaluateEmployeeFormula(
                  monthlyCostColumn.formula,
                  (refIndex) =>
                    resolveDisplayIndexValue(
                      refIndex,
                      new Set([monthlyCostDisplayIndex]),
                      formulaTargetCurrencyCode,
                      () => {
                        hasMissingExchangeRate = true;
                      },
                      () => {
                        hasCurrencyOperand = true;
                      }
                    ),
                  (reference) =>
                    resolveNamedReferenceValue(
                      reference,
                      new Set([monthlyCostDisplayIndex]),
                      formulaTargetCurrencyCode,
                      () => {
                        hasMissingExchangeRate = true;
                      },
                      () => {
                        hasCurrencyOperand = true;
                      }
                    )
                );
                if (hasMissingExchangeRate) {
                  employeeMonthlyCostSummary.hasMissingExchangeRate = true;
                  return;
                }

                const numericEvaluated = toFormulaNumber(evaluated);
                if (!Number.isFinite(numericEvaluated)) return;
                if (!hasCurrencyOperand || formulaTargetCurrencyCode === billingCurrencyCode) {
                  amountToAdd = numericEvaluated;
                } else {
                  const convertedAmount = convertEmployeeInfoCurrencyAmount({
                    amount: numericEvaluated,
                    fromCurrencyCode: formulaTargetCurrencyCode,
                    toCurrencyCode: billingCurrencyCode,
                    exchangeRateMap,
                  });
                  if (convertedAmount === null) {
                    employeeMonthlyCostSummary.hasMissingExchangeRate = true;
                    return;
                  }
                  amountToAdd = convertedAmount;
                }
              } else if (monthlyCostColumn.column_kind === "currency") {
                const value = valuesByColumnId[monthlyCostColumn.id];
                if (!value?.text_value) return;
                const sourceAmount = parseNumericCellValue(value.text_value);
                if (!Number.isFinite(sourceAmount)) return;
                const sourceCurrencyCode = normalizeEmployeeInfoCurrencyCode(
                  value.money_currency_code ||
                    parseEmployeeInfoCurrencyCodeFromOptions(monthlyCostColumn.options_json)
                );
                const convertedAmount = convertEmployeeInfoCurrencyAmount({
                  amount: sourceAmount,
                  fromCurrencyCode: sourceCurrencyCode,
                  toCurrencyCode: billingCurrencyCode,
                  exchangeRateMap,
                });
                if (convertedAmount === null) {
                  employeeMonthlyCostSummary.hasMissingExchangeRate = true;
                  return;
                }
                amountToAdd = convertedAmount;
              } else if (monthlyCostColumn.column_kind === "dropdown") {
                amountToAdd = parseNumericCellValue(valuesByColumnId[monthlyCostColumn.id]?.option_value);
              } else {
                amountToAdd = parseNumericCellValue(valuesByColumnId[monthlyCostColumn.id]?.text_value);
              }

              if (amountToAdd === null || !Number.isFinite(amountToAdd)) return;
              employeeMonthlyCostSummary.amount += amountToAdd;
              employeeMonthlyCostSummary.contributingRowCount += 1;
            });
          }
        }
      }
    }
  }

  const { data: projects } = await supabase
    .from("projects")
    .select("id,name")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  const { data: records } = await supabase
    .from("billing_records")
    .select("id,invoice_number,amount,status,due_date,projects(name)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  async function saveBillingProfile(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const displayName = String(formData.get("display_name") || "").trim();
    const billingAddress = String(formData.get("billing_address") || "").trim();
    const currency = String(formData.get("currency") || "USD").trim();
    const taxId = String(formData.get("tax_id") || "").trim();
    const paymentTerms = String(formData.get("payment_terms") || "").trim();
    const defaultRate = String(formData.get("default_rate") || "").trim();

    if (!displayName) {
      redirect(`/clients/${clientId}/billing?error=Billing%20profile%20name%20is%20required`);
    }

    const payload = {
      client_id: clientId,
      display_name: displayName,
      billing_address: billingAddress || null,
      currency,
      tax_id: taxId || null,
      payment_terms: paymentTerms || null,
      default_rate: defaultRate ? Number(defaultRate) : null,
    };

    const { error } = billingProfile
      ? await supabase.from("billing_profiles").update(payload).eq("id", billingProfile.id)
      : await supabase.from("billing_profiles").insert(payload);

    if (error) {
      redirect(`/clients/${clientId}/billing?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/billing`);
    redirect(`/clients/${clientId}/billing?success=Saved`);
  }

  async function createBillingRecord(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const invoiceNumber = String(formData.get("invoice_number") || "").trim();
    const amount = Number(formData.get("amount") || 0);
    const status = String(formData.get("status") || "pending");
    const dueDate = String(formData.get("due_date") || "");
    const projectId = String(formData.get("project_id") || "");

    if (!amount) {
      redirect(`/clients/${clientId}/billing?error=Amount%20is%20required`);
    }

    const { error } = await supabase.from("billing_records").insert({
      client_id: clientId,
      billing_profile_id: billingProfile?.id || null,
      invoice_number: invoiceNumber || null,
      amount,
      status,
      due_date: dueDate || null,
      project_id: projectId || null,
    });

    if (error) {
      redirect(`/clients/${clientId}/billing?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/billing`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {client.name} · Billing
        </h1>
        <ClientTabs clientId={clientId} active="billing" />
      </section>

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

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Employee monthly cost</h2>
        {employeeMonthlyCostSummary.errorMessage ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {employeeMonthlyCostSummary.errorMessage}
          </p>
        ) : !employeeMonthlyCostSummary.isConfigured ? (
          <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Add a <code>TOTAL MONTHLY COST</code> column in Employee Info to populate this total.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            <p className="text-3xl font-semibold text-slate-900">
              {formatEmployeeInfoCurrencyAmount(
                employeeMonthlyCostSummary.amount,
                employeeMonthlyCostSummary.currencyCode
              )}
            </p>
            <p className="text-sm text-slate-600">
              Summed from {employeeMonthlyCostSummary.contributingRowCount} populated values across{" "}
              {employeeMonthlyCostSummary.clientRowCount} employee rows assigned to this client.
            </p>
            {employeeMonthlyCostSummary.hasMissingExchangeRate ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Some rows were skipped due to missing FX rates (<code>#FX!</code>). Add rates in
                Employee Info exchange rates.
              </p>
            ) : null}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Billing profile</h2>
        <form action={saveBillingProfile} className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="display_name">
              Display name
            </label>
            <input
              id="display_name"
              name="display_name"
              defaultValue={billingProfile?.display_name || client.name}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="currency">
              Currency
            </label>
            <input
              id="currency"
              name="currency"
              defaultValue={billingProfile?.currency || "USD"}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="billing_address">
              Billing address
            </label>
            <textarea
              id="billing_address"
              name="billing_address"
              rows={3}
              defaultValue={billingProfile?.billing_address || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="tax_id">
              Tax ID
            </label>
            <input
              id="tax_id"
              name="tax_id"
              defaultValue={billingProfile?.tax_id || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="payment_terms">
              Payment terms
            </label>
            <input
              id="payment_terms"
              name="payment_terms"
              defaultValue={billingProfile?.payment_terms || ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="default_rate">
              Default rate
            </label>
            <input
              id="default_rate"
              name="default_rate"
              type="number"
              step="0.01"
              defaultValue={billingProfile?.default_rate ?? ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
            >
              Save billing profile
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Add billing record</h2>
        <form action={createBillingRecord} className="mt-4 grid gap-4 md:grid-cols-5">
          <input
            name="invoice_number"
            placeholder="Invoice #"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0"
            placeholder="Amount"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <select
            name="status"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue="pending"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <input
            type="date"
            name="due_date"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            name="project_id"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue=""
          >
            <option value="">Project (optional)</option>
            {projects?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="md:col-span-5 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
          >
            Create billing record
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Billing records</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3">Invoice</th>
                <th className="px-6 py-3">Project</th>
                <th className="px-6 py-3">Amount</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Due</th>
              </tr>
            </thead>
            <tbody>
              {records?.length ? (
                records.map((record) => (
                  <tr key={record.id} className="border-t border-slate-200">
                    <td className="px-6 py-3 font-medium text-slate-900">
                      {record.invoice_number || "-"}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {(() => {
                        const project = Array.isArray(record.projects)
                          ? record.projects[0]
                          : record.projects;
                        return project?.name ?? "-";
                      })()}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      ${record.amount?.toFixed(2)}
                    </td>
                    <td className="px-6 py-3 text-slate-600">{record.status}</td>
                    <td className="px-6 py-3 text-slate-600">
                      {record.due_date
                        ? new Date(record.due_date).toLocaleDateString("en-US")
                        : "-"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-slate-500" colSpan={5}>
                    No billing records yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

