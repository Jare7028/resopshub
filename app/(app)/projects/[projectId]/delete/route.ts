import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const params = await context.params;
  const projectId = String(params.projectId || "").trim();
  if (!projectId) {
    return NextResponse.redirect(new URL("/projects?error=Missing%20project%20id", req.url));
  }

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authEmail = authData.user?.email;
  if (!authEmail) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("id,role")
    .eq("email", authEmail)
    .maybeSingle();

  const currentUserId = currentUser?.id;
  const isAdmin = currentUser?.role === "admin";
  if (!currentUserId) {
    return NextResponse.redirect(new URL("/projects?error=User%20profile%20missing", req.url));
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id,name,created_by_user_id")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    return NextResponse.redirect(
      new URL(`/projects?error=${encodeURIComponent(projectError.message)}`, req.url)
    );
  }

  if (!project) {
    return NextResponse.redirect(new URL("/projects?error=Project%20not%20found", req.url));
  }

  const canDelete = isAdmin || project.created_by_user_id === currentUserId;
  if (!canDelete) {
    return NextResponse.redirect(new URL("/projects?error=Not%20allowed%20to%20delete%20project", req.url));
  }

  // Delete dependents explicitly so FK constraints don't block deletion.
  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("id")
    .eq("project_id", projectId);

  if (tasksError) {
    return NextResponse.redirect(
      new URL(`/projects/${projectId}?error=${encodeURIComponent(tasksError.message)}`, req.url)
    );
  }

  const taskIds = (tasks || []).map((t) => t.id).filter(Boolean) as string[];

  if (taskIds.length) {
    const { error: assigneesError } = await supabase
      .from("task_assignees")
      .delete()
      .in("task_id", taskIds);
    if (assigneesError) {
      return NextResponse.redirect(
        new URL(`/projects/${projectId}?error=${encodeURIComponent(assigneesError.message)}`, req.url)
      );
    }

    // task_watchers may not exist yet in some environments.
    const { error: taskWatchersError } = await supabase
      .from("task_watchers")
      .delete()
      .in("task_id", taskIds);
    if (taskWatchersError && !isSupabaseMissingTableError(taskWatchersError)) {
      return NextResponse.redirect(
        new URL(`/projects/${projectId}?error=${encodeURIComponent(taskWatchersError.message)}`, req.url)
      );
    }
  }

  // Project-level notes (tasks may have their own notes, but those should be deleted by the notes policy / FK if any).
  const { error: notesError } = await supabase.from("notes").delete().eq("project_id", projectId);
  if (notesError) {
    return NextResponse.redirect(
      new URL(`/projects/${projectId}?error=${encodeURIComponent(notesError.message)}`, req.url)
    );
  }

  const { error: projectUsersError } = await supabase
    .from("project_users")
    .delete()
    .eq("project_id", projectId);
  if (projectUsersError) {
    return NextResponse.redirect(
      new URL(`/projects/${projectId}?error=${encodeURIComponent(projectUsersError.message)}`, req.url)
    );
  }

  const { error: projectWatchersError } = await supabase
    .from("project_watchers")
    .delete()
    .eq("project_id", projectId);
  if (projectWatchersError && !isSupabaseMissingTableError(projectWatchersError)) {
    return NextResponse.redirect(
      new URL(`/projects/${projectId}?error=${encodeURIComponent(projectWatchersError.message)}`, req.url)
    );
  }

  const { error: tasksDeleteError } = await supabase.from("tasks").delete().eq("project_id", projectId);
  if (tasksDeleteError) {
    return NextResponse.redirect(
      new URL(`/projects/${projectId}?error=${encodeURIComponent(tasksDeleteError.message)}`, req.url)
    );
  }

  const { error: deleteError } = await supabase.from("projects").delete().eq("id", projectId);
  if (deleteError) {
    return NextResponse.redirect(
      new URL(`/projects/${projectId}?error=${encodeURIComponent(deleteError.message)}`, req.url)
    );
  }

  return NextResponse.redirect(new URL("/projects?success=Project%20deleted", req.url));
}

