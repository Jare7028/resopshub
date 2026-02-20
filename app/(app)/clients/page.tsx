import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseCsvParam, setCsvParam } from "@/lib/queryParams";
import { withPerfTiming } from "@/lib/perf";
import { isSupabaseMissingFunctionError, isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import ClientsTable from "./ClientsTable";

const statusOptions = ["prospect", "active", "on_hold", "offboarded"] as const;
const clientSortKeys = ["name", "status", "industry", "start"] as const;
const clientSortDirs = ["asc", "desc"] as const;
const CLIENTS_PAGE_SIZE = 50;

type ClientSortKey = (typeof clientSortKeys)[number];
type ClientSortDir = (typeof clientSortDirs)[number];

function normalizeClientSortKey(value: string | undefined): ClientSortKey {
  if (!value) return "name";
  return (clientSortKeys as readonly string[]).includes(value) ? (value as ClientSortKey) : "name";
}

function normalizeClientSortDir(value: string | undefined): ClientSortDir {
  if (!value) return "asc";
  return (clientSortDirs as readonly string[]).includes(value) ? (value as ClientSortDir) : "asc";
}

function normalizeToken(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isLeaveDateColumn(column: { key: string; label: string; column_kind: string }) {
  if (column.column_kind !== "date") return false;
  const keyToken = normalizeToken(column.key);
  const labelToken = normalizeToken(column.label);
  const hasLeaveDateWords = (token: string) => token.includes("leave") && token.includes("date");
  return (
    keyToken === "leave_date" ||
    labelToken === "leave_date" ||
    hasLeaveDateWords(keyToken) ||
    hasLeaveDateWords(labelToken)
  );
}

export default async function ClientsPage(props: {
  searchParams?: Promise<{
    q?: string;
    status?: string | string[];
    industry?: string | string[];
    sort?: string;
    dir?: string;
    view?: string;
    page?: string;
    error?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const query = (searchParams?.q || "").trim();
  const selectedStatuses = parseCsvParam(searchParams?.status).filter((value) =>
    statusOptions.includes(value as (typeof statusOptions)[number])
  );
  const selectedIndustries = parseCsvParam(searchParams?.industry);
  const sortKey = normalizeClientSortKey(searchParams?.sort);
  const sortDir = normalizeClientSortDir(searchParams?.dir);
  const initialView =
    searchParams?.view === "board" || searchParams?.view === "gantt"
      ? searchParams.view
      : "table";
  const hasExplicitView = typeof searchParams?.view !== "undefined";
  const pageParam = Number.parseInt(String(searchParams?.page || "1"), 10);
  const currentPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const rangeFrom = (currentPage - 1) * CLIENTS_PAGE_SIZE;
  const rangeTo = rangeFrom + CLIENTS_PAGE_SIZE;
  const ascending = sortDir === "asc";

  const buildClientsQuery = (includeEndDate: boolean) => {
    let request = supabase
      .from("clients")
      .select(
        includeEndDate
          ? "id,name,status,industry,account_owner,start_date,end_date"
          : "id,name,status,industry,account_owner,start_date"
      );

    switch (sortKey) {
      case "status":
        request = request.order("status", { ascending }).order("name", { ascending: true });
        break;
      case "industry":
        request = request.order("industry", { ascending }).order("name", { ascending: true });
        break;
      case "start":
        request = request.order("start_date", { ascending }).order("name", { ascending: true });
        break;
      case "name":
      default:
        request = request.order("name", { ascending });
        break;
    }

    if (query) {
      request = request.ilike("name", `%${query}%`);
    }

    if (selectedStatuses.length) {
      request = request.in("status", selectedStatuses);
    }

    if (selectedIndustries.length) {
      request = request.in("industry", selectedIndustries);
    }

    request = request.range(rangeFrom, rangeTo);

    return request;
  };

  let clientsError: string | null = null;
  let clientsPerfWarning: string | null = null;
  type ClientRow = {
    id: string;
    name: string;
    status: string | null;
    industry: string | null;
    account_owner: string | null;
    start_date: string | null;
    end_date: string | null;
  };
  let clientsPageRows: ClientRow[] = [];

  const { data: clientsWithEndDate, error: clientsWithEndDateError } =
    await withPerfTiming("clients.page.rows_with_end_date", () => buildClientsQuery(true));

  if (clientsWithEndDateError) {
    const missingEndDateColumn =
      clientsWithEndDateError.message.includes("end_date") ||
      clientsWithEndDateError.details?.includes("end_date");

    if (missingEndDateColumn) {
      const { data: clientsWithoutEndDate, error: clientsWithoutEndDateError } =
        await withPerfTiming("clients.page.rows_without_end_date", () =>
          buildClientsQuery(false)
        );
      if (clientsWithoutEndDateError) {
        clientsError = clientsWithoutEndDateError.message;
      } else {
        clientsPageRows = (
          (clientsWithoutEndDate || []) as unknown as Array<
            Omit<ClientRow, "end_date">
          >
        ).map((client) => ({
          ...client,
          end_date: null,
        }));
      }
    } else {
      clientsError = clientsWithEndDateError.message;
    }
  } else {
    clientsPageRows = (clientsWithEndDate || []) as unknown as ClientRow[];
  }
  const hasNextPage = clientsPageRows.length > CLIENTS_PAGE_SIZE;
  const hasPreviousPage = currentPage > 1;
  const clients = clientsPageRows.slice(0, CLIENTS_PAGE_SIZE);

  const activeEmployeeCountByClientId: Record<string, number> = {};
  clients.forEach((client) => {
    if (client.id) activeEmployeeCountByClientId[client.id] = 0;
  });
  const clientIds = clients.map((client) => client.id).filter(Boolean);

  if (clientIds.length) {
    const rpcCountsResult = await withPerfTiming("clients.page.active_employee_counts.rpc", () =>
      supabase.rpc("client_active_employee_counts", {
        p_client_ids: clientIds,
      })
    );

    const canUseFallback =
      !rpcCountsResult.error ||
      isSupabaseMissingFunctionError(rpcCountsResult.error) ||
      isSupabaseMissingTableError(rpcCountsResult.error);
    if (rpcCountsResult.error && isSupabaseMissingFunctionError(rpcCountsResult.error)) {
      clientsPerfWarning =
        "Active employee counts are running in compatibility mode. Run sql/performance_clients_employee_info.sql in Supabase to speed up /clients.";
    }

    if (!rpcCountsResult.error) {
      const rpcRows = (rpcCountsResult.data || []) as Array<{
        client_id: string | null;
        active_count: number | null;
      }>;
      rpcRows.forEach((row) => {
        const clientId = String(row.client_id || "").trim();
        if (!clientId) return;
        const count = Number(row.active_count || 0);
        activeEmployeeCountByClientId[clientId] = Number.isFinite(count) ? Math.max(0, count) : 0;
      });
    } else if (canUseFallback) {
      const [employeeRecordsResult, employeeColumnsResult] = await Promise.all([
        withPerfTiming("clients.page.active_employee_counts.fallback.records", () =>
          supabase.from("employee_info_records").select("id,client_id").in("client_id", clientIds)
        ),
        withPerfTiming("clients.page.active_employee_counts.fallback.columns", () =>
          supabase
            .from("employee_info_columns")
            .select("id,key,label,column_kind")
            .eq("column_kind", "date")
        ),
      ]);

      const employeeRecords = employeeRecordsResult.error
        ? []
        : ((employeeRecordsResult.data || []) as Array<{ id: string; client_id: string | null }>);
      const employeeColumns = employeeColumnsResult.error
        ? []
        : ((employeeColumnsResult.data || []) as Array<{
            id: string;
            key: string;
            label: string;
            column_kind: string;
          }>);

      const recordIds = employeeRecords.map((record) => record.id).filter(Boolean);
      const clientIdByRecordId = employeeRecords.reduce<Record<string, string>>((acc, record) => {
        if (!record.id || !record.client_id) return acc;
        acc[record.id] = record.client_id;
        return acc;
      }, {});
      const leaveDateColumnIds = employeeColumns
        .filter((column) => isLeaveDateColumn(column))
        .map((column) => column.id);

      const inactiveRecordIdSet = new Set<string>();
      if (recordIds.length && leaveDateColumnIds.length) {
        const { data: leaveValuesRaw, error: leaveValuesError } = await withPerfTiming(
          "clients.page.active_employee_counts.fallback.leave_values",
          () =>
            supabase
              .from("employee_info_values")
              .select("record_id,text_value,option_value,column_id")
              .in("record_id", recordIds)
              .in("column_id", leaveDateColumnIds)
              .or("text_value.not.is.null,option_value.not.is.null")
        );

        if (!leaveValuesError) {
          ((leaveValuesRaw || []) as Array<{
            record_id: string;
            text_value: string | null;
            option_value: string | null;
          }>).forEach((row) => {
            const leaveDateValue = String(row.text_value || row.option_value || "").trim();
            if (leaveDateValue) {
              inactiveRecordIdSet.add(row.record_id);
            }
          });
        }
      }

      recordIds.forEach((recordId) => {
        if (inactiveRecordIdSet.has(recordId)) return;
        const clientId = clientIdByRecordId[recordId];
        if (!clientId) return;
        activeEmployeeCountByClientId[clientId] = (activeEmployeeCountByClientId[clientId] || 0) + 1;
      });
    } else if (rpcCountsResult.error && !clientsError) {
      clientsError = rpcCountsResult.error.message;
    }
  }

  const buildClientsPageUrl = (pageNumber: number) => {
    const normalizedPage =
      Number.isFinite(pageNumber) && pageNumber > 1 ? Math.floor(pageNumber) : 1;
    const sp = new URLSearchParams();
    if (query) {
      sp.set("q", query);
    }
    setCsvParam(sp, "status", selectedStatuses);
    setCsvParam(sp, "industry", selectedIndustries);
    sp.set("sort", sortKey);
    sp.set("dir", sortDir);
    if (initialView !== "table") {
      sp.set("view", initialView);
    }
    if (normalizedPage > 1) {
      sp.set("page", String(normalizedPage));
    }
    const qs = sp.toString();
    return qs ? `/clients?${qs}` : "/clients";
  };
  const previousPageUrl = hasPreviousPage ? buildClientsPageUrl(currentPage - 1) : null;
  const nextPageUrl = hasNextPage ? buildClientsPageUrl(currentPage + 1) : null;

  async function deleteClient(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const clientId = String(formData.get("client_id") || "");

    if (!clientId) {
      return;
    }

    const { error } = await supabase.from("clients").delete().eq("id", clientId);

    if (error) {
      redirect(`/clients?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/clients");
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Clients</h1>
          <p className="text-sm text-slate-600">
            Manage client accounts, contacts, projects, tasks, and billing in one place.
          </p>
        </div>
        <Link
          href="/clients/new"
          className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white "
        >
          New client
        </Link>
      </section>

      {searchParams?.error || clientsError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams?.error || clientsError}
        </p>
      ) : null}
      {clientsPerfWarning ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {clientsPerfWarning}
        </p>
      ) : null}

      <section className="w-full max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">All clients</h2>
          <p className="mt-1 text-xs text-slate-500">
            Showing up to {CLIENTS_PAGE_SIZE} clients per page.
          </p>
        </div>
        <ClientsTable
          clients={clients}
          activeEmployeeCountByClientId={activeEmployeeCountByClientId}
          statusOptions={statusOptions}
          initialFilters={{
            q: query,
            status: selectedStatuses,
            industry: selectedIndustries,
          }}
          sortKey={sortKey}
          sortDir={sortDir}
          initialView={initialView}
          hasExplicitView={hasExplicitView}
          viewPreferenceScope="clients"
          onDelete={deleteClient}
        />
      </section>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Page {currentPage}</p>
        <div className="flex items-center gap-2">
          {previousPageUrl ? (
            <Link
              href={previousPageUrl}
              className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Previous
            </Link>
          ) : null}
          {nextPageUrl ? (
            <Link
              href={nextPageUrl}
              className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Next
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}


