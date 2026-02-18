import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ClientTabs from "../_components/ClientTabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingFunctionError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";
import {
  EMPLOYEE_INFO_CURRENCY_CODES,
  formatEmployeeInfoCurrencyAmount,
  normalizeEmployeeInfoCurrencyCode,
  type EmployeeInfoCurrencyCode,
  type EmployeeInfoExchangeRateRow,
} from "@/lib/employeeInfo";
import { computeClientBillingSnapshot } from "@/lib/billing/billingSnapshot";
import RevenueChargesEditor from "./RevenueChargesEditor";
import EmployeeMonthlyCostBreakdownPopover from "./EmployeeMonthlyCostBreakdownPopover";
import EstimatedMonthlyRevenueBreakdownPopover from "./EstimatedMonthlyRevenueBreakdownPopover";
import MonthlyCostSourcesEditor from "./MonthlyCostSourcesEditor";
import { ensureClientPageViewAccess } from "../_lib/clientPageAccess";

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

type BillingProfileRevenueRow = {
  id: string;
  currency: string | null;
  hourly_rate: number | string | null;
  total_billable_hours: number | string | null;
  revenue_charge_items: unknown;
  monthly_cost_items: unknown;
};

type BillingRevenueChargeMode = "per_user" | "monthly";

type BillingRevenueChargeItem = {
  id: string;
  label: string;
  amount: number;
  mode: BillingRevenueChargeMode;
};

type BillingMonthlyCostSourceKind = "employee_column" | "custom";
type BillingMonthlyCostCustomMode = "per_user" | "monthly";

type BillingMonthlyCostItem = {
  id: string;
  source: BillingMonthlyCostSourceKind;
  column_id: string | null;
  label: string;
  amount: number;
  mode: BillingMonthlyCostCustomMode;
};

type BillingMonthlyCostCustomBreakdownRow = {
  id: string;
  label: string;
  mode: BillingMonthlyCostCustomMode;
  amount: number;
  quantity: number;
  totalAmount: number;
};

type EmployeeMonthlyCostSummary = {
  amount: number;
  currencyCode: EmployeeInfoCurrencyCode;
  clientRowCount: number;
  contributingRowCount: number;
  roleColumnLabel: string | null;
  breakdownRows: Array<{
    roleLabel: string;
    employeeCount: number;
    contributingRowCount: number;
    totalAmount: number;
  }>;
  customBreakdownRows: BillingMonthlyCostCustomBreakdownRow[];
  isConfigured: boolean;
  hasMissingExchangeRate: boolean;
  errorMessage: string | null;
};

function isSupportedMonthlyCostSourceColumn(column: EmployeeInfoColumnRow) {
  return (
    column.column_kind === "formula" ||
    column.column_kind === "currency" ||
    column.column_kind === "number" ||
    column.column_kind === "text" ||
    column.column_kind === "dropdown"
  );
}

function toFiniteNumber(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseNonNegativeNumberInput(value: FormDataEntryValue | null, label: string) {
  const raw = String(value || "")
    .trim()
    .replace(/,/g, "");
  if (!raw) return { value: null as number | null, error: null as string | null };
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return { value: null as number | null, error: `${label} must be a valid number` };
  }
  if (numeric < 0) {
    return { value: null as number | null, error: `${label} cannot be negative` };
  }
  return { value: numeric, error: null as string | null };
}

function normalizeBillingRevenueChargeMode(value: unknown): BillingRevenueChargeMode {
  return String(value || "").trim().toLowerCase() === "per_user" ? "per_user" : "monthly";
}

function normalizeBillingMonthlyCostSource(value: unknown): BillingMonthlyCostSourceKind {
  return String(value || "").trim().toLowerCase() === "custom" ? "custom" : "employee_column";
}

function normalizeBillingMonthlyCostMode(value: unknown): BillingMonthlyCostCustomMode {
  return String(value || "").trim().toLowerCase() === "per_user" ? "per_user" : "monthly";
}

function parseRevenueChargeItemsInput(value: FormDataEntryValue | null) {
  const raw = String(value || "").trim();
  if (!raw) return { value: [] as BillingRevenueChargeItem[], error: null as string | null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { value: [] as BillingRevenueChargeItem[], error: "Additional charges are invalid." };
  }

  if (!Array.isArray(parsed)) {
    return { value: [] as BillingRevenueChargeItem[], error: "Additional charges are invalid." };
  }

  const normalized: BillingRevenueChargeItem[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const entry = parsed[index];
    if (!entry || typeof entry !== "object") continue;
    const row = entry as {
      id?: unknown;
      label?: unknown;
      amount?: unknown;
      mode?: unknown;
    };

    const label = String(row.label || "").trim();
    const amountRaw = String(row.amount ?? "")
      .trim()
      .replace(/,/g, "");

    if (!label && !amountRaw) continue;
    if (!label) {
      return { value: [] as BillingRevenueChargeItem[], error: `Charge ${index + 1} needs a label.` };
    }

    const amount = Number(amountRaw);
    if (!Number.isFinite(amount)) {
      return {
        value: [] as BillingRevenueChargeItem[],
        error: `Charge "${label}" must have a valid amount.`,
      };
    }
    if (amount < 0) {
      return {
        value: [] as BillingRevenueChargeItem[],
        error: `Charge "${label}" cannot be negative.`,
      };
    }

    const idRaw = String(row.id || "").trim();
    normalized.push({
      id: idRaw || `charge_${index + 1}`,
      label,
      amount,
      mode: normalizeBillingRevenueChargeMode(row.mode),
    });
  }

  return { value: normalized, error: null as string | null };
}

function parseBillingMonthlyCostItems(value: unknown): BillingMonthlyCostItem[] {
  if (!Array.isArray(value)) return [];

  const normalized: BillingMonthlyCostItem[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;

    const row = entry as {
      id?: unknown;
      source?: unknown;
      column_id?: unknown;
      label?: unknown;
      amount?: unknown;
      mode?: unknown;
    };

    const idRaw = String(row.id || "").trim();
    const source = normalizeBillingMonthlyCostSource(row.source);

    if (source === "employee_column") {
      const columnId = String(row.column_id || "").trim();
      if (!columnId) return;

      normalized.push({
        id: idRaw || `cost_source_${index + 1}`,
        source,
        column_id: columnId,
        label: String(row.label || "").trim(),
        amount: 0,
        mode: "monthly",
      });
      return;
    }

    const label = String(row.label || "").trim();
    const amountRaw = String(row.amount ?? "")
      .trim()
      .replace(/,/g, "");
    const amount = Number(amountRaw);
    if (!label || !Number.isFinite(amount) || amount < 0) return;

    normalized.push({
      id: idRaw || `cost_source_${index + 1}`,
      source: "custom",
      column_id: null,
      label,
      amount,
      mode: normalizeBillingMonthlyCostMode(row.mode),
    });
  });

  return normalized;
}

function parseMonthlyCostItemsInput(
  value: FormDataEntryValue | null,
  availableColumnsById: Map<string, EmployeeInfoColumnRow>
) {
  const raw = String(value || "").trim();
  if (!raw) return { value: [] as BillingMonthlyCostItem[], error: null as string | null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { value: [] as BillingMonthlyCostItem[], error: "Monthly cost sources are invalid." };
  }

  if (!Array.isArray(parsed)) {
    return { value: [] as BillingMonthlyCostItem[], error: "Monthly cost sources are invalid." };
  }

  const normalized: BillingMonthlyCostItem[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const entry = parsed[index];
    if (!entry || typeof entry !== "object") continue;

    const row = entry as {
      id?: unknown;
      source?: unknown;
      column_id?: unknown;
      label?: unknown;
      amount?: unknown;
      mode?: unknown;
    };

    const idRaw = String(row.id || "").trim();
    const source = normalizeBillingMonthlyCostSource(row.source);

    if (source === "employee_column") {
      const columnId = String(row.column_id || "").trim();
      if (!columnId) {
        return {
          value: [] as BillingMonthlyCostItem[],
          error: `Cost source ${index + 1} must select an Employee Info column.`,
        };
      }
      const column = availableColumnsById.get(columnId);
      if (!column) {
        return {
          value: [] as BillingMonthlyCostItem[],
          error: `Cost source ${index + 1} references a column that no longer exists.`,
        };
      }
      if (!isSupportedMonthlyCostSourceColumn(column)) {
        return {
          value: [] as BillingMonthlyCostItem[],
          error: `"${column.label}" cannot be used as a monthly cost source.`,
        };
      }

      normalized.push({
        id: idRaw || `cost_source_${index + 1}`,
        source: "employee_column",
        column_id: columnId,
        label: column.label,
        amount: 0,
        mode: "monthly",
      });
      continue;
    }

    const label = String(row.label || "").trim();
    const amountRaw = String(row.amount ?? "")
      .trim()
      .replace(/,/g, "");

    if (!label && !amountRaw) continue;
    if (!label) {
      return {
        value: [] as BillingMonthlyCostItem[],
        error: `Custom cost ${index + 1} needs a label.`,
      };
    }

    const amount = Number(amountRaw);
    if (!Number.isFinite(amount)) {
      return {
        value: [] as BillingMonthlyCostItem[],
        error: `Custom cost "${label}" must have a valid amount.`,
      };
    }
    if (amount < 0) {
      return {
        value: [] as BillingMonthlyCostItem[],
        error: `Custom cost "${label}" cannot be negative.`,
      };
    }

    normalized.push({
      id: idRaw || `cost_source_${index + 1}`,
      source: "custom",
      column_id: null,
      label,
      amount,
      mode: normalizeBillingMonthlyCostMode(row.mode),
    });
  }

  return { value: normalized, error: null as string | null };
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  const rounded = value.toFixed(1).replace(/\.0$/, "");
  return `${rounded}%`;
}

function hasStringId(value: unknown): value is { id: string } {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    String((value as { id: string }).id).trim().length > 0
  );
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
  await ensureClientPageViewAccess({
    supabase,
    clientId,
    pageKey: "billing",
  });
  const clientName = client.name;
  const clientRecordId = client.id;
  let canEditBilling = true;
  let billingPermissionErrorMessage: string | null = null;

  const canEditBillingResult = await supabase.rpc("can_edit_client_billing", {
    client_uuid: clientId,
  });
  if (isSupabaseMissingFunctionError(canEditBillingResult.error)) {
    canEditBilling = true;
  } else if (canEditBillingResult.error) {
    canEditBilling = false;
    billingPermissionErrorMessage = `Could not verify billing edit permission (${canEditBillingResult.error.message}).`;
  } else {
    canEditBilling = Boolean(canEditBillingResult.data);
  }

  let billingProfile: BillingProfileRevenueRow | null = null;
  let billingProfileErrorMessage: string | null = null;
  let billingRevenueColumnsMissing = false;
  let billingProfilesTableMissing = false;

  let { data: billingProfileRaw, error: billingProfileError } = await supabase
    .from("billing_profiles")
    .select("id,currency,hourly_rate,total_billable_hours,revenue_charge_items,monthly_cost_items")
    .eq("client_id", clientId)
    .maybeSingle();

  if (isSupabaseMissingColumnError(billingProfileError)) {
    billingRevenueColumnsMissing = true;
    const fallbackProfileWithCharges = await supabase
      .from("billing_profiles")
      .select("id,currency,hourly_rate,total_billable_hours,revenue_charge_items")
      .eq("client_id", clientId)
      .maybeSingle();
    if (isSupabaseMissingColumnError(fallbackProfileWithCharges.error)) {
      const fallbackProfile = await supabase
        .from("billing_profiles")
      .select("id,currency,hourly_rate,total_billable_hours")
      .eq("client_id", clientId)
      .maybeSingle();
      if (isSupabaseMissingColumnError(fallbackProfile.error)) {
        const fallbackProfileMinimal = await supabase
          .from("billing_profiles")
          .select("id,currency")
          .eq("client_id", clientId)
          .maybeSingle();
        billingProfileError = fallbackProfileMinimal.error;
        billingProfileRaw = fallbackProfileMinimal.data
          ? {
              ...fallbackProfileMinimal.data,
              hourly_rate: null,
              total_billable_hours: null,
              revenue_charge_items: [],
              monthly_cost_items: [],
            }
          : null;
      } else {
        billingProfileError = fallbackProfile.error;
        billingProfileRaw = fallbackProfile.data
          ? {
              ...fallbackProfile.data,
              revenue_charge_items: [],
              monthly_cost_items: [],
            }
          : null;
      }
    } else {
      billingProfileError = fallbackProfileWithCharges.error;
      billingProfileRaw = fallbackProfileWithCharges.data
        ? {
            ...fallbackProfileWithCharges.data,
            monthly_cost_items: [],
          }
        : null;
    }
  }

  if (isSupabaseMissingTableError(billingProfileError)) {
    billingProfilesTableMissing = true;
    billingProfile = null;
  } else if (billingProfileError) {
    billingProfileErrorMessage = `Could not load billing profile (${billingProfileError.message}).`;
    billingProfile = null;
  } else {
    billingProfile = (billingProfileRaw || null) as BillingProfileRevenueRow | null;
  }

  const billingCurrencyCode = normalizeEmployeeInfoCurrencyCode(billingProfile?.currency || "USD");
  const employeeMonthlyCostSummary: EmployeeMonthlyCostSummary = {
    amount: 0,
    currencyCode: billingCurrencyCode,
    clientRowCount: 0,
    contributingRowCount: 0,
    roleColumnLabel: null,
    breakdownRows: [],
    customBreakdownRows: [],
    isConfigured: false,
    hasMissingExchangeRate: false,
    errorMessage: null,
  };
  let employeeColumnsForBilling: EmployeeInfoColumnRow[] = [];
  let monthlyCostItems = parseBillingMonthlyCostItems(billingProfile?.monthly_cost_items);
  let computedBillingSnapshot = computeClientBillingSnapshot({
    clientId: clientRecordId,
    clientName,
    billingProfile,
    employeeRecords: [],
    employeeColumns: [],
    employeeValues: [],
    exchangeRateRows: [],
  });

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
      employeeColumnsRaw = (fallbackColumns.data || [])
        .filter((column) => hasStringId(column))
        .map((column) => ({
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
      const employeeRecords = ((employeeRecordsRaw || []) as EmployeeInfoRecordRow[]).filter((row) =>
        hasStringId(row)
      );
      const employeeColumns = ((employeeColumnsRaw || []) as EmployeeInfoColumnRow[]).filter((row) =>
        hasStringId(row)
      );
      let employeeValues: EmployeeInfoValueRow[] = [];
      const employeeRecordIds = employeeRecords.map((row) => row.id).filter(Boolean);
      if (employeeRecordIds.length) {
        let employeeValuesRaw: EmployeeInfoValueRow[] = [];
        let employeeValuesError: { message?: string; code?: string } | null = null;
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
          >)
            .filter((row) => !!row && !!row.record_id && !!row.column_id)
            .map((row) => ({
              ...row,
              money_currency_code: null,
            }));
        }

        if (employeeValuesError && !isSupabaseMissingTableError(employeeValuesError)) {
          employeeMonthlyCostSummary.errorMessage = `Could not load Employee Info values (${employeeValuesError.message}).`;
        } else {
          employeeValues = (
            isSupabaseMissingTableError(employeeValuesError) ? [] : employeeValuesRaw || []
          ) as EmployeeInfoValueRow[];
        }
      }

      let exchangeRateRows: EmployeeInfoExchangeRateRow[] = [];
      const { data: exchangeRateRowsRaw, error: exchangeRateError } = await supabase
        .from("employee_info_exchange_rates")
        .select("base_currency_code,quote_currency_code,rate,effective_month_start")
        .order("effective_month_start", { ascending: false });

      if (exchangeRateError && !isSupabaseMissingTableError(exchangeRateError)) {
        employeeMonthlyCostSummary.errorMessage = `Could not load Employee Info exchange rates (${exchangeRateError.message}).`;
      } else {
        exchangeRateRows = (
          isSupabaseMissingTableError(exchangeRateError) ? [] : exchangeRateRowsRaw || []
        ) as EmployeeInfoExchangeRateRow[];
      }

      computedBillingSnapshot = computeClientBillingSnapshot({
        clientId: clientRecordId,
        clientName,
        billingProfile,
        employeeRecords,
        employeeColumns,
        employeeValues,
        exchangeRateRows,
      });
    }
  }
  employeeColumnsForBilling = computedBillingSnapshot.employeeColumnsForBilling;
  monthlyCostItems = computedBillingSnapshot.monthlyCostItems;
  employeeMonthlyCostSummary.amount = computedBillingSnapshot.employeeMonthlyCostSummary.amount;
  employeeMonthlyCostSummary.currencyCode = computedBillingSnapshot.employeeMonthlyCostSummary.currencyCode;
  employeeMonthlyCostSummary.clientRowCount =
    computedBillingSnapshot.employeeMonthlyCostSummary.clientRowCount;
  employeeMonthlyCostSummary.contributingRowCount =
    computedBillingSnapshot.employeeMonthlyCostSummary.contributingRowCount;
  employeeMonthlyCostSummary.roleColumnLabel =
    computedBillingSnapshot.employeeMonthlyCostSummary.roleColumnLabel;
  employeeMonthlyCostSummary.breakdownRows =
    computedBillingSnapshot.employeeMonthlyCostSummary.breakdownRows;
  employeeMonthlyCostSummary.customBreakdownRows =
    computedBillingSnapshot.employeeMonthlyCostSummary.customBreakdownRows;
  employeeMonthlyCostSummary.isConfigured = computedBillingSnapshot.employeeMonthlyCostSummary.isConfigured;
  employeeMonthlyCostSummary.hasMissingExchangeRate =
    computedBillingSnapshot.employeeMonthlyCostSummary.hasMissingExchangeRate;

  const hourlyRate = computedBillingSnapshot.hourlyRate;
  const totalBillableHours = computedBillingSnapshot.totalBillableHours;
  const revenueChargeItems = computedBillingSnapshot.revenueChargeItems;
  const baseMonthlyRevenue = computedBillingSnapshot.baseMonthlyRevenue;
  const revenueBreakdownRows = computedBillingSnapshot.revenueBreakdownRows;
  const additionalMonthlyRevenue = computedBillingSnapshot.additionalMonthlyRevenue;
  const estimatedMonthlyRevenue = computedBillingSnapshot.estimatedMonthlyRevenue;
  const estimatedMonthlyMargin = computedBillingSnapshot.estimatedMonthlyMargin;
  const estimatedMonthlyMarginPercent = computedBillingSnapshot.estimatedMonthlyMarginPercent;
  const monthlyCostSourceColumns = employeeColumnsForBilling
    .filter(isSupportedMonthlyCostSourceColumn)
    .map((column) => ({
      id: column.id,
      label: column.label,
      column_kind: column.column_kind as "text" | "dropdown" | "formula" | "number" | "currency",
    }));

  async function saveRevenueModel(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();

    if (!canEditBilling) {
      redirect(
        `/clients/${clientId}/billing?error=${encodeURIComponent(
          "You do not have permission to edit billing for this client."
        )}`
      );
    }

    if (billingProfilesTableMissing) {
      redirect(
        `/clients/${clientId}/billing?error=${encodeURIComponent(
          "Billing table is missing. Set up billing_profiles first."
        )}`
      );
    }

    if (billingRevenueColumnsMissing) {
      redirect(
        `/clients/${clientId}/billing?error=${encodeURIComponent(
          "Run sql/client_billing_revenue_fields.sql before saving revenue fields."
        )}`
      );
    }

    const currency = normalizeEmployeeInfoCurrencyCode(String(formData.get("currency") || "USD"));
    const hourlyRateValue = parseNonNegativeNumberInput(formData.get("hourly_rate"), "Hourly rate");
    if (hourlyRateValue.error) {
      redirect(`/clients/${clientId}/billing?error=${encodeURIComponent(hourlyRateValue.error)}`);
    }
    const totalBillableHoursValue = parseNonNegativeNumberInput(
      formData.get("total_billable_hours"),
      "Total billable hours"
    );
    if (totalBillableHoursValue.error) {
      redirect(`/clients/${clientId}/billing?error=${encodeURIComponent(totalBillableHoursValue.error)}`);
    }
    const monthlyCostItemsValue = parseMonthlyCostItemsInput(
      formData.get("monthly_cost_items_json"),
      new Map(employeeColumnsForBilling.map((column) => [column.id, column]))
    );
    if (monthlyCostItemsValue.error) {
      redirect(`/clients/${clientId}/billing?error=${encodeURIComponent(monthlyCostItemsValue.error)}`);
    }
    const revenueChargeItemsValue = parseRevenueChargeItemsInput(
      formData.get("revenue_charge_items_json")
    );
    if (revenueChargeItemsValue.error) {
      redirect(
        `/clients/${clientId}/billing?error=${encodeURIComponent(revenueChargeItemsValue.error)}`
      );
    }

    const payload = {
      client_id: clientId,
      currency,
      hourly_rate: hourlyRateValue.value,
      total_billable_hours: totalBillableHoursValue.value,
      monthly_cost_items: monthlyCostItemsValue.value,
      revenue_charge_items: revenueChargeItemsValue.value,
      display_name: clientName,
    };
    const existingBillingProfileId = hasStringId(billingProfile) ? billingProfile.id : null;
    const { error } = existingBillingProfileId
      ? await supabase.from("billing_profiles").update(payload).eq("id", existingBillingProfileId)
      : await supabase.from("billing_profiles").insert(payload);

    if (error) {
      if (isSupabaseMissingColumnError(error)) {
        redirect(
          `/clients/${clientId}/billing?error=${encodeURIComponent(
            "Run sql/client_billing_revenue_fields.sql before saving revenue fields."
          )}`
        );
      }
      if (isSupabaseMissingTableError(error)) {
        redirect(
          `/clients/${clientId}/billing?error=${encodeURIComponent(
            "Billing table is missing. Set up billing_profiles first."
          )}`
        );
      }
      redirect(`/clients/${clientId}/billing?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/clients/${clientId}/billing`);
    redirect(`/clients/${clientId}/billing?success=Revenue%20model%20saved`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {clientName} - Billing
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

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Employee monthly costs
            </p>
            <EmployeeMonthlyCostBreakdownPopover
              currencyCode={employeeMonthlyCostSummary.currencyCode}
              rows={employeeMonthlyCostSummary.breakdownRows}
              customRows={employeeMonthlyCostSummary.customBreakdownRows}
              clientRowCount={employeeMonthlyCostSummary.clientRowCount}
              contributingRowCount={employeeMonthlyCostSummary.contributingRowCount}
              roleColumnLabel={employeeMonthlyCostSummary.roleColumnLabel}
            />
          </div>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {formatEmployeeInfoCurrencyAmount(
              employeeMonthlyCostSummary.amount,
              employeeMonthlyCostSummary.currencyCode
            )}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            From {employeeMonthlyCostSummary.contributingRowCount} configured contributions across{" "}
            {employeeMonthlyCostSummary.clientRowCount} employee rows.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Estimated monthly revenue
            </p>
            <EstimatedMonthlyRevenueBreakdownPopover
              currencyCode={billingCurrencyCode}
              hourlyRate={hourlyRate}
              totalBillableHours={totalBillableHours}
              baseRevenue={baseMonthlyRevenue}
              employeeCount={employeeMonthlyCostSummary.clientRowCount}
              rows={revenueBreakdownRows}
              totalAmount={estimatedMonthlyRevenue}
            />
          </div>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {formatEmployeeInfoCurrencyAmount(estimatedMonthlyRevenue, billingCurrencyCode)}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            {formatEmployeeInfoCurrencyAmount(hourlyRate, billingCurrencyCode)} x{" "}
            {totalBillableHours.toFixed(2).replace(/\.?0+$/, "")}h +{" "}
            {formatEmployeeInfoCurrencyAmount(additionalMonthlyRevenue, billingCurrencyCode)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {revenueChargeItems.length} custom charge
            {revenueChargeItems.length === 1 ? "" : "s"}; per-user charges use{" "}
            {employeeMonthlyCostSummary.clientRowCount} assigned employees.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Estimated gross margin
          </p>
          <p
            className={`mt-2 text-3xl font-semibold ${
              estimatedMonthlyMargin < 0 ? "text-red-700" : "text-slate-900"
            }`}
          >
            {formatEmployeeInfoCurrencyAmount(estimatedMonthlyMargin, billingCurrencyCode)}
          </p>
          <p className="mt-2 text-sm text-slate-600">{formatPercent(estimatedMonthlyMarginPercent)}</p>
        </div>
      </section>

      <section className="space-y-4">
        {billingProfileErrorMessage ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {billingProfileErrorMessage}
          </p>
        ) : null}
        {billingRevenueColumnsMissing ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            Run <code>sql/client_billing_revenue_fields.sql</code> to enable revenue fields.
          </p>
        ) : null}
        {employeeMonthlyCostSummary.errorMessage ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {employeeMonthlyCostSummary.errorMessage}
          </p>
        ) : null}
        {employeeMonthlyCostSummary.hasMissingExchangeRate ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            Some employee rows were skipped due to missing FX rates (<code>#FX!</code>).
          </p>
        ) : null}
        {billingPermissionErrorMessage ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {billingPermissionErrorMessage}
          </p>
        ) : null}
        {!canEditBilling ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            You can view this billing page, but only users with billing edit permission can save
            changes.
          </p>
        ) : null}

        <form action={saveRevenueModel} className="space-y-4">
          <details open className="group rounded-lg border border-slate-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Revenue model</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Store the billing assumptions used to estimate monthly revenue for this client.
                </p>
              </div>
              <span
                aria-hidden="true"
                className="inline-block text-xs text-slate-500 transition-transform group-open:rotate-90"
              >
                &gt;
              </span>
            </summary>
            <div className="space-y-4 border-t border-slate-200 px-5 py-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700" htmlFor="currency">
                    Currency
                  </label>
                  <select
                    id="currency"
                    name="currency"
                    defaultValue={billingCurrencyCode}
                    disabled={!canEditBilling}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    {EMPLOYEE_INFO_CURRENCY_CODES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700" htmlFor="hourly_rate">
                    Hourly rate
                  </label>
                  <input
                    id="hourly_rate"
                    name="hourly_rate"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={toFiniteNumber(billingProfile?.hourly_rate) ?? ""}
                    disabled={!canEditBilling}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="0.00"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700" htmlFor="total_billable_hours">
                    Total billable hours
                  </label>
                  <input
                    id="total_billable_hours"
                    name="total_billable_hours"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={toFiniteNumber(billingProfile?.total_billable_hours) ?? ""}
                    disabled={!canEditBilling}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="0"
                  />
                </div>
              </div>

              <RevenueChargesEditor
                name="revenue_charge_items_json"
                initialItems={revenueChargeItems}
                currencyCode={billingCurrencyCode}
                employeeCount={employeeMonthlyCostSummary.clientRowCount}
                disabled={!canEditBilling}
              />
            </div>
          </details>

          <details open className="group rounded-lg border border-slate-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Monthly costs</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Configure monthly cost sources separately from revenue assumptions.
                </p>
              </div>
              <span
                aria-hidden="true"
                className="inline-block text-xs text-slate-500 transition-transform group-open:rotate-90"
              >
                &gt;
              </span>
            </summary>
            <div className="border-t border-slate-200 px-5 py-5">
              <MonthlyCostSourcesEditor
                name="monthly_cost_items_json"
                initialItems={monthlyCostItems}
                employeeColumns={monthlyCostSourceColumns}
                currencyCode={billingCurrencyCode}
                employeeCount={employeeMonthlyCostSummary.clientRowCount}
                disabled={!canEditBilling}
              />
            </div>
          </details>

          <div>
            <button
              type="submit"
              disabled={!canEditBilling}
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save billing settings
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}


