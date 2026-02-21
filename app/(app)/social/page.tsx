import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  isSupabaseMissingFunctionError,
  isSupabaseMissingTableError,
} from "@/lib/supabaseErrors";

type SocialPageRow = {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type SocialPageMemberRow = {
  page_id: string;
  user_id: string;
  role: "member" | "manager";
};

type SocialPostRow = {
  page_id: string;
  created_at: string;
};

function toDisplayDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleString();
}

export default async function SocialPage(props: {
  searchParams?: Promise<{ error?: string; success?: string }>;
}) {
  const searchParams = await props.searchParams;
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

  const [canViewResult, canEditResult] = await Promise.all([
    supabase.rpc("can_view_page", { p_page_key: "social" }),
    supabase.rpc("can_edit_page", { p_page_key: "social" }),
  ]);

  const canViewSocial = canViewResult.error
    ? true
    : Boolean(canViewResult.data);
  const canEditSocial = canEditResult.error
    ? true
    : Boolean(canEditResult.data);

  if (!canViewSocial) {
    redirect("/dashboard?error=No%20access%20to%20Social");
  }

  const { data: pagesRaw, error: pagesError } = await supabase
    .from("social_pages")
    .select("id,name,description,created_by,created_at,updated_at")
    .order("updated_at", { ascending: false });

  const pagesSchemaMissing = isSupabaseMissingTableError(pagesError);
  const pages = pagesSchemaMissing
    ? []
    : ((pagesRaw || []) as SocialPageRow[]);

  const pageIds = pages.map((page) => page.id);

  const [membersResult, postsResult] = pageIds.length
    ? await Promise.all([
        supabase
          .from("social_page_members")
          .select("page_id,user_id,role")
          .in("page_id", pageIds),
        supabase
          .from("social_posts")
          .select("page_id,created_at")
          .in("page_id", pageIds),
      ])
    : [
        { data: [] as SocialPageMemberRow[], error: null },
        { data: [] as SocialPostRow[], error: null },
      ];

  const members = (membersResult.data || []) as SocialPageMemberRow[];
  const posts = (postsResult.data || []) as SocialPostRow[];

  const ownerIds = Array.from(new Set(pages.map((page) => page.created_by)));
  const { data: ownerUsers } = ownerIds.length
    ? await supabase.from("users").select("id,full_name,email").in("id", ownerIds)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };

  const ownerLabelById = new Map<string, string>();
  (ownerUsers || []).forEach((owner) => {
    ownerLabelById.set(owner.id, owner.full_name || owner.email || "Unknown user");
  });

  const memberRowsByPage = new Map<string, SocialPageMemberRow[]>();
  members.forEach((member) => {
    const bucket = memberRowsByPage.get(member.page_id) || [];
    bucket.push(member);
    memberRowsByPage.set(member.page_id, bucket);
  });

  const postStatsByPage = new Map<string, { total: number; latest: string | null }>();
  posts.forEach((post) => {
    const current = postStatsByPage.get(post.page_id) || { total: 0, latest: null };
    const latest = !current.latest || post.created_at > current.latest ? post.created_at : current.latest;
    postStatsByPage.set(post.page_id, {
      total: current.total + 1,
      latest,
    });
  });

  const socialPermissionWarning =
    canViewResult.error && !isSupabaseMissingFunctionError(canViewResult.error)
      ? `Could not verify Social view permission (${canViewResult.error.message}).`
      : canEditResult.error && !isSupabaseMissingFunctionError(canEditResult.error)
        ? `Could not verify Social edit permission (${canEditResult.error.message}).`
        : null;

  async function createSocialPage(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();

    const name = String(formData.get("name") || "").trim();
    const description = String(formData.get("description") || "").trim();

    if (!name) {
      redirect("/social?error=Page%20name%20is%20required");
    }

    const canEditResult = await supabase.rpc("can_edit_page", {
      p_page_key: "social",
    });

    if (canEditResult.error) {
      redirect(`/social?error=${encodeURIComponent(`Could not verify Social edit permission (${canEditResult.error.message})`)}`);
    }

    if (!canEditResult.error && !canEditResult.data) {
      redirect("/social?error=You%20only%20have%20view%20access%20to%20Social");
    }

    const { data: authData } = await supabase.auth.getUser();
    const authUserId = String(authData.user?.id || "").trim();
    const authEmail = authData.user?.email;

    if (!authUserId) {
      redirect("/login");
    }

    const userByAuthIdResult = await supabase
      .from("users")
      .select("id")
      .eq("id", authUserId)
      .maybeSingle();
    const userByEmailResult =
      !userByAuthIdResult.data && authEmail
        ? await supabase
            .from("users")
            .select("id")
            .eq("email", authEmail)
            .maybeSingle()
        : null;
    const user = userByAuthIdResult.data || userByEmailResult?.data || null;

    if (!user?.id) {
      redirect("/social?error=Missing%20user%20profile");
    }

    const supabaseAdmin = createSupabaseAdminClient();

    const { data: insertedPage, error: insertError } = await supabaseAdmin
      .from("social_pages")
      .insert({
        name,
        description: description || null,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (insertError || !insertedPage?.id) {
      const insertMessage = String(insertError?.message || "Unable to create page");
      const friendlyMessage = /row-level security/i.test(insertMessage)
        ? "Social page creation failed due to a policy mismatch. Contact support if this persists."
        : insertMessage;
      redirect(
        `/social?error=${encodeURIComponent(friendlyMessage)}`
      );
    }

    const { error: addManagerError } = await supabaseAdmin
      .from("social_page_members")
      .upsert(
        {
          page_id: insertedPage.id,
          user_id: user.id,
          role: "manager",
          created_by_user_id: user.id,
        },
        { onConflict: "page_id,user_id" }
      );

    if (addManagerError && !isSupabaseMissingTableError(addManagerError)) {
      redirect(`/social?error=${encodeURIComponent(addManagerError.message)}`);
    }

    revalidatePath("/social");
    revalidatePath(`/social/${insertedPage.id}`);
    redirect(`/social/${insertedPage.id}?success=Social%20page%20created`);
  }

  return (
    <div className="space-y-7">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 px-6 py-6 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">Social workspace</p>
            <h1 className="text-2xl font-semibold">Social for work</h1>
            <p className="max-w-2xl text-sm text-slate-200">
              Create focused social pages for teams, updates, and lightweight conversations. Pages are private by default,
              and access is only granted to people you add.
            </p>
          </div>
          <div className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-xs text-slate-100">
            <p className="font-semibold uppercase tracking-wide">Privacy model</p>
            <p className="mt-1 text-slate-200">No one is added automatically except the page creator.</p>
          </div>
        </div>
      </section>

      {(searchParams?.error || searchParams?.success || socialPermissionWarning) && (
        <div className="space-y-2">
          {socialPermissionWarning ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              {socialPermissionWarning}
            </p>
          ) : null}
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

      {pagesSchemaMissing ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Social is not set up yet. Run <code>sql/social.sql</code> in Supabase SQL editor, then refresh.
        </section>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-[1.15fr_2fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Create a social page</h2>
          <p className="mt-1 text-sm text-slate-600">
            Keep each page focused on one team or initiative.
          </p>

          {!canEditSocial ? (
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              You have view-only access to Social.
            </p>
          ) : null}

          <form action={createSocialPage} className="mt-4 grid gap-3">
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
              Page name
              <input
                name="name"
                maxLength={80}
                placeholder="Example: Product Launch HQ"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                disabled={!canEditSocial}
                required
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
              Description
              <textarea
                name="description"
                rows={4}
                maxLength={600}
                placeholder="What this page is for and who should be invited."
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                disabled={!canEditSocial}
              />
            </label>
            <button
              type="submit"
              disabled={!canEditSocial}
              className="w-fit rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Create page
            </button>
          </form>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Your social pages</h2>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
              {pages.length} total
            </span>
          </div>

          {pages.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {pages.map((page) => {
                const memberRows = memberRowsByPage.get(page.id) || [];
                const memberIds = new Set<string>([page.created_by]);
                memberRows.forEach((member) => memberIds.add(member.user_id));

                const stat = postStatsByPage.get(page.id) || { total: 0, latest: null };
                const currentMember = memberRows.find((member) => member.user_id === currentUser.id);
                const roleLabel =
                  page.created_by === currentUser.id
                    ? "Owner"
                    : currentMember?.role === "manager"
                      ? "Manager"
                      : "Member";

                return (
                  <Link
                    key={page.id}
                    href={`/social/${page.id}`}
                    className="group flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4 transition hover:border-slate-300 hover:shadow-md"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="line-clamp-2 text-base font-semibold text-slate-900 group-hover:text-slate-950">
                          {page.name}
                        </h3>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          {roleLabel}
                        </span>
                      </div>
                      <p className="line-clamp-3 text-sm text-slate-600">
                        {page.description || "No description added yet."}
                      </p>
                    </div>

                    <div className="mt-4 space-y-2 border-t border-slate-200 pt-3 text-xs text-slate-500">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{memberIds.size} people</span>
                        <span>-</span>
                        <span>{stat.total} posts</span>
                      </div>
                      <p>
                        Owner: {ownerLabelById.get(page.created_by) || "Unknown user"}
                      </p>
                      <p>
                        Last activity: {stat.latest ? toDisplayDate(stat.latest) : toDisplayDate(page.updated_at)}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
              No social pages yet. Create one to start posting updates and comments.
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
