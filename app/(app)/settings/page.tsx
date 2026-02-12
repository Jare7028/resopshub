import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMissingTableError } from "@/lib/supabaseErrors";
import ConfirmSubmitButton from "../_components/ConfirmSubmitButton";
import AssigneeMultiSelect from "../tasks/_components/AssigneeMultiSelect";
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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export default async function SettingsPage(props: {
  searchParams?: Promise<{
    tab?: string;
    templates?: string;
    task_template_id?: string;
    project_template_id?: string;
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
  const selectedTaskTemplateId = String(searchParams?.task_template_id || "").trim();
  const selectedProjectTemplateId = String(searchParams?.project_template_id || "").trim();

  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id,email,full_name,role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/dashboard?error=Missing%20profile");
  }

  const { data: usersRaw } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });
  const users = usersRaw || [];
  const userNameById = users.reduce<Record<string, string>>((acc, row) => {
    acc[row.id] = row.full_name || row.email || "Unknown user";
    return acc;
  }, {});

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
  const selectedTaskTemplate =
    selectedTaskTemplateId && templatesTab === "tasks"
      ? taskTemplates.find((tpl) => tpl.id === selectedTaskTemplateId) || null
      : null;
  const selectedProjectTemplate =
    selectedProjectTemplateId && templatesTab === "projects"
      ? projectTemplates.find((tpl) => tpl.id === selectedProjectTemplateId) || null
      : null;

  type TaskTemplateSubtaskRow = {
    id: string;
    task_template_id: string;
    position: number;
    title: string;
    description: string | null;
    status: string;
    priority: string;
  };

  type ProjectTemplateTaskRow = {
    id: string;
    project_template_id: string;
    task_template_id: string;
    position: number;
  };

  type TaskTemplateAssigneeRow = {
    task_template_id: string;
    user_id: string;
  };
  type TaskTemplateSubtaskAssigneeRow = {
    task_template_subtask_id: string;
    user_id: string;
  };

  const {
    data: taskTemplateSubtasksRaw,
    error: taskTemplateSubtasksError,
  } = await supabase
    .from("task_template_subtasks")
    .select("id,task_template_id,position,title,description,status,priority")
    .order("task_template_id", { ascending: true })
    .order("position", { ascending: true });

  const { data: projectTemplateTasksRaw, error: projectTemplateTasksError } = await supabase
    .from("project_template_tasks")
    .select("id,project_template_id,task_template_id,position")
    .order("project_template_id", { ascending: true })
    .order("position", { ascending: true });

  const { data: taskTemplateAssigneesRaw, error: taskTemplateAssigneesError } = await supabase
    .from("task_template_assignees")
    .select("task_template_id,user_id")
    .order("created_at", { ascending: true });
  const {
    data: taskTemplateSubtaskAssigneesRaw,
    error: taskTemplateSubtaskAssigneesError,
  } = await supabase
    .from("task_template_subtask_assignees")
    .select("task_template_subtask_id,user_id")
    .order("created_at", { ascending: true });

  const taskTemplateSubtasks = (taskTemplateSubtasksError
    ? []
    : taskTemplateSubtasksRaw || []) as TaskTemplateSubtaskRow[];

  const projectTemplateTasks = (projectTemplateTasksError
    ? []
    : projectTemplateTasksRaw || []) as ProjectTemplateTaskRow[];
  const taskTemplateAssignees = (taskTemplateAssigneesError
    ? []
    : taskTemplateAssigneesRaw || []) as TaskTemplateAssigneeRow[];
  const taskTemplateSubtaskAssignees = (taskTemplateSubtaskAssigneesError
    ? []
    : taskTemplateSubtaskAssigneesRaw || []) as TaskTemplateSubtaskAssigneeRow[];

  const subtasksByTemplateId = taskTemplateSubtasks.reduce<Record<string, TaskTemplateSubtaskRow[]>>(
    (acc, row) => {
      acc[row.task_template_id] ||= [];
      acc[row.task_template_id].push(row);
      return acc;
    },
    {}
  );

  const tasksByProjectTemplateId = projectTemplateTasks.reduce<Record<string, ProjectTemplateTaskRow[]>>(
    (acc, row) => {
      acc[row.project_template_id] ||= [];
      acc[row.project_template_id].push(row);
      return acc;
    },
    {}
  );

  const assigneeIdsByTaskTemplateId = taskTemplateAssignees.reduce<Record<string, string[]>>(
    (acc, row) => {
      acc[row.task_template_id] ||= [];
      acc[row.task_template_id].push(row.user_id);
      return acc;
    },
    {}
  );
  const assigneeIdsByTaskTemplateSubtaskId = taskTemplateSubtaskAssignees.reduce<
    Record<string, string[]>
  >((acc, row) => {
    acc[row.task_template_subtask_id] ||= [];
    acc[row.task_template_subtask_id].push(row.user_id);
    return acc;
  }, {});

  const taskTemplateById = taskTemplates.reduce<Record<string, TaskTemplateRow>>((acc, tpl) => {
    acc[tpl.id] = tpl;
    return acc;
  }, {});
  const selectedTaskTemplateAssigneeIds = selectedTaskTemplate
    ? assigneeIdsByTaskTemplateId[selectedTaskTemplate.id] || []
    : [];

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
    const assigneeIds = Array.from(
      new Set(
        formData
          .getAll("assignee_user_ids")
          .map((value) => String(value).trim())
          .filter((value) => isUuid(value))
      )
    );

    if (!name || !title) {
      redirect("/settings?tab=templates&error=Template%20name%20and%20task%20title%20are%20required");
    }

    const { data: created, error } = await supabase
      .from("task_templates")
      .insert({
        name,
        title,
        description: description || null,
        status,
        priority,
        due_time: dueTime || null,
        recurrence_frequency: null,
        recurrence_lead_days: 7,
      })
      .select("id")
      .single();

    if (error) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(error.message)}`
      );
    }

    if (created?.id && assigneeIds.length) {
      const { error: assigneeError } = await supabase
        .from("task_template_assignees")
        .insert(
          assigneeIds.map((userId) => ({
            task_template_id: created.id,
            user_id: userId,
          }))
        );

      if (assigneeError) {
        const message = isSupabaseMissingTableError(assigneeError)
          ? "Run sql/templates.sql to enable template assignees."
          : assigneeError.message;
        redirect(
          `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
            created.id
          )}&error=${encodeURIComponent(message)}`
        );
      }
    }

    revalidatePath("/settings");
    const nextId = created?.id ? `&task_template_id=${encodeURIComponent(created.id)}` : "";
    redirect(
      `/settings?tab=templates&templates=tasks${nextId}&success=Task%20template%20created`
    );
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
    const assigneeIds = Array.from(
      new Set(
        formData
          .getAll("assignee_user_ids")
          .map((value) => String(value).trim())
          .filter((value) => isUuid(value))
      )
    );

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
        recurrence_frequency: null,
        recurrence_lead_days: 7,
      })
      .eq("id", id);

    if (error) {
      redirect(
        `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
          id
        )}&error=${encodeURIComponent(error.message)}`
      );
    }

    const { error: clearAssigneesError } = await supabase
      .from("task_template_assignees")
      .delete()
      .eq("task_template_id", id);
    if (clearAssigneesError) {
      const message = isSupabaseMissingTableError(clearAssigneesError)
        ? "Run sql/templates.sql to enable template assignees."
        : clearAssigneesError.message;
      redirect(
        `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
          id
        )}&error=${encodeURIComponent(message)}`
      );
    }

    if (assigneeIds.length) {
      const { error: assigneeError } = await supabase
        .from("task_template_assignees")
        .insert(
          assigneeIds.map((userId) => ({
            task_template_id: id,
            user_id: userId,
          }))
        );

      if (assigneeError) {
        const message = isSupabaseMissingTableError(assigneeError)
          ? "Run sql/templates.sql to enable template assignees."
          : assigneeError.message;
        redirect(
          `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
            id
          )}&error=${encodeURIComponent(message)}`
        );
      }
    }

    revalidatePath("/settings");
    redirect(
      `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
        id
      )}&success=Task%20template%20updated`
    );
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

    const { data: created, error } = await supabase
      .from("project_templates")
      .insert({
        name,
        description: description || null,
        status,
      })
      .select("id")
      .single();

    if (error) {
      redirect(
        `/settings?tab=templates&templates=projects&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/settings");
    const nextId = created?.id ? `&project_template_id=${encodeURIComponent(created.id)}` : "";
    redirect(
      `/settings?tab=templates&templates=projects${nextId}&success=Project%20template%20created`
    );
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
        `/settings?tab=templates&templates=projects&project_template_id=${encodeURIComponent(
          id
        )}&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/settings");
    redirect(
      `/settings?tab=templates&templates=projects&project_template_id=${encodeURIComponent(
        id
      )}&success=Project%20template%20updated`
    );
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

  async function createTaskTemplateSubtask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) redirect("/login");

    const taskTemplateId = String(formData.get("task_template_id") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const status = String(formData.get("status") || "to_do").trim();
    const priority = String(formData.get("priority") || "medium").trim();
    const assigneeIds = Array.from(
      new Set(
        formData
          .getAll("assignee_user_ids")
          .map((value) => String(value).trim())
          .filter((value) => isUuid(value))
      )
    );

    if (!taskTemplateId || !title) {
      redirect(
        "/settings?tab=templates&templates=tasks&error=Template%20and%20subtask%20title%20are%20required"
      );
    }

    const { data: last } = await supabase
      .from("task_template_subtasks")
      .select("position")
      .eq("task_template_id", taskTemplateId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextPosition = (Number(last?.position) || 0) + 1;

    const { data: createdSubtask, error } = await supabase
      .from("task_template_subtasks")
      .insert({
        task_template_id: taskTemplateId,
        position: nextPosition,
        title,
        description: description || null,
        status,
        priority,
      })
      .select("id")
      .single();

    if (error) {
      const hint = isSupabaseMissingTableError(error)
        ? " Run `sql/templates.sql` in Supabase SQL editor, then refresh."
        : "";
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(
          `${error.message}${hint}`
        )}`
      );
    }
    if (createdSubtask?.id && assigneeIds.length) {
      const { error: assigneeError } = await supabase
        .from("task_template_subtask_assignees")
        .insert(
          assigneeIds.map((userId) => ({
            task_template_subtask_id: createdSubtask.id,
            user_id: userId,
          }))
        );
      if (assigneeError) {
        const message = isSupabaseMissingTableError(assigneeError)
          ? "Run sql/templates.sql to enable subtask template assignees."
          : assigneeError.message;
        redirect(
          `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
            taskTemplateId
          )}&error=${encodeURIComponent(message)}`
        );
      }
    }

    revalidatePath("/settings");
    redirect(
      `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
        taskTemplateId
      )}&success=Subtask%20added`
    );
  }

  async function deleteTaskTemplateSubtask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) redirect("/login");

    const id = String(formData.get("id") || "").trim();
    const taskTemplateId = String(formData.get("task_template_id") || "").trim();
    if (!id) {
      redirect("/settings?tab=templates&templates=tasks&error=Missing%20subtask%20id");
    }

    const { error } = await supabase.from("task_template_subtasks").delete().eq("id", id);

    if (error) {
      redirect(
        `/settings?tab=templates&templates=tasks&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/settings");
    const nextId = taskTemplateId
      ? `&task_template_id=${encodeURIComponent(taskTemplateId)}`
      : "";
    redirect(`/settings?tab=templates&templates=tasks${nextId}&success=Subtask%20deleted`);
  }

  async function updateTaskTemplateSubtask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) redirect("/login");

    const id = String(formData.get("id") || "").trim();
    const taskTemplateId = String(formData.get("task_template_id") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const status = String(formData.get("status") || "to_do").trim();
    const priority = String(formData.get("priority") || "medium").trim();
    const assigneeIds = Array.from(
      new Set(
        formData
          .getAll("assignee_user_ids")
          .map((value) => String(value).trim())
          .filter((value) => isUuid(value))
      )
    );

    if (!id || !taskTemplateId || !title) {
      redirect(
        "/settings?tab=templates&templates=tasks&error=Subtask%20id,%20template%20id,%20and%20title%20are%20required"
      );
    }

    const { error } = await supabase
      .from("task_template_subtasks")
      .update({
        title,
        description: description || null,
        status,
        priority,
      })
      .eq("id", id)
      .eq("task_template_id", taskTemplateId);

    if (error) {
      redirect(
        `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
          taskTemplateId
        )}&error=${encodeURIComponent(error.message)}`
      );
    }

    const { error: clearAssigneesError } = await supabase
      .from("task_template_subtask_assignees")
      .delete()
      .eq("task_template_subtask_id", id);

    if (clearAssigneesError && !isSupabaseMissingTableError(clearAssigneesError)) {
      redirect(
        `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
          taskTemplateId
        )}&error=${encodeURIComponent(clearAssigneesError.message)}`
      );
    }

    if (assigneeIds.length) {
      if (clearAssigneesError && isSupabaseMissingTableError(clearAssigneesError)) {
        redirect(
          `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
            taskTemplateId
          )}&error=${encodeURIComponent(
            "Run sql/templates.sql to enable subtask template assignees."
          )}`
        );
      }

      const { error: assigneeError } = await supabase
        .from("task_template_subtask_assignees")
        .insert(
          assigneeIds.map((userId) => ({
            task_template_subtask_id: id,
            user_id: userId,
          }))
        );
      if (assigneeError) {
        const message = isSupabaseMissingTableError(assigneeError)
          ? "Run sql/templates.sql to enable subtask template assignees."
          : assigneeError.message;
        redirect(
          `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
            taskTemplateId
          )}&error=${encodeURIComponent(message)}`
        );
      }
    }

    revalidatePath("/settings");
    redirect(
      `/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
        taskTemplateId
      )}&success=Subtask%20updated`
    );
  }

  async function addProjectTemplateTask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) redirect("/login");

    const projectTemplateId = String(formData.get("project_template_id") || "").trim();
    const taskTemplateId = String(formData.get("task_template_id") || "").trim();

    if (!projectTemplateId || !taskTemplateId) {
      redirect(
        "/settings?tab=templates&templates=projects&error=Project%20template%20and%20task%20template%20are%20required"
      );
    }

    const { data: last } = await supabase
      .from("project_template_tasks")
      .select("position")
      .eq("project_template_id", projectTemplateId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextPosition = (Number(last?.position) || 0) + 1;

    const { error } = await supabase.from("project_template_tasks").insert({
      project_template_id: projectTemplateId,
      task_template_id: taskTemplateId,
      position: nextPosition,
    });

    if (error) {
      const hint = isSupabaseMissingTableError(error)
        ? " Run `sql/templates.sql` in Supabase SQL editor, then refresh."
        : "";
      redirect(
        `/settings?tab=templates&templates=projects&error=${encodeURIComponent(
          `${error.message}${hint}`
        )}`
      );
    }

    revalidatePath("/settings");
    redirect(
      `/settings?tab=templates&templates=projects&project_template_id=${encodeURIComponent(
        projectTemplateId
      )}&success=Task%20added%20to%20project%20template`
    );
  }

  async function removeProjectTemplateTask(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) redirect("/login");

    const id = String(formData.get("id") || "").trim();
    const projectTemplateId = String(formData.get("project_template_id") || "").trim();
    if (!id) {
      redirect("/settings?tab=templates&templates=projects&error=Missing%20link%20id");
    }

    const { error } = await supabase.from("project_template_tasks").delete().eq("id", id);

    if (error) {
      redirect(
        `/settings?tab=templates&templates=projects&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/settings");
    const nextId = projectTemplateId
      ? `&project_template_id=${encodeURIComponent(projectTemplateId)}`
      : "";
    redirect(
      `/settings?tab=templates&templates=projects${nextId}&success=Task%20removed%20from%20project%20template`
    );
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

      <SettingsTabs active={activeTab} showAdminLink={profile.role === "admin"} />

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
            {taskTemplateAssigneesError &&
            isSupabaseMissingTableError(taskTemplateAssigneesError) ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Task template assignees are not set up yet. Re-run `sql/templates.sql` in
                Supabase SQL editor, then refresh this page.
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
                    <div className="md:col-span-6 relative">
                      <AssigneeMultiSelect users={users} name="assignee_user_ids" />
                    </div>

                    <button
                      type="submit"
                      className="md:col-span-6 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
                      disabled={Boolean(taskTemplatesError) || Boolean(taskTemplateAssigneesError)}
                    >
                      Create template
                    </button>
                  </form>
                </section>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900">Existing task templates</h3>

                  {!taskTemplates.length ? (
                    <p className="text-sm text-slate-600">No templates yet.</p>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-white">
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                            <tr>
                              <th className="px-6 py-3">Template</th>
                              <th className="px-6 py-3">Default title</th>
                              <th className="px-6 py-3">Status</th>
                              <th className="px-6 py-3">Priority</th>
                              <th className="px-6 py-3">Recurrence</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {taskTemplates.map((tpl) => {
                              const isSelected = tpl.id === selectedTaskTemplateId;
                              const recurrenceLabel = tpl.recurrence_frequency
                                ? tpl.recurrence_frequency
                                : "once";
                              const leadDays =
                                typeof tpl.recurrence_lead_days === "number"
                                  ? tpl.recurrence_lead_days
                                  : 7;
                              return (
                                <tr
                                  key={tpl.id}
                                  className={isSelected ? "bg-slate-50" : "hover:bg-slate-50"}
                                >
                                  <td className="px-6 py-3 font-semibold text-slate-900">
                                    <a
                                      className="underline-offset-2 hover:underline"
                                      href={`/settings?tab=templates&templates=tasks&task_template_id=${encodeURIComponent(
                                        tpl.id
                                      )}`}
                                    >
                                      {tpl.name}
                                    </a>
                                  </td>
                                  <td className="px-6 py-3 text-slate-700">{tpl.title}</td>
                                  <td className="px-6 py-3 text-slate-700">
                                    {tpl.status?.replace("_", " ")}
                                  </td>
                                  <td className="px-6 py-3 text-slate-700">{tpl.priority}</td>
                                  <td className="px-6 py-3 text-slate-700">
                                    {recurrenceLabel}
                                    {tpl.recurrence_frequency ? ` (lead ${leadDays}d)` : ""}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {selectedTaskTemplate ? (
                    <div className="rounded-lg border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                            Task template
                          </p>
                          <h4 className="truncate text-lg font-semibold text-slate-900">
                            {selectedTaskTemplate.name}
                          </h4>
                          <p className="mt-1 text-sm text-slate-600">
                            Preset assignees:{" "}
                            {selectedTaskTemplateAssigneeIds.length
                              ? selectedTaskTemplateAssigneeIds
                                  .map((userId) => userNameById[userId] || "Unknown user")
                                  .join(", ")
                              : "None"}
                          </p>
                        </div>
                        <form action={deleteTaskTemplate} className="shrink-0">
                          <input type="hidden" name="id" value={selectedTaskTemplate.id} />
                          <ConfirmSubmitButton
                            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                            confirmText={`Delete template: ${selectedTaskTemplate.name}?`}
                          >
                            Delete
                          </ConfirmSubmitButton>
                        </form>
                      </div>

                      <form action={updateTaskTemplate} className="mt-4 grid gap-3 md:grid-cols-6">
                        <input type="hidden" name="id" value={selectedTaskTemplate.id} />
                        <input
                          name="name"
                          defaultValue={selectedTaskTemplate.name}
                          className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                          required
                        />
                        <input
                          name="title"
                          defaultValue={selectedTaskTemplate.title}
                          className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                          required
                        />
                        <select
                          name="status"
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                          defaultValue={selectedTaskTemplate.status || "to_do"}
                        >
                          {["to_do", "in_progress", "blocked", "completed", "cancelled"].map(
                            (status) => (
                              <option key={status} value={status}>
                                {status.replace("_", " ")}
                              </option>
                            )
                          )}
                        </select>
                        <select
                          name="priority"
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                          defaultValue={selectedTaskTemplate.priority || "medium"}
                        >
                          {["low", "medium", "high", "critical"].map((priority) => (
                            <option key={priority} value={priority}>
                              {priority}
                            </option>
                          ))}
                        </select>
                        <input
                          name="description"
                          defaultValue={selectedTaskTemplate.description || ""}
                          className="md:col-span-4 rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                        <input
                          type="time"
                          name="due_time"
                          defaultValue={selectedTaskTemplate.due_time || ""}
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                        <div className="md:col-span-6 relative">
                          <AssigneeMultiSelect
                            users={users}
                            name="assignee_user_ids"
                            defaultSelected={selectedTaskTemplateAssigneeIds}
                          />
                        </div>
                        <div className="md:col-span-6 flex items-center justify-end">
                          <button
                            type="submit"
                            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                            disabled={Boolean(taskTemplateAssigneesError)}
                          >
                            Save
                          </button>
                        </div>
                      </form>

                      <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <p className="text-sm font-semibold text-slate-900">Subtask templates</p>

                        {taskTemplateSubtasksError &&
                        isSupabaseMissingTableError(taskTemplateSubtasksError) ? (
                          <p className="mt-2 text-sm text-amber-900">
                            Subtasks are not set up yet. Run `sql/templates.sql` in Supabase SQL
                            editor, then refresh this page.
                          </p>
                        ) : null}
                        {taskTemplateSubtaskAssigneesError &&
                        isSupabaseMissingTableError(taskTemplateSubtaskAssigneesError) ? (
                          <p className="mt-2 text-sm text-amber-900">
                            Subtask assignees are not set up yet. Re-run `sql/templates.sql` in
                            Supabase SQL editor, then refresh this page.
                          </p>
                        ) : null}

                        <div className="mt-3">
                          {(subtasksByTemplateId[selectedTaskTemplate.id] || []).length ? (
                            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                              <table className="min-w-full text-left text-sm">
                                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                                  <tr>
                                    <th className="px-3 py-2">#</th>
                                    <th className="px-3 py-2">Title</th>
                                    <th className="px-3 py-2">Status</th>
                                    <th className="px-3 py-2">Priority</th>
                                    <th className="px-3 py-2">Assignees</th>
                                    <th className="px-3 py-2">Actions</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                  {(subtasksByTemplateId[selectedTaskTemplate.id] || []).map(
                                    (subtask) => {
                                      const rowFormId = `task-template-subtask-${subtask.id}-edit`;
                                      return (
                                        <tr key={subtask.id}>
                                          <td className="px-3 py-2 text-slate-500">{subtask.position}</td>
                                          <td className="px-3 py-2">
                                            <input type="hidden" name="id" value={subtask.id} form={rowFormId} />
                                            <input
                                              type="hidden"
                                              name="task_template_id"
                                              value={selectedTaskTemplate.id}
                                              form={rowFormId}
                                            />
                                            <input
                                              name="title"
                                              defaultValue={subtask.title}
                                              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                              disabled={Boolean(taskTemplateSubtasksError)}
                                              form={rowFormId}
                                              required
                                            />
                                            <input
                                              name="description"
                                              defaultValue={subtask.description || ""}
                                              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                              placeholder="Description (optional)"
                                              disabled={Boolean(taskTemplateSubtasksError)}
                                              form={rowFormId}
                                            />
                                          </td>
                                          <td className="px-3 py-2 align-top">
                                            <select
                                              name="status"
                                              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                              defaultValue={subtask.status || "to_do"}
                                              disabled={Boolean(taskTemplateSubtasksError)}
                                              form={rowFormId}
                                            >
                                              {[
                                                "to_do",
                                                "in_progress",
                                                "blocked",
                                                "completed",
                                                "cancelled",
                                              ].map((status) => (
                                                <option key={status} value={status}>
                                                  {status.replace("_", " ")}
                                                </option>
                                              ))}
                                            </select>
                                          </td>
                                          <td className="px-3 py-2 align-top">
                                            <select
                                              name="priority"
                                              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                              defaultValue={subtask.priority || "medium"}
                                              disabled={Boolean(taskTemplateSubtasksError)}
                                              form={rowFormId}
                                            >
                                              {["low", "medium", "high", "critical"].map((priority) => (
                                                <option key={priority} value={priority}>
                                                  {priority}
                                                </option>
                                              ))}
                                            </select>
                                          </td>
                                          <td className="px-3 py-2 align-top">
                                            <div className="relative min-w-[220px]">
                                              <AssigneeMultiSelect
                                                users={users}
                                                name="assignee_user_ids"
                                                form={rowFormId}
                                                defaultSelected={
                                                  assigneeIdsByTaskTemplateSubtaskId[subtask.id] || []
                                                }
                                              />
                                            </div>
                                          </td>
                                          <td className="px-3 py-2 align-top">
                                            <div className="flex gap-2">
                                              <form id={rowFormId} action={updateTaskTemplateSubtask}>
                                                <button
                                                  type="submit"
                                                  className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                                  disabled={Boolean(taskTemplateSubtasksError)}
                                                >
                                                  Save
                                                </button>
                                              </form>
                                              <form action={deleteTaskTemplateSubtask}>
                                                <input type="hidden" name="id" value={subtask.id} />
                                                <input
                                                  type="hidden"
                                                  name="task_template_id"
                                                  value={selectedTaskTemplate.id}
                                                />
                                                <ConfirmSubmitButton
                                                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                                                  confirmText={`Delete subtask: ${subtask.title}?`}
                                                  disabled={Boolean(taskTemplateSubtasksError)}
                                                >
                                                  Delete
                                                </ConfirmSubmitButton>
                                              </form>
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    }
                                  )}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-sm text-slate-600">No subtasks yet.</p>
                          )}
                        </div>

                        <form
                          action={createTaskTemplateSubtask}
                          className="mt-3 grid gap-2 md:grid-cols-6"
                        >
                          <input
                            type="hidden"
                            name="task_template_id"
                            value={selectedTaskTemplate.id}
                          />
                          <input
                            name="title"
                            placeholder="Subtask title"
                            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                            disabled={Boolean(taskTemplateSubtasksError)}
                            required
                          />
                          <select
                            name="status"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                            defaultValue="to_do"
                            disabled={Boolean(taskTemplateSubtasksError)}
                          >
                            {["to_do", "in_progress", "blocked", "completed", "cancelled"].map(
                              (status) => (
                                <option key={status} value={status}>
                                  {status.replace("_", " ")}
                                </option>
                              )
                            )}
                          </select>
                          <select
                            name="priority"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                            defaultValue="medium"
                            disabled={Boolean(taskTemplateSubtasksError)}
                          >
                            {["low", "medium", "high", "critical"].map((priority) => (
                              <option key={priority} value={priority}>
                                {priority}
                              </option>
                            ))}
                          </select>
                          <input
                            name="description"
                            placeholder="Description (optional)"
                            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                            disabled={Boolean(taskTemplateSubtasksError)}
                          />
                          <div className="md:col-span-6 relative">
                            <AssigneeMultiSelect users={users} name="assignee_user_ids" />
                          </div>
                          <button
                            type="submit"
                            className="md:col-span-6 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={Boolean(taskTemplateSubtasksError)}
                          >
                            Add subtask template
                          </button>
                        </form>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600">Click a task template in the table to view it.</p>
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
                  <h3 className="text-sm font-semibold text-slate-900">Existing project templates</h3>

                  {!projectTemplates.length ? (
                    <p className="text-sm text-slate-600">No templates yet.</p>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-white">
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                            <tr>
                              <th className="px-6 py-3">Template</th>
                              <th className="px-6 py-3">Status</th>
                              <th className="px-6 py-3">Linked task templates</th>
                              <th className="px-6 py-3">Description</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {projectTemplates.map((tpl) => {
                              const isSelected = tpl.id === selectedProjectTemplateId;
                              const linkedCount = (tasksByProjectTemplateId[tpl.id] || []).length;
                              return (
                                <tr
                                  key={tpl.id}
                                  className={isSelected ? "bg-slate-50" : "hover:bg-slate-50"}
                                >
                                  <td className="px-6 py-3 font-semibold text-slate-900">
                                    <a
                                      className="underline-offset-2 hover:underline"
                                      href={`/settings?tab=templates&templates=projects&project_template_id=${encodeURIComponent(
                                        tpl.id
                                      )}`}
                                    >
                                      {tpl.name}
                                    </a>
                                  </td>
                                  <td className="px-6 py-3 text-slate-700">
                                    {tpl.status?.replace("_", " ")}
                                  </td>
                                  <td className="px-6 py-3 text-slate-700">{linkedCount}</td>
                                  <td className="px-6 py-3 text-slate-700">{tpl.description || ""}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {selectedProjectTemplate ? (
                    <div className="rounded-lg border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                            Project template
                          </p>
                          <h4 className="truncate text-lg font-semibold text-slate-900">
                            {selectedProjectTemplate.name}
                          </h4>
                        </div>
                        <form action={deleteProjectTemplate} className="shrink-0">
                          <input type="hidden" name="id" value={selectedProjectTemplate.id} />
                          <ConfirmSubmitButton
                            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                            confirmText={`Delete template: ${selectedProjectTemplate.name}?`}
                          >
                            Delete
                          </ConfirmSubmitButton>
                        </form>
                      </div>

                      <form action={updateProjectTemplate} className="mt-4 grid gap-3 md:grid-cols-6">
                        <input type="hidden" name="id" value={selectedProjectTemplate.id} />
                        <input
                          name="name"
                          defaultValue={selectedProjectTemplate.name}
                          className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                          required
                        />
                        <select
                          name="status"
                          className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                          defaultValue={selectedProjectTemplate.status || "planned"}
                        >
                          {["planned", "active", "on_hold", "completed", "cancelled"].map(
                            (status) => (
                              <option key={status} value={status}>
                                {status.replace("_", " ")}
                              </option>
                            )
                          )}
                        </select>
                        <input
                          name="description"
                          defaultValue={selectedProjectTemplate.description || ""}
                          className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                        <div className="md:col-span-6 flex items-center justify-end">
                          <button
                            type="submit"
                            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Save
                          </button>
                        </div>
                      </form>

                      <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <p className="text-sm font-semibold text-slate-900">Template tasks</p>

                        {projectTemplateTasksError &&
                        isSupabaseMissingTableError(projectTemplateTasksError) ? (
                          <p className="mt-2 text-sm text-amber-900">
                            Project template tasks are not set up yet. Run `sql/templates.sql` in
                            Supabase SQL editor, then refresh this page.
                          </p>
                        ) : null}

                        <div className="mt-3 space-y-2">
                          {(tasksByProjectTemplateId[selectedProjectTemplate.id] || []).length ? (
                            (tasksByProjectTemplateId[selectedProjectTemplate.id] || []).map((link) => {
                              const taskTpl = taskTemplateById[link.task_template_id];
                              const label = taskTpl?.name || link.task_template_id;
                              const title = taskTpl?.title ? ` (${taskTpl.title})` : "";
                              return (
                                <div
                                  key={link.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate font-semibold text-slate-900">
                                      {link.position}. {label}
                                      {title}
                                    </p>
                                  </div>
                                  <form action={removeProjectTemplateTask}>
                                    <input type="hidden" name="id" value={link.id} />
                                    <input
                                      type="hidden"
                                      name="project_template_id"
                                      value={selectedProjectTemplate.id}
                                    />
                                    <ConfirmSubmitButton
                                      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                                      confirmText={`Remove ${label} from ${selectedProjectTemplate.name}?`}
                                      disabled={Boolean(projectTemplateTasksError)}
                                    >
                                      Remove
                                    </ConfirmSubmitButton>
                                  </form>
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-sm text-slate-600">No task templates linked yet.</p>
                          )}
                        </div>

                        <form action={addProjectTemplateTask} className="mt-3 grid gap-2 md:grid-cols-6">
                          <input
                            type="hidden"
                            name="project_template_id"
                            value={selectedProjectTemplate.id}
                          />
                          <select
                            name="task_template_id"
                            className="md:col-span-4 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                            defaultValue=""
                            disabled={
                              Boolean(projectTemplateTasksError) ||
                              Boolean(taskTemplatesError) ||
                              !taskTemplates.length
                            }
                            required
                          >
                            <option value="">Select a task template</option>
                            {taskTemplates.map((taskTpl) => (
                              <option key={taskTpl.id} value={taskTpl.id}>
                                {taskTpl.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className="md:col-span-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={
                              Boolean(projectTemplateTasksError) ||
                              Boolean(taskTemplatesError) ||
                              !taskTemplates.length
                            }
                          >
                            Add task
                          </button>
                        </form>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600">Click a project template in the table to view it.</p>
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

