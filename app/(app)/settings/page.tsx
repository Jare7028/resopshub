import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ConfirmSubmitButton from "../_components/ConfirmSubmitButton";
import SettingsTabs, {
  normalizeSettingsTabKey,
} from "./_components/SettingsTabs";

export const dynamic = "force-dynamic";

type NotificationPrefsDbRow = {
  user_id: string;
  task_assigned: boolean | null;
  task_updated: boolean | null;
  task_due_today: boolean | null;
  task_overdue: boolean | null;
  feature_suggestion_comment: boolean | null;
  feature_suggestion_status: boolean | null;
};

type NotificationPrefs = {
  user_id: string;
  task_assigned: boolean;
  task_updated: boolean;
  task_due_today: boolean;
  task_overdue: boolean;
  feature_suggestion_comment: boolean;
  feature_suggestion_status: boolean;
};

const defaultPrefs: Omit<NotificationPrefs, "user_id"> = {
  task_assigned: true,
  task_updated: true,
  task_due_today: true,
  task_overdue: true,
  feature_suggestion_comment: true,
  feature_suggestion_status: true,
};

function checkbox(formData: FormData, key: string) {
  return String(formData.get(key) || "") === "on";
}

function prefValue(value: boolean | null | undefined, fallback: boolean): boolean {
  return value === false ? false : value === true ? true : fallback;
}

export default async function SettingsPage(props: {
  searchParams?: Promise<{
    tab?: string;
    templates?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const activeTab = normalizeSettingsTabKey(searchParams?.tab);
  const templatesTabRaw = String(searchParams?.templates || "")
    .trim()
    .toLowerCase();
  const templatesTab: "tasks" | "projects" =
    templatesTabRaw === "projects" ? "projects" : "tasks";

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id,email,full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/dashboard?error=Missing%20profile");
  }

  const { data: prefsRaw } = await supabase
    .from("user_notification_preferences")
    .select(
      "user_id,task_assigned,task_updated,task_due_today,task_overdue,feature_suggestion_comment,feature_suggestion_status"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const prefsDb = (prefsRaw || null) as NotificationPrefsDbRow | null;
  const prefs: NotificationPrefs = {
    user_id: user.id,
    task_assigned: prefValue(prefsDb?.task_assigned, defaultPrefs.task_assigned),
    task_updated: prefValue(prefsDb?.task_updated, defaultPrefs.task_updated),
    task_due_today: prefValue(prefsDb?.task_due_today, defaultPrefs.task_due_today),
    task_overdue: prefValue(prefsDb?.task_overdue, defaultPrefs.task_overdue),
    feature_suggestion_comment: prefValue(
      prefsDb?.feature_suggestion_comment,
      defaultPrefs.feature_suggestion_comment
    ),
    feature_suggestion_status: prefValue(
      prefsDb?.feature_suggestion_status,
      defaultPrefs.feature_suggestion_status
    ),
  };

  type TaskTemplateRow = {
    id: string;
    name: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_time: string | null;
    recurrence_frequency: string | null;
    recurrence_lead_days: number | null;
  };

  type ProjectTemplateRow = {
    id: string;
    name: string;
    description: string | null;
    status: string;
  };

  const { data: taskTemplatesRaw, error: taskTemplatesError } = await supabase
    .from("task_templates")
    .select(
      "id,name,title,description,status,priority,due_time,recurrence_frequency,recurrence_lead_days"
    )
    .order("name", { ascending: true });

  const { data: projectTemplatesRaw, error: projectTemplatesError } = await supabase
    .from("project_templates")
    .select("id,name,description,status")
    .order("name", { ascending: true });

  const taskTemplates = (taskTemplatesError ? [] : taskTemplatesRaw || []) as TaskTemplateRow[];
  const projectTemplates = (projectTemplatesError ? [] : projectTemplatesRaw || []) as ProjectTemplateRow[];

  async function updateProfile(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;
    if (!user) redirect("/login");

    const fullName = String(formData.get("full_name") || "").trim();
    if (fullName.length < 2) {
      redirect("/settings?error=Name%20is%20too%20short");
    }
    if (fullName.length > 80) {
      redirect("/settings?error=Name%20is%20too%20long");
    }

    const { error } = await supabase
      .from("users")
      .update({ full_name: fullName })
      .eq("id", user.id);

    if (error) {
      redirect(`/settings?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/settings");
    revalidatePath("/dashboard");
    redirect("/settings?success=Profile%20updated");
  }

  async function updateNotificationPrefs(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;
    if (!user) redirect("/login");

    const next = {
      user_id: user.id,
      task_assigned: checkbox(formData, "task_assigned"),
      task_updated: checkbox(formData, "task_updated"),
      task_due_today: checkbox(formData, "task_due_today"),
      task_overdue: checkbox(formData, "task_overdue"),
      feature_suggestion_comment: checkbox(formData, "feature_suggestion_comment"),
      feature_suggestion_status: checkbox(formData, "feature_suggestion_status"),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("user_notification_preferences")
      .upsert(next, { onConflict: "user_id" });

    if (error) {
      redirect(
        `/settings?tab=notifications&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/settings");
    redirect("/settings?tab=notifications&success=Preferences%20saved");
  }

  async function createTaskTemplate(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) redirect("/login");

    const name = String(formData.get("name") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const status = String(formData.get("status") || "to_do").trim();
    const priority = String(formData.get("priority") || "medium").trim();
    const dueTime = String(formData.get("due_time") || "").trim();
    const recurrenceFrequency = String(formData.get("recurrence_frequency") || "").trim();
    const recurrenceLeadDays = Number(formData.get("recurrence_lead_days") || 7) || 7;

    if (!name || !title) {
      redirect("/settings?tab=templates&error=Template%20name%20and%20task%20title%20are%20required");
    }

    const { error } = await supabase.from("task_templates").insert({
      name,
      title,
      description: description || null,
      status,
      priority,
      due_time: dueTime || null,
      recurrence_frequency: recurrenceFrequency || null,
      recurrence_lead_days: recurrenceLeadDays,
    });

    if (error) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/settings");
    redirect("/settings?tab=templates&templates=tasks&success=Task%20template%20created");
  }

  async function updateTaskTemplate(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) redirect("/login");

    const id = String(formData.get("id") || "").trim();
    const name = String(formData.get("name") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const status = String(formData.get("status") || "to_do").trim();
    const priority = String(formData.get("priority") || "medium").trim();
    const dueTime = String(formData.get("due_time") || "").trim();
    const recurrenceFrequency = String(formData.get("recurrence_frequency") || "").trim();
    const recurrenceLeadDays = Number(formData.get("recurrence_lead_days") || 7) || 7;

    if (!id) {
      redirect("/settings?tab=templates&templates=tasks&error=Missing%20template%20id");
    }

    const { error } = await supabase
      .from("task_templates")
      .update({
        name,
        title,
        description: description || null,
        status,
        priority,
        due_time: dueTime || null,
        recurrence_frequency: recurrenceFrequency || null,
        recurrence_lead_days: recurrenceLeadDays,
      })
      .eq("id", id);

    if (error) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/settings");
    redirect("/settings?tab=templates&templates=tasks&success=Task%20template%20updated");
  }

  async function deleteTaskTemplate(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) redirect("/login");

    const id = String(formData.get("id") || "").trim();
    if (!id) {
      redirect("/settings?tab=templates&templates=tasks&error=Missing%20template%20id");
    }

    const { error } = await supabase.from("task_templates").delete().eq("id", id);

    if (error) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/settings");
    redirect("/settings?tab=templates&templates=tasks&success=Task%20template%20deleted");
  }

  async function createProjectTemplate(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) redirect("/login");

    const name = String(formData.get("name") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const status = String(formData.get("status") || "planned").trim();

    if (!name) {
      redirect("/settings?tab=templates&templates=projects&error=Template%20name%20is%20required");
    }

    const { error } = await supabase.from("project_templates").insert({
      name,
      description: description || null,
      status,
    });

    if (error) {
      redirect(
        `/settings?tab=templates&templates=projects&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/settings");
    redirect("/settings?tab=templates&templates=projects&success=Project%20template%20created");
  }

  async function updateProjectTemplate(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) redirect("/login");

    const id = String(formData.get("id") || "").trim();
    const name = String(formData.get("name") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const status = String(formData.get("status") || "planned").trim();

    if (!id) {
      redirect("/settings?tab=templates&templates=projects&error=Missing%20template%20id");
    }

    const { error } = await supabase
      .from("project_templates")
      .update({
        name,
        description: description || null,
        status,
      })
      .eq("id", id);

    if (error) {
      redirect(
        `/settings?tab=templates&templates=projects&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/settings");
    redirect("/settings?tab=templates&templates=projects&success=Project%20template%20updated");
  }

  async function deleteProjectTemplate(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) redirect("/login");

    const id = String(formData.get("id") || "").trim();
    if (!id) {
      redirect("/settings?tab=templates&templates=projects&error=Missing%20template%20id");
    }

    const { error } = await supabase.from("project_templates").delete().eq("id", id);

    if (error) {
      redirect(
        `/settings?tab=templates&templates=projects&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/settings");
    redirect("/settings?tab=templates&templates=projects&success=Project%20template%20deleted");
  }

  const renderMessage = (value: string | undefined, kind: "error" | "success") => {
    if (!value) return null;
    if (kind === "error") {
      return (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {value}
        </p>
      );
    }
    return (
      <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
        {value}
      </p>
    );
  };

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
          <p className="text-sm text-slate-600">
            Update your profile and choose which alerts you receive.
          </p>
        </div>
      </section>

      {renderMessage(searchParams?.error, "error")}
      {renderMessage(searchParams?.success, "success")}

      <SettingsTabs active={activeTab} />

      {activeTab === "profile" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Profile</h2>
          </div>
          <div className="p-6">
            <form action={updateProfile} className="grid gap-4 md:max-w-xl">
              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Full name
                </span>
                <input
                  name="full_name"
                  defaultValue={profile.full_name || ""}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Your name"
                  required
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Email
                </span>
                <input
                  value={profile.email || ""}
                  className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                  readOnly
                />
              </label>

              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </section>
      ) : null}

      {activeTab === "notifications" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Notifications</h2>
            <p className="mt-1 text-sm text-slate-600">
              In-app alerts only. You won’t receive emails.
            </p>
          </div>
          <div className="p-6">
            <form action={updateNotificationPrefs} className="space-y-8">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Tasks</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="task_assigned"
                      defaultChecked={prefs.task_assigned}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Assigned to me
                      </span>
                      <span className="block text-slate-600">
                        Get notified when a task is assigned to you.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="task_updated"
                      defaultChecked={prefs.task_updated}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Task updated
                      </span>
                      <span className="block text-slate-600">
                        Get notified when your assigned task changes.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="task_due_today"
                      defaultChecked={prefs.task_due_today}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Due today
                      </span>
                      <span className="block text-slate-600">
                        Daily reminder for tasks due today.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="task_overdue"
                      defaultChecked={prefs.task_overdue}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Overdue
                      </span>
                      <span className="block text-slate-600">
                        Daily reminder for overdue tasks.
                      </span>
                    </span>
                  </label>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Feature suggestions
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="feature_suggestion_comment"
                      defaultChecked={prefs.feature_suggestion_comment}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Comment on my idea
                      </span>
                      <span className="block text-slate-600">
                        Get notified when someone comments on your suggestion.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name="feature_suggestion_status"
                      defaultChecked={prefs.feature_suggestion_status}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        Status change
                      </span>
                      <span className="block text-slate-600">
                        Get notified when your suggestion status changes.
                      </span>
                    </span>
                  </label>
                </div>
              </section>

              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  Save preferences
                </button>
              </div>
            </form>
          </div>
        </section>
      ) : null}

      {activeTab === "templates" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Templates</h2>
            <p className="mt-1 text-sm text-slate-600">
              Company-wide templates. Anyone can create or edit.
            </p>
          </div>
          <div className="p-6 space-y-6">
            {taskTemplatesError || projectTemplatesError ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold">Templates are not set up yet.</p>
                <p className="mt-1">
                  Run the SQL script `sql/templates.sql` in Supabase SQL editor,
                  then refresh this page.
                </p>
              </div>
            ) : null}

            <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 text-sm">
              <a
                href="/settings?tab=templates&templates=tasks"
                className={`rounded-md px-3 py-1.5 font-medium ${
                  templatesTab === "tasks"
                    ? "tab-active"
                    : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                Task templates
              </a>
              <a
                href="/settings?tab=templates&templates=projects"
                className={`rounded-md px-3 py-1.5 font-medium ${
                  templatesTab === "projects"
                    ? "tab-active"
                    : "border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                Project templates
              </a>
            </nav>

            {templatesTab === "tasks" ? (
              <div className="space-y-6">
                <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Create task template
                  </h3>
                  <form action={createTaskTemplate} className="mt-3 grid gap-3 md:grid-cols-6">
                    <input
                      name="name"
                      placeholder="Template name"
                      className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      required
                    />
                    <input
                      name="title"
                      placeholder="Default task title"
                      className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      required
                    />
                    <select
                      name="status"
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      defaultValue="to_do"
                    >
                      {["to_do","in_progress","blocked","completed","cancelled"].map((status) => (
                        <option key={status} value={status}>
                          {status.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                    <select
                      name="priority"
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      defaultValue="medium"
                    >
                      {["low","medium","high","critical"].map((priority) => (
                        <option key={priority} value={priority}>
                          {priority}
                        </option>
                      ))}
                    </select>

                    <input
                      name="description"
                      placeholder="Description (optional)"
                      className="md:col-span-4 rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input
                      type="time"
                      name="due_time"
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      defaultValue="09:00"
                    />
                    <select
                      name="recurrence_frequency"
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      defaultValue=""
                    >
                      <option value="">Frequency: Once</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      name="recurrence_lead_days"
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      defaultValue={7}
                    />

                    <button
                      type="submit"
                      className="md:col-span-6 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                      disabled={Boolean(taskTemplatesError)}
                    >
                      Create template
                    </button>
                  </form>
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Existing task templates
                  </h3>
                  {!taskTemplates.length ? (
                    <p className="text-sm text-slate-600">No templates yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {taskTemplates.map((tpl) => (
                        <div
                          key={tpl.id}
                          className="rounded-md border border-slate-200 bg-white p-4"
                        >
                          <form action={updateTaskTemplate} className="grid gap-3 md:grid-cols-6">
                            <input type="hidden" name="id" value={tpl.id} />
                            <input
                              name="name"
                              defaultValue={tpl.name}
                              className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                              required
                            />
                            <input
                              name="title"
                              defaultValue={tpl.title}
                              className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                              required
                            />
                            <select
                              name="status"
                              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                              defaultValue={tpl.status || "to_do"}
                            >
                              {["to_do","in_progress","blocked","completed","cancelled"].map((status) => (
                                <option key={status} value={status}>
                                  {status.replace("_", " ")}
                                </option>
                              ))}
                            </select>
                            <select
                              name="priority"
                              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                              defaultValue={tpl.priority || "medium"}
                            >
                              {["low","medium","high","critical"].map((priority) => (
                                <option key={priority} value={priority}>
                                  {priority}
                                </option>
                              ))}
                            </select>
                            <input
                              name="description"
                              defaultValue={tpl.description || ""}
                              className="md:col-span-4 rounded-md border border-slate-300 px-3 py-2 text-sm"
                            />
                            <input
                              type="time"
                              name="due_time"
                              defaultValue={tpl.due_time || ""}
                              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                            />
                            <select
                              name="recurrence_frequency"
                              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                              defaultValue={tpl.recurrence_frequency || ""}
                            >
                              <option value="">Frequency: Once</option>
                              <option value="daily">Daily</option>
                              <option value="weekly">Weekly</option>
                              <option value="monthly">Monthly</option>
                              <option value="yearly">Yearly</option>
                            </select>
                            <input
                              type="number"
                              min="0"
                              name="recurrence_lead_days"
                              defaultValue={tpl.recurrence_lead_days ?? 7}
                              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                            />

                            <div className="md:col-span-6 flex flex-wrap items-center justify-end gap-2">
                              <button
                                type="submit"
                                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                              >
                                Save
                              </button>
                            </div>
                          </form>
                          <form action={deleteTaskTemplate} className="mt-2 flex justify-end">
                            <input type="hidden" name="id" value={tpl.id} />
                            <ConfirmSubmitButton
                              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                              confirmText={`Delete template: ${tpl.name}?`}
                            >
                              Delete
                            </ConfirmSubmitButton>
                          </form>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : null}

            {templatesTab === "projects" ? (
              <div className="space-y-6">
                <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Create project template
                  </h3>
                  <form action={createProjectTemplate} className="mt-3 grid gap-3 md:grid-cols-6">
                    <input
                      name="name"
                      placeholder="Template name"
                      className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      required
                    />
                    <select
                      name="status"
                      className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      defaultValue="planned"
                    >
                      {["planned","active","on_hold","completed","cancelled"].map((status) => (
                        <option key={status} value={status}>
                          {status.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                    <input
                      name="description"
                      placeholder="Description (optional)"
                      className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      className="md:col-span-6 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                      disabled={Boolean(projectTemplatesError)}
                    >
                      Create template
                    </button>
                  </form>
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Existing project templates
                  </h3>
                  {!projectTemplates.length ? (
                    <p className="text-sm text-slate-600">No templates yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {projectTemplates.map((tpl) => (
                        <div
                          key={tpl.id}
                          className="rounded-md border border-slate-200 bg-white p-4"
                        >
                          <form action={updateProjectTemplate} className="grid gap-3 md:grid-cols-6">
                            <input type="hidden" name="id" value={tpl.id} />
                            <input
                              name="name"
                              defaultValue={tpl.name}
                              className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                              required
                            />
                            <select
                              name="status"
                              className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                              defaultValue={tpl.status || "planned"}
                            >
                              {["planned","active","on_hold","completed","cancelled"].map((status) => (
                                <option key={status} value={status}>
                                  {status.replace("_", " ")}
                                </option>
                              ))}
                            </select>
                            <input
                              name="description"
                              defaultValue={tpl.description || ""}
                              className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                            />

                            <div className="md:col-span-6 flex flex-wrap items-center justify-end gap-2">
                              <button
                                type="submit"
                                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                              >
                                Save
                              </button>
                            </div>
                          </form>

                          <form action={deleteProjectTemplate} className="mt-2 flex justify-end">
                            <input type="hidden" name="id" value={tpl.id} />
                            <ConfirmSubmitButton
                              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                              confirmText={`Delete template: ${tpl.name}?`}
                            >
                              Delete
                            </ConfirmSubmitButton>
                          </form>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
