import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  searchParams?: Promise<{ tab?: string; success?: string; error?: string }>;
}) {
  const searchParams = await props.searchParams;
  const activeTab = normalizeSettingsTabKey(searchParams?.tab);

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
    </div>
  );
}
