import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type LinkEntityType =
  | "task"
  | "project"
  | "feature_suggestion"
  | "note"
  | "client";

const VALID_TYPES = new Set<LinkEntityType>([
  "task",
  "project",
  "feature_suggestion",
  "note",
  "client",
]);

const DEFAULT_LIMIT = 50;

export async function GET(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const typeRaw = String(url.searchParams.get("type") || "").trim() as LinkEntityType;
  const query = String(url.searchParams.get("q") || "").trim();

  if (!VALID_TYPES.has(typeRaw)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const normalizedType = typeRaw;

  if (normalizedType === "task") {
    let request = supabase
      .from("tasks")
      .select("id,title")
      .is("parent_task_id", null)
      .not("status", "eq", "template")
      .order("created_at", { ascending: false })
      .limit(DEFAULT_LIMIT);
    if (query) request = request.ilike("title", `%${query}%`);
    const { data, error } = await request;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({
      options: ((data || []) as Array<{ id: string; title: string | null }>).map((row) => ({
        id: row.id,
        label: row.title || "Untitled task",
      })),
    });
  }

  if (normalizedType === "project") {
    let request = supabase
      .from("projects")
      .select("id,name")
      .order("name", { ascending: true })
      .limit(DEFAULT_LIMIT);
    if (query) request = request.ilike("name", `%${query}%`);
    const { data, error } = await request;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({
      options: ((data || []) as Array<{ id: string; name: string | null }>).map((row) => ({
        id: row.id,
        label: row.name || "Untitled project",
      })),
    });
  }

  if (normalizedType === "client") {
    let request = supabase
      .from("clients")
      .select("id,name")
      .order("name", { ascending: true })
      .limit(DEFAULT_LIMIT);
    if (query) request = request.ilike("name", `%${query}%`);
    const { data, error } = await request;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({
      options: ((data || []) as Array<{ id: string; name: string | null }>).map((row) => ({
        id: row.id,
        label: row.name || "Untitled client",
      })),
    });
  }

  if (normalizedType === "feature_suggestion") {
    let request = supabase
      .from("feature_suggestions")
      .select("id,title")
      .order("created_at", { ascending: false })
      .limit(DEFAULT_LIMIT);
    if (query) request = request.ilike("title", `%${query}%`);
    const { data, error } = await request;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({
      options: ((data || []) as Array<{ id: string; title: string | null }>).map((row) => ({
        id: row.id,
        label: row.title || "Untitled feature suggestion",
      })),
    });
  }

  let request = supabase
    .from("notes")
    .select("id,title")
    .order("created_at", { ascending: false })
    .limit(DEFAULT_LIMIT);
  if (query) request = request.ilike("title", `%${query}%`);
  const { data, error } = await request;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    options: ((data || []) as Array<{ id: string; title: string | null }>).map((row) => ({
      id: row.id,
      label: row.title || "Untitled note",
    })),
  });
}

