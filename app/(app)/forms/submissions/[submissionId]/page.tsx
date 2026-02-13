import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  formSubmissionStatusOptions,
  formatFormLabel,
  normalizeSubmissionStatus,
} from "../../types";

export default async function FormSubmissionDetailPage(props: {
  params: Promise<{ submissionId: string }>;
  searchParams?: Promise<{ return_to?: string; error?: string; success?: string }>;
}) {
  const { submissionId } = await props.params;
  const searchParams = await props.searchParams;
  const returnToRaw = String(searchParams?.return_to || "").trim();
  const returnTo = returnToRaw.startsWith("/forms") ? returnToRaw : "/forms";

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const authEmail = authData.user?.email;
  if (!authEmail) {
    redirect("/login");
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("id")
    .eq("email", authEmail)
    .maybeSingle();
  if (!currentUser?.id) {
    redirect("/tasks?error=Missing%20user%20profile");
  }

  const { data: submission, error: submissionError } = await supabase
    .from("form_submissions")
    .select("id,form_id,status,values_json,submitted_by,created_at,updated_at")
    .eq("id", submissionId)
    .maybeSingle();

  if (submissionError) {
    notFound();
  }
  if (!submission) {
    notFound();
  }

  const [{ data: form }, { data: comments }, { data: templateTasks }, { data: actionTasks }, { data: users }] =
    await Promise.all([
      supabase.from("forms").select("id,title").eq("id", submission.form_id).maybeSingle(),
      supabase
        .from("form_submission_comments")
        .select("id,user_id,body,created_at")
        .eq("submission_id", submissionId)
        .order("created_at", { ascending: true }),
      supabase
        .from("form_submission_template_tasks")
        .select("task_id,task_template_id,created_at")
        .eq("submission_id", submissionId)
        .order("created_at", { ascending: true }),
      supabase
        .from("form_submission_action_tasks")
        .select("task_id,action_id,created_at")
        .eq("submission_id", submissionId)
        .order("created_at", { ascending: true }),
      supabase.from("users").select("id,full_name,email"),
    ]);

  const userMap = new Map<string, string>();
  (users || []).forEach((user) => {
    userMap.set(user.id, user.full_name || user.email || "Unknown user");
  });

  const triggeredTasks = [
    ...((templateTasks || []) as Array<{
      task_id: string | null;
      task_template_id: string | null;
      created_at: string;
    }>),
    ...((actionTasks || []) as Array<{
      task_id: string | null;
      action_id: string | null;
      created_at: string;
    }>),
  ];

  const taskIds = triggeredTasks.map((row) => row.task_id).filter(Boolean) as string[];

  const { data: tasks } = taskIds.length
    ? await supabase.from("tasks").select("id,title,status").in("id", taskIds)
    : { data: [] as Array<{ id: string; title: string; status: string | null }> };
  const taskMap = new Map<string, { title: string; status: string | null }>();
  (tasks || []).forEach((task) => {
    taskMap.set(task.id, { title: task.title, status: task.status });
  });

  const detailPath = `/forms/submissions/${submissionId}`;

  async function updateSubmission(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const status = normalizeSubmissionStatus(String(formData.get("status") || "open"));
    const detailParams = new URLSearchParams();
    detailParams.set("return_to", returnTo);

    const { error } = await supabase
      .from("form_submissions")
      .update({ status })
      .eq("id", submissionId);

    if (error) {
      detailParams.set("error", error.message);
      redirect(`${detailPath}?${detailParams.toString()}`);
    }

    revalidatePath(detailPath);
    revalidatePath("/forms");
    detailParams.set("success", "Submission updated");
    redirect(`${detailPath}?${detailParams.toString()}`);
  }

  async function addComment(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const body = String(formData.get("body") || "").trim();
    const detailParams = new URLSearchParams();
    detailParams.set("return_to", returnTo);

    if (!body) {
      detailParams.set("error", "Comment cannot be empty");
      redirect(`${detailPath}?${detailParams.toString()}`);
    }

    const { data: authData } = await supabase.auth.getUser();
    const authEmail = authData.user?.email;
    if (!authEmail) {
      redirect("/login");
    }

    const { data: currentUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", authEmail)
      .maybeSingle();
    if (!currentUser?.id) {
      detailParams.set("error", "Missing user profile");
      redirect(`${detailPath}?${detailParams.toString()}`);
    }

    const { error } = await supabase.from("form_submission_comments").insert({
      submission_id: submissionId,
      user_id: currentUser.id,
      body,
    });

    if (error) {
      detailParams.set("error", error.message);
      redirect(`${detailPath}?${detailParams.toString()}`);
    }

    revalidatePath(detailPath);
    revalidatePath("/forms");
    detailParams.set("success", "Comment added");
    redirect(`${detailPath}?${detailParams.toString()}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Submission</p>
          <h1 className="text-2xl font-semibold text-slate-900">
            {form?.title || "Form"} #{submission.id.slice(0, 8)}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Submitted by {userMap.get(submission.submitted_by || "") || "Unknown user"} on{" "}
            {new Date(submission.created_at).toLocaleString()}
          </p>
        </div>
        <Link
          href={returnTo}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
        >
          Back
        </Link>
      </div>

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

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Submission details</h2>
        </div>
        <div className="space-y-4 px-6 py-4">
          <form action={updateSubmission} className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Status
              <select
                name="status"
                defaultValue={normalizeSubmissionStatus(submission.status)}
                className="mt-1 w-52 rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              >
                {formSubmissionStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {formatFormLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Save status
            </button>
          </form>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Values</p>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
              {JSON.stringify(submission.values_json || {}, null, 2)}
            </pre>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Triggered tasks</h2>
        </div>
        <div className="px-6 py-4">
          {triggeredTasks.length ? (
            <div className="space-y-2">
              {triggeredTasks.map((row, index) => {
                const task = taskMap.get(row.task_id || "");
                return (
                  <p key={`${row.task_id}-${index}`} className="text-sm text-slate-700">
                    <Link href={`/tasks/${row.task_id}`} className="font-semibold hover:underline">
                      {task?.title || row.task_id}
                    </Link>{" "}
                    <span className="text-xs text-slate-500">
                      ({formatFormLabel(String(task?.status || "to_do"))})
                    </span>
                  </p>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No tasks were triggered for this submission.</p>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Comments</h2>
        </div>
        <div className="space-y-4 px-6 py-4">
          <form action={addComment} className="space-y-3">
            <textarea
              name="body"
              rows={3}
              placeholder="Add a comment"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <button
              type="submit"
              className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Add comment
            </button>
          </form>

          <div className="space-y-3">
            {(comments || []).length ? (
              (comments || []).map((comment) => (
                <article key={comment.id} className="rounded-md border border-slate-200 p-3">
                  <p className="text-xs text-slate-500">
                    {userMap.get(comment.user_id) || "Unknown user"} -{" "}
                    {new Date(comment.created_at).toLocaleString()}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{comment.body}</p>
                </article>
              ))
            ) : (
              <p className="text-sm text-slate-500">No comments yet.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
