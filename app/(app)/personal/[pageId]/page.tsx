import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import PersonalPageEditorClient from "./PersonalPageEditorClient";
import { extractPlainText } from "@/lib/tiptapText";
import PersonalPageTabs, {
  normalizePersonalPageTabKey,
} from "./_components/PersonalPageTabs";

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
    const { count: sectionCount, error: sectionCountError } = await supabase
      .from("personal_section_members")
      .select("id", { count: "exact", head: true })
      .eq("section_id", sectionId);
    if (sectionCountError) {
      throw new Error(sectionCountError.message);
    }

    if ((sectionCount || 0) > 0) {
      const { error: inheritError } = await supabase
        .from("personal_pages")
        .update({ share_mode: "inherit", updated_at: new Date().toISOString() })
        .eq("id", pageId);
      if (inheritError) {
        throw new Error(inheritError.message);
      }
      return;
    }
  }

  const { count: pageCount, error: pageCountError } = await supabase
    .from("personal_page_members")
    .select("id", { count: "exact", head: true })
    .eq("page_id", pageId);
  if (pageCountError) {
    throw new Error(pageCountError.message);
  }

  const shareMode = (pageCount || 0) > 0 ? "custom" : "private";
  const { error: pageModeError } = await supabase
    .from("personal_pages")
    .update({ share_mode: shareMode, updated_at: new Date().toISOString() })
    .eq("id", pageId);
  if (pageModeError) {
    throw new Error(pageModeError.message);
  }
}

async function syncSectionShareMode(supabase: SupabaseServerClient, sectionId: string | null) {
  if (!sectionId) {
    return;
  }

  const { count: sectionCount, error: sectionCountError } = await supabase
    .from("personal_section_members")
    .select("id", { count: "exact", head: true })
    .eq("section_id", sectionId);
  if (sectionCountError) {
    throw new Error(sectionCountError.message);
  }

  if ((sectionCount || 0) > 0) {
    const { error: inheritError } = await supabase
      .from("personal_pages")
      .update({ share_mode: "inherit", updated_at: new Date().toISOString() })
      .eq("section_id", sectionId);
    if (inheritError) {
      throw new Error(inheritError.message);
    }
    return;
  }

  const { data: pagesInSection, error: pagesInSectionError } = await supabase
    .from("personal_pages")
    .select("id")
    .eq("section_id", sectionId);
  if (pagesInSectionError) {
    throw new Error(pagesInSectionError.message);
  }

  const pageIds = (pagesInSection || []).map((row) => row.id);
  if (!pageIds.length) {
    return;
  }

  const { error: privateError } = await supabase
    .from("personal_pages")
    .update({ share_mode: "private", updated_at: new Date().toISOString() })
    .in("id", pageIds);
  if (privateError) {
    throw new Error(privateError.message);
  }

  const { data: pageMemberRows, error: pageMemberRowsError } = await supabase
    .from("personal_page_members")
    .select("page_id")
    .in("page_id", pageIds);
  if (pageMemberRowsError) {
    throw new Error(pageMemberRowsError.message);
  }

  const pageIdsWithMembers = Array.from(
    new Set((pageMemberRows || []).map((row) => row.page_id))
  );

  if (pageIdsWithMembers.length) {
    const { error: customError } = await supabase
      .from("personal_pages")
      .update({ share_mode: "custom", updated_at: new Date().toISOString() })
      .in("id", pageIdsWithMembers);
    if (customError) {
      throw new Error(customError.message);
    }
  }
}

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const anyError = error as { code?: unknown; message?: unknown };
  const code = typeof anyError.code === "string" ? anyError.code : "";
  const message = typeof anyError.message === "string" ? anyError.message : "";
  return code === "42703" || message.includes("does not exist");
}

export default async function PersonalPage(props: {
  params: Promise<{ pageId: string }>;
  searchParams?: Promise<{ tab?: string; error?: string; success?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
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

  const pageId = page.id;
  const pageTitle = page.title || "Personal page";
  const activeTab = normalizePersonalPageTabKey(searchParams?.tab);
  const sectionId = page.section_id;
  const pageOwnerId = page.owner_id;
  const isOwner = pageOwnerId === user.id;

  const { data: sections } = await supabase
    .from("personal_sections")
    .select("id,title")
    .order("sort_order", { ascending: true });

  const sectionTitle = sections?.find((section) => section.id === sectionId)?.title;

  const { data: users } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });
  const { data: clients } = await supabase
    .from("clients")
    .select("id,name")
    .order("name", { ascending: true });

  const lastEditedAtLabel = page.last_edited_at
    ? new Date(page.last_edited_at).toLocaleString("en-US")
    : null;
  const lastEditedByUser = users?.find(
    (member) => member.id === page.last_edited_by_user_id
  );
  const lastEditedByLabel = lastEditedByUser
    ? lastEditedByUser.full_name || lastEditedByUser.email
    : null;

  const { data: sectionMembersRaw } = await supabase
    .from("personal_section_members")
    .select("id,user_id,role,created_at")
    .eq("section_id", sectionId)
    .order("created_at", { ascending: true });

  const { data: pageMembersRaw } = await supabase
    .from("personal_page_members")
    .select("id,user_id,role,created_at")
    .eq("page_id", pageId)
    .order("created_at", { ascending: true });

  const userLabelById = (users || []).reduce<Record<string, string>>((acc, member) => {
    acc[member.id] = member.full_name || member.email || "Unknown user";
    return acc;
  }, {});
  const sectionMembers = (sectionMembersRaw || []) as Array<{
    id: string;
    user_id: string;
    role: string;
  }>;
  const pageMembers = (pageMembersRaw || []) as Array<{
    id: string;
    user_id: string;
    role: string;
  }>;

  async function updatePageDetails(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const title = String(formData.get("title") || "").trim();
    const sectionId = String(formData.get("section_id") || "").trim();

    if (!title) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", "Title is required");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    const { error } = await supabase
      .from("personal_pages")
      .update({
        title,
        section_id: sectionId || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pageId);

    if (error) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", error.message);
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    revalidatePath(`/personal/${pageId}`);
    revalidatePath("/personal");
  }

  async function deletePersonalPage() {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (!user) {
      redirect("/login");
    }

    if (pageOwnerId !== user.id) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", "Only the page owner can delete it");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    const { error } = await supabase.from("personal_pages").delete().eq("id", pageId);

    if (error) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", error.message);
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    revalidatePath("/personal");
    redirect("/personal");
  }

  async function addSectionMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const userId = String(formData.get("user_id") || "");
    const role = String(formData.get("role") || "view");

    if (!userId) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", "Select a user to share with");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    if (!sectionId) {
      const sp = new URLSearchParams();
      sp.set("tab", "page_members");
      sp.set(
        "error",
        "This page is in General. Use Page members or move it into a section."
      );
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    const { error } = await supabase.from("personal_section_members").upsert(
      {
        section_id: sectionId,
        user_id: userId,
        role,
      },
      { onConflict: "section_id,user_id" }
    );

    if (error) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", error.message);
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    try {
      await syncSectionShareMode(supabase, sectionId);
    } catch (e) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", e instanceof Error ? e.message : "Unable to apply section sharing");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }
    revalidatePath(`/personal/${pageId}`);
    revalidatePath("/personal");
    {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("success", "Section member added");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }
  }

  async function updateSectionMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const memberId = String(formData.get("member_id") || "");
    const role = String(formData.get("role") || "view");

    if (!memberId) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", "Missing member id");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    const { error } = await supabase
      .from("personal_section_members")
      .update({ role })
      .eq("id", memberId);

    if (error) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", error.message);
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    revalidatePath(`/personal/${pageId}`);
    {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("success", "Section member updated");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }
  }

  async function removeSectionMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const memberId = String(formData.get("member_id") || "");

    if (!memberId) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", "Missing member id");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    const { error } = await supabase
      .from("personal_section_members")
      .delete()
      .eq("id", memberId);

    if (error) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", error.message);
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    try {
      await syncSectionShareMode(supabase, sectionId);
    } catch (e) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", e instanceof Error ? e.message : "Unable to apply section sharing");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }
    revalidatePath(`/personal/${pageId}`);
    revalidatePath("/personal");
    {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("success", "Section member removed");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }
  }

  async function addPageMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const userId = String(formData.get("user_id") || "");
    const role = String(formData.get("role") || "view");

    if (!userId) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", "Select a user to share with");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    const { error } = await supabase.from("personal_page_members").upsert(
      {
        page_id: pageId,
        user_id: userId,
        role,
      },
      { onConflict: "page_id,user_id" }
    );

    if (error) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", error.message);
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    try {
      await syncPageShareMode(supabase, pageId, sectionId);
    } catch (e) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", e instanceof Error ? e.message : "Unable to apply page sharing");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }
    revalidatePath(`/personal/${pageId}`);
    {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("success", "Page member added");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }
  }

  async function updatePageMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const memberId = String(formData.get("member_id") || "");
    const role = String(formData.get("role") || "view");

    if (!memberId) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", "Missing member id");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    const { error } = await supabase
      .from("personal_page_members")
      .update({ role })
      .eq("id", memberId);

    if (error) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", error.message);
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    try {
      await syncPageShareMode(supabase, pageId, sectionId);
    } catch (e) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", e instanceof Error ? e.message : "Unable to apply page sharing");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }
    revalidatePath(`/personal/${pageId}`);
    {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("success", "Page member updated");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }
  }

  async function removePageMember(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const memberId = String(formData.get("member_id") || "");

    if (!memberId) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", "Missing member id");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    const { error } = await supabase
      .from("personal_page_members")
      .delete()
      .eq("id", memberId);

    if (error) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", error.message);
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    try {
      await syncPageShareMode(supabase, pageId, sectionId);
    } catch (e) {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("error", e instanceof Error ? e.message : "Unable to apply page sharing");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }
    revalidatePath(`/personal/${pageId}`);
    {
      const sp = new URLSearchParams();
      if (activeTab !== "notes") sp.set("tab", activeTab);
      sp.set("success", "Page member removed");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }
  }

  async function linkPageToClientNote(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (!user) {
      redirect("/login");
    }

    const clientId = String(formData.get("client_id") || "").trim();
    const visibility = String(formData.get("visibility") || "internal").trim() || "internal";
    const titlePrefix = pageTitle.trim() ? `Personal: ${pageTitle}` : "Personal page";
    const sourceUrl = `/personal/${pageId}`;
    const linkDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Linked personal page: " },
            {
              type: "text",
              text: titlePrefix,
              marks: [{ type: "link", attrs: { href: sourceUrl } }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: sourceUrl }],
        },
        { type: "paragraph" },
      ],
    };
    const contentText = extractPlainText(linkDoc);
    const now = new Date().toISOString();

    if (!clientId) {
      const sp = new URLSearchParams();
      sp.set("tab", "notes");
      sp.set("error", "Select a client");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    const noteInsert = {
      client_id: clientId,
      project_id: null,
      title: titlePrefix,
      visibility,
      content: contentText,
      content_json: linkDoc,
      user_id: user.id,
      last_edited_at: now,
      last_edited_by_user_id: user.id,
    };

    const { data: note, error } = await supabase
      .from("notes")
      .insert(noteInsert)
      .select("id")
      .single();

    if (error && isMissingColumnError(error)) {
      const { error: fallbackError } = await supabase.from("notes").insert({
        client_id: clientId,
        project_id: null,
        content: `Linked personal page: ${titlePrefix}\n${sourceUrl}`,
        visibility,
        user_id: user.id,
      });

      if (fallbackError) {
        const sp = new URLSearchParams();
        sp.set("tab", "notes");
        sp.set("error", fallbackError.message);
        redirect(`/personal/${pageId}?${sp.toString()}`);
      }

      revalidatePath(`/clients/${clientId}/notes`);
      revalidatePath(`/clients/${clientId}`);
      revalidatePath(`/personal/${pageId}`);
      {
        const sp = new URLSearchParams();
        sp.set("tab", "notes");
        sp.set("success", "Linked to client note");
        redirect(`/personal/${pageId}?${sp.toString()}`);
      }
    }

    if (error || !note) {
      const sp = new URLSearchParams();
      sp.set("tab", "notes");
      sp.set("error", error?.message || "Unable to create client note");
      redirect(`/personal/${pageId}?${sp.toString()}`);
    }

    revalidatePath(`/clients/${clientId}/notes`);
    revalidatePath(`/clients/${clientId}/notes/${note.id}`);
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/personal/${pageId}`);
    redirect(`/clients/${clientId}/notes/${note.id}`);
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
            {sectionTitle || "General"} -{" "}
            {shareModeLabels[page.share_mode] || "Private"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
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

          {isOwner ? (
            <details className="w-full max-w-[420px] rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <summary className="cursor-pointer select-none font-semibold">
                Delete page
              </summary>
              <div className="mt-2 space-y-2">
                <p>This will permanently delete the page and its content.</p>
                <form action={deletePersonalPage}>
                  <button
                    type="submit"
                    className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
                  >
                    Confirm delete
                  </button>
                </form>
              </div>
            </details>
          ) : null}
        </div>
      </section>

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

      <PersonalPageTabs pageId={pageId} active={activeTab} sectionId={sectionId} />

      {activeTab === "section_members" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Section members</h2>
          </div>
          <div className="px-6 py-4">
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
                      {userLabelById[member.user_id] || "Unknown user"}
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
        </section>
      ) : null}

      {activeTab === "page_members" ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Page members</h2>
          </div>
          <div className="px-6 py-4">
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
                      {userLabelById[member.user_id] || "Unknown user"}
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
        </section>
      ) : null}

      {activeTab === "notes" ? (
        <div className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Link To Client Note</h2>
            <p className="mt-1 text-xs text-slate-500">
              Create a client note that links back to this personal page.
            </p>
            <form action={linkPageToClientNote} className="mt-3 flex flex-wrap items-end gap-2">
              <select
                name="client_id"
                className="min-w-[240px] rounded-md border border-slate-300 px-3 py-2 text-sm"
                defaultValue=""
                required
              >
                <option value="" disabled>
                  Select client
                </option>
                {(clients || []).map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
              <select
                name="visibility"
                defaultValue="internal"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="internal">internal</option>
                <option value="client_shared">client shared</option>
              </select>
              <button
                type="submit"
                className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
              >
                Link note
              </button>
            </form>
          </section>
          <PersonalPageEditorClient
            pageId={page.id}
            initialContent={page.content ?? null}
            lastEditedAtLabel={lastEditedAtLabel}
            lastEditedByLabel={lastEditedByLabel}
          />
        </div>
      ) : null}
    </div>
  );
}

