import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseCsvParam } from "@/lib/queryParams";
import ClientsTable from "./ClientsTable";

const statusOptions = ["prospect", "active", "on_hold", "offboarded"] as const;
const clientSortKeys = ["name", "status", "industry", "start"] as const;
const clientSortDirs = ["asc", "desc"] as const;

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

    return request;
  };

  let clientsError: string | null = null;
  type ClientRow = {
    id: string;
    name: string;
    status: string | null;
    industry: string | null;
    account_owner: string | null;
    start_date: string | null;
    end_date: string | null;
  };
  let clients: ClientRow[] = [];

  const { data: clientsWithEndDate, error: clientsWithEndDateError } =
    await buildClientsQuery(true);

  if (clientsWithEndDateError) {
    const missingEndDateColumn =
      clientsWithEndDateError.message.includes("end_date") ||
      clientsWithEndDateError.details?.includes("end_date");

    if (missingEndDateColumn) {
      const { data: clientsWithoutEndDate, error: clientsWithoutEndDateError } =
        await buildClientsQuery(false);
      if (clientsWithoutEndDateError) {
        clientsError = clientsWithoutEndDateError.message;
      } else {
        clients = (
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
    clients = (clientsWithEndDate || []) as unknown as ClientRow[];
  }

  const activeEmployeeCountByClientId: Record<string, number> = {};
  clients.forEach((client) => {
    if (client.id) activeEmployeeCountByClientId[client.id] = 0;
  });
  const clientIds = clients.map((client) => client.id).filter(Boolean);

  if (clientIds.length) {
    const { data: employeeRecordsRaw, error: employeeRecordsError } = await supabase
      .from("employee_info_records")
      .select("id,client_id")
      .in("client_id", clientIds);

    const employeeRecords = employeeRecordsError
      ? []
      : ((employeeRecordsRaw || []) as Array<{ id: string; client_id: string | null }>);
    const recordIds = employeeRecords.map((record) => record.id).filter(Boolean);
    const clientIdByRecordId = employeeRecords.reduce<Record<string, string>>((acc, record) => {
      if (!record.id || !record.client_id) return acc;
      acc[record.id] = record.client_id;
      return acc;
    }, {});

    const { data: employeeColumnsRaw, error: employeeColumnsError } = await supabase
      .from("employee_info_columns")
      .select("id,key,label,column_kind");
    const employeeColumns = employeeColumnsError
      ? []
      : ((employeeColumnsRaw || []) as Array<{
          id: string;
          key: string;
          label: string;
          column_kind: string;
        }>);
    const leaveDateColumnIds = employeeColumns
      .filter((column) => isLeaveDateColumn(column))
      .map((column) => column.id);

    const inactiveRecordIdSet = new Set<string>();
    if (recordIds.length && leaveDateColumnIds.length) {
      const { data: leaveValuesRaw, error: leaveValuesError } = await supabase
        .from("employee_info_values")
        .select("record_id,text_value,option_value,column_id")
        .in("record_id", recordIds)
        .in("column_id", leaveDateColumnIds);

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
  }

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

      <section className="w-full max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">All clients</h2>
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
    </div>
  );
}


