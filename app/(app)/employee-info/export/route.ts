import { NextResponse } from "next/server";
import {
  columnIndexToLetter,
  evaluateEmployeeFormula,
  formatFormulaResult,
  getEmployeeInfoCurrencySymbol,
  parseEmployeeInfoCurrencyCodeFromOptions,
  toEmployeeInfoColumnKey,
} from "@/lib/employeeInfo";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type EmployeeInfoRecordRow = {
  id: string;
  full_name: string;
  client_id: string | null;
  created_at: string;
};

type EmployeeInfoColumnRow = {
  id: string;
  key: string;
  label: string;
  column_kind: "text" | "dropdown" | "formula" | "number" | "date" | "currency";
  formula: string | null;
  options_json: unknown;
  position: number;
};

type EmployeeInfoValueRow = {
  record_id: string;
  column_id: string;
  text_value: string | null;
  option_value: string | null;
};

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (!/["\n,\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function buildValueMap(
  rows: EmployeeInfoValueRow[]
): Record<string, Record<string, { text_value: string | null; option_value: string | null }>> {
  return rows.reduce<
    Record<string, Record<string, { text_value: string | null; option_value: string | null }>>
  >((acc, row) => {
    if (!acc[row.record_id]) acc[row.record_id] = {};
    acc[row.record_id][row.column_id] = {
      text_value: row.text_value,
      option_value: row.option_value,
    };
    return acc;
  }, {});
}

function buildFormulaValueMap(args: {
  records: EmployeeInfoRecordRow[];
  columns: EmployeeInfoColumnRow[];
  valueMap: Record<string, Record<string, { text_value: string | null; option_value: string | null }>>;
  clientNameById: Record<string, string>;
}) {
  const { records, columns, valueMap, clientNameById } = args;
  const result: Record<string, Record<string, string>> = {};

  records.forEach((record) => {
    result[record.id] = {};
    const valuesByColumnId = valueMap[record.id] || {};
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

    columns.forEach((column, index) => {
      const displayIndex = index + 2;
      registerReference(column.key, displayIndex);
      registerReference(toEmployeeInfoColumnKey(column.label), displayIndex);
      registerReference(columnIndexToLetter(displayIndex), displayIndex);
    });

    const resolveDisplayIndexValue = (displayIndex: number, visiting: Set<number>): unknown => {
      if (displayIndex === 0) return record.full_name;
      if (displayIndex === 1) return record.client_id ? clientNameById[record.client_id] || "" : "";

      const dynamicIndex = displayIndex - 2;
      if (dynamicIndex < 0 || dynamicIndex >= columns.length) return "";
      const column = columns[dynamicIndex];

      if (column.column_kind === "formula") {
        if (visiting.has(displayIndex)) return 0;
        visiting.add(displayIndex);
        const nested = evaluateEmployeeFormula(
          column.formula,
          (refIndex) => resolveDisplayIndexValue(refIndex, new Set(visiting)),
          (reference) => resolveNamedReferenceValue(reference, new Set(visiting))
        );
        visiting.delete(displayIndex);
        return nested ?? 0;
      }

      const value = valuesByColumnId[column.id];
      if (!value) return "";
      return column.column_kind === "dropdown" ? value.option_value || "" : value.text_value || "";
    };

    const resolveNamedReferenceValue = (reference: string, visiting: Set<number>) => {
      const displayIndex = namedReferenceToDisplayIndex[String(reference || "").trim().toLowerCase()];
      if (displayIndex === undefined) return undefined;
      return resolveDisplayIndexValue(displayIndex, visiting);
    };

    columns.forEach((column, index) => {
      if (column.column_kind !== "formula") return;
      const displayIndex = index + 2;
      const evaluated = evaluateEmployeeFormula(
        column.formula,
        (refIndex) => resolveDisplayIndexValue(refIndex, new Set([displayIndex])),
        (reference) => resolveNamedReferenceValue(reference, new Set([displayIndex]))
      );
      result[record.id][column.id] = formatFormulaResult(evaluated);
    });
  });

  return result;
}

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authUserId = authData.user?.id;
  const authEmail = authData.user?.email || "";
  if (!authUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id,role")
    .eq("email", authEmail)
    .maybeSingle();
  const currentAppUserId = profile?.id || authUserId;
  const isAdmin = profile?.role === "admin";

  if (!isAdmin) {
    const { data: accessRow, error: accessError } = await supabase
      .from("employee_info_access_users")
      .select("user_id")
      .eq("user_id", currentAppUserId)
      .maybeSingle();
    if (accessError || !accessRow) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const [{ data: clientsRaw }, { data: recordsRaw, error: recordsError }, { data: columnsRaw, error: columnsError }] =
    await Promise.all([
      supabase.from("clients").select("id,name"),
      supabase
        .from("employee_info_records")
        .select("id,full_name,client_id,created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("employee_info_columns")
        .select("id,key,label,column_kind,formula,options_json,position")
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

  if (recordsError) {
    return NextResponse.json({ error: recordsError.message }, { status: 400 });
  }
  if (columnsError) {
    return NextResponse.json({ error: columnsError.message }, { status: 400 });
  }

  const records = (recordsRaw || []) as EmployeeInfoRecordRow[];
  const columns = (columnsRaw || []) as EmployeeInfoColumnRow[];
  const clients = (clientsRaw || []) as Array<{ id: string; name: string }>;

  const recordIds = records.map((row) => row.id).filter(Boolean);
  const { data: valuesRaw, error: valuesError } = recordIds.length
    ? await supabase
        .from("employee_info_values")
        .select("record_id,column_id,text_value,option_value")
        .in("record_id", recordIds)
    : { data: [] as EmployeeInfoValueRow[], error: null };

  if (valuesError) {
    return NextResponse.json({ error: valuesError.message }, { status: 400 });
  }

  const valuesByRecordId = buildValueMap((valuesRaw || []) as EmployeeInfoValueRow[]);
  const clientNameById = clients.reduce<Record<string, string>>((acc, client) => {
    acc[client.id] = client.name;
    return acc;
  }, {});
  const formulaValueByRecordIdAndColumnId = buildFormulaValueMap({
    records,
    columns,
    valueMap: valuesByRecordId,
    clientNameById,
  });

  const headers = ["Full Name", "Client", ...columns.map((column) => column.label)];
  const rows = records.map((record) => {
    const valuesByColumnId = valuesByRecordId[record.id] || {};
    const formulasByColumnId = formulaValueByRecordIdAndColumnId[record.id] || {};
    const rowValues: string[] = [
      record.full_name,
      record.client_id ? clientNameById[record.client_id] || "" : "",
    ];

    columns.forEach((column) => {
      if (column.column_kind === "formula") {
        rowValues.push(formulasByColumnId[column.id] || "");
        return;
      }
      const value = valuesByColumnId[column.id];
      if (!value) {
        rowValues.push("");
        return;
      }
      if (column.column_kind === "dropdown") {
        rowValues.push(value.option_value || "");
        return;
      }
      if (column.column_kind === "currency") {
        const amount = String(value.text_value || "").trim();
        if (!amount) {
          rowValues.push("");
          return;
        }
        const currencyCode = parseEmployeeInfoCurrencyCodeFromOptions(column.options_json);
        const symbol = getEmployeeInfoCurrencySymbol(currencyCode);
        const prefix = currencyCode === "MUR" ? `${symbol} ` : symbol;
        rowValues.push(`${prefix}${amount}`);
        return;
      }
      rowValues.push(value.text_value || "");
    });
    return rowValues;
  });

  const csvLines = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const fileName = `employee-info-${new Date().toISOString().slice(0, 10)}.csv`;
  const body = `\uFEFF${csvLines}`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${fileName}\"`,
      "Cache-Control": "no-store",
    },
  });
}
