import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import PersonalPageEditorClient from "./PersonalPageEditorClient";

export const dynamic = "force-dynamic";

const shareModeLabels: Record<string, string> = {
  private: "Private",
  inherit: "Shared (Section)",
  custom: "Shared (Custom)",
};

type SupabaseServerClient = ReturnType<typeof createSupabaseServerClient>;

async function syncPageShareMode(
  supabase: SupabaseServerClient,
  pageId: string,
  sectionId: string | null
) {
  if (sectionId) {
    const { count: sectionCount } = await supabase
      .from("personal_section_members")
      .select("id", { count: "exact", head: true })
      .eq("section_id", sectionId);

    if ((sectionCount || 0) > 0) {
      await supabase
        .from("personal_pages")
        .update({ share_mode: "inherit", updated_at: new Date().toISOString() })
        .eq("id", pageId);
      return;
    }
  }

  const { count: pageCount } = await supabase
    .from("personal_page_members")
    .select("id", { count: "exact", head: true })
    .eq("page_id", pageId);

  const shareMode = (pageCount || 0) > 0 ? "custom" : "private";
  await supabase
    .from("personal_pages")
    .update({ share_mode: shareMode, updated_at: new Date().toISOString() })
    .eq("id", pageId);
}

async function syncSectionShareMode(supabase: SupabaseServerClient, sectionId: string | null) {
  if (!sectionId) {
    return;
  }

  const { count: sectionCount } = await supabase
    .from("personal_section_members")
    .select("id", { count: "exact", head: true })
    .eq("section_id", sectionId);

  if ((sectionCount || 0) > 0) {
    await supabase
      .from("personal_pages")
      .update({ share_mode: "inherit", updated_at: new Date().toISOString() })
      .eq("section_id", sectionId);
    return;
  }

  const { data: pagesInSection } = await supabase
    .from("personal_pages")
    .select("id")
    .eq("section_id", sectionId);

  const pageIds = (pagesInSection || []).map((row) => row.id);
  if (!pageIds.length) {
    return;
  }

  await supabase
    .from("personal_pages")
    .update({ share_mode: "private", updated_at: new Date().toISOString() })
    .in("id", pageIds);

  const { data: pageMemberRows } = await supabase
    .from("personal_page_members")
    .select("page_id")
    .in("page_id", pageIds);

  const pageIdsWithMembers = Array.from(
    new Set((pageMemberRows || []).map((row) => row.page_id))
  );

  if (pageIdsWithMembers.length) {
    await supabase
      .from("personal_pages")
      .update({ share_mode: "custom", updated_at: new Date().toISOString() })
      .in("id", pageIdsWithMembers);
  }
}

export default async function PersonalPage(props: {
  params: Promise<{ pageId: string }>;
}) {
  const params = await props.params;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (!user) {
    redirect("/login");
  }

  const { data: page } = await supabase
    .from("personal_pages")
    .select(
      "id,title,section_id,owner_id,share_mode,updated_at,content,last_edited_at,last_edited_by_user_id,personal_sections(id,title)"
    )
    .eq("id", params.pageId)
    .single();

  if (!page) {
    notFound();
  }

  const { data: sections } = await supabase
    .from("personal_sections")
    .select("id,title")
    .order("sort_order", { ascending: true });

  const { data: users } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });

  const lastEditedAtLabel = page.last_edited_at
    ? new Date(page.last_edited_at).toLocaleString("en-US")
    : null;
  const lastEditedByUser = users?.find(
    (member) => member.id === page.last_edited_by_user_id
  );
  const lastEditedByLabel = lastEditedByUser
    ? lastEditedByUser.full_name || lastEditedByUser.email
    : null;

  const { data: sectionMembers } = await supabase
    .from("personal_section_members")
    .select("id,user_id,role,users(full_name,email)")
    .eq("section_id", page.section_id)
    .order("created_at", { ascending: true });

  const { data: pageMembers } = await supabase
    .from("personal_page_members")
    .select("id,user_id,role,users(full_name,email)")
    .eq("page_id", page.id)
    .order("created_at", { ascending: true });

  async function updatePageDetails(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const title = String(formData.get("title") || "").trim();
    const sectionId = String(formData.get("section_id") || "").trim();

    if (!title) {
      redirect(`/personal/${page.id}?error=Title%20is%20required`);
    }

    const { error } = await supabase
      .from("personal_pages")
      .update({
        title,
        section_id: sectionId || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", page.id);

    if (error) {
      redirect(`/personal/${page.id}?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath(`/personal/${page.id}`);
    revalidatePath("/personal");
  }

  async function addSectionMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const userId = String(formData.get("user_id") || "");
    const role = String(formData.get("role") || "view");

    if (!userId) {
      return;
    }

    await supabase.from("personal_section_members").upsert(
      {
        section_id: page.section_id,
        user_id: userId,
        role,
      },
      { onConflict: "section_id,user_id" }
    );

    await syncSectionShareMode(supabase, page.section_id);
    revalidatePath(`/personal/${page.id}`);
    revalidatePath("/personal");
  }

  async function updateSectionMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const memberId = String(formData.get("member_id") || "");
    const role = String(formData.get("role") || "view");

    if (!memberId) {
      return;
    }

    await supabase
      .from("personal_section_members")
      .update({ role })
      .eq("id", memberId);

    revalidatePath(`/personal/${page.id}`);
  }

  async function removeSectionMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const memberId = String(formData.get("member_id") || "");

    if (!memberId) {
      return;
    }

    await supabase.from("personal_section_members").delete().eq("id", memberId);
    await syncSectionShareMode(supabase, page.section_id);
    revalidatePath(`/personal/${page.id}`);
    revalidatePath("/personal");
  }

  async function addPageMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const userId = String(formData.get("user_id") || "");
    const role = String(formData.get("role") || "view");

    if (!userId) {
      return;
    }

    await supabase.from("personal_page_members").upsert(
      {
        page_id: page.id,
        user_id: userId,
        role,
      },
      { onConflict: "page_id,user_id" }
    );

    await syncPageShareMode(supabase, page.id, page.section_id);
    revalidatePath(`/personal/${page.id}`);
  }

  async function updatePageMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const memberId = String(formData.get("member_id") || "");
    const role = String(formData.get("role") || "view");

    if (!memberId) {
      return;
    }

    await supabase
      .from("personal_page_members")
      .update({ role })
      .eq("id", memberId);

    await syncPageShareMode(supabase, page.id, page.section_id);
    revalidatePath(`/personal/${page.id}`);
  }

  async function removePageMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const memberId = String(formData.get("member_id") || "");

    if (!memberId) {
      return;
    }

    await supabase.from("personal_page_members").delete().eq("id", memberId);
    await syncPageShareMode(supabase, page.id, page.section_id);
    revalidatePath(`/personal/${page.id}`);
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Personal page
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">{page.title}</h1>
          <p className="text-sm text-slate-600">
            {page.personal_sections?.title || "General"} -{" "}
            {shareModeLabels[page.share_mode] || "Private"}
          </p>
        </div>
        <form action={updatePageDetails} className="flex flex-wrap items-end gap-2">
          <input
            name="title"
            defaultValue={page.title}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            name="section_id"
            defaultValue={page.section_id || ""}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">General</option>
            {sections?.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Update
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <details className="rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer px-6 py-4 text-sm font-semibold text-slate-900">
            Section members
          </summary>
          <div className="border-t border-slate-200 px-6 py-4">
            <form action={addSectionMember} className="flex flex-wrap gap-2">
              <select
                name="user_id"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select user</option>
                {users?.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name || member.email}
                  </option>
                ))}
              </select>
              <select
                name="role"
                defaultValue="view"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="view">View</option>
                <option value="edit">Edit</option>
              </select>
              <button
                type="submit"
                className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
              >
                Add
              </button>
            </form>
            <div className="mt-4 space-y-2">
              {sectionMembers?.length ? (
                sectionMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm"
                  >
                    <span className="text-slate-600">
                      {member.users?.full_name || member.users?.email || "Unknown user"}
                    </span>
                    <form className="flex items-center gap-2" action={updateSectionMember}>
                      <input type="hidden" name="member_id" value={member.id} />
                      <select
                        name="role"
                        defaultValue={member.role}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      >
                        <option value="view">View</option>
                        <option value="edit">Edit</option>
                      </select>
                      <button
                        type="submit"
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
                      >
                        Update
                      </button>
                      <button
                        type="submit"
                        formAction={removeSectionMember}
                        className="text-xs font-semibold text-red-600 hover:text-red-800"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500">No section members yet.</p>
              )}
            </div>
          </div>
        </details>

        <details className="rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer px-6 py-4 text-sm font-semibold text-slate-900">
            Page members
          </summary>
          <div className="border-t border-slate-200 px-6 py-4">
            <form action={addPageMember} className="flex flex-wrap gap-2">
              <select
                name="user_id"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select user</option>
                {users?.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name || member.email}
                  </option>
                ))}
              </select>
              <select
                name="role"
                defaultValue="view"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="view">View</option>
                <option value="edit">Edit</option>
              </select>
              <button
                type="submit"
                className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
              >
                Add
              </button>
            </form>
            <div className="mt-4 space-y-2">
              {pageMembers?.length ? (
                pageMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm"
                  >
                    <span className="text-slate-600">
                      {member.users?.full_name || member.users?.email || "Unknown user"}
                    </span>
                    <form className="flex items-center gap-2" action={updatePageMember}>
                      <input type="hidden" name="member_id" value={member.id} />
                      <select
                        name="role"
                        defaultValue={member.role}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      >
                        <option value="view">View</option>
                        <option value="edit">Edit</option>
                      </select>
                      <button
                        type="submit"
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
                      >
                        Update
                      </button>
                      <button
                        type="submit"
                        formAction={removePageMember}
                        className="text-xs font-semibold text-red-600 hover:text-red-800"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500">No page-specific members yet.</p>
              )}
            </div>
          </div>
        </details>
      </section>

      <PersonalPageEditorClient
        pageId={page.id}
        initialContent={page.content ?? null}
        lastEditedAtLabel={lastEditedAtLabel}
        lastEditedByLabel={lastEditedByLabel}
      />
    </div>
  );
}

