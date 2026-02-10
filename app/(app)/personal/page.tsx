import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_EDITOR_CONTENT } from "@/lib/editorContent";
import { extractPlainText } from "@/lib/tiptapText";

export const dynamic = "force-dynamic";

const shareModeLabels: Record<string, string> = {
  private: "Private",
  inherit: "Shared (Section)",
  custom: "Shared (Page)",
};

const defaultPageContent = DEFAULT_EDITOR_CONTENT;
const defaultPageContentText = extractPlainText(defaultPageContent);

function getSelectedMembers(formData: FormData, ownerId: string) {
  const selected = formData.getAll("share_user").map((value) => String(value));
  return selected
    .filter((userId) => userId && userId !== ownerId)
    .map((userId) => ({
      user_id: userId,
      role: String(formData.get(`role_${userId}`) || "view"),
    }));
}

export default async function PersonalHome(props: {
  searchParams?: Promise<{
    section?: string;
    filter?: string;
    sort?: string;
    q?: string;
    error?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (!user) {
    redirect("/login");
  }

  const selectedSection = (searchParams?.section || "all").trim();
  const selectedFilter = (searchParams?.filter || "all").trim();
  const selectedSort = (searchParams?.sort || "updated").trim();
  const query = (searchParams?.q || "").trim();

  const { data: sections } = await supabase
    .from("personal_sections")
    .select("id,title,owner_id,sort_order,created_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const { data: users } = await supabase
    .from("users")
    .select("id,full_name,email")
    .order("full_name", { ascending: true });

  let pagesRequest = supabase
    .from("personal_pages")
    .select("id,title,section_id,share_mode,updated_at,personal_sections(title)")
    .order("updated_at", { ascending: false });

  if (selectedSection !== "all") {
    pagesRequest = pagesRequest.eq("section_id", selectedSection);
  }

  if (selectedFilter === "private") {
    pagesRequest = pagesRequest.eq("share_mode", "private");
  } else if (selectedFilter === "shared") {
    pagesRequest = pagesRequest.neq("share_mode", "private");
  }

  if (query) {
    pagesRequest = pagesRequest.ilike("title", `%${query}%`);
  }

  if (selectedSort === "title") {
    pagesRequest = pagesRequest.order("title", { ascending: true });
  }

  const { data: pages } = await pagesRequest;

  const getRelationTitle = (
    relation:
      | { title?: string | null }
      | { title?: string | null }[]
      | null
      | undefined,
    fallback: string
  ) => {
    if (Array.isArray(relation)) {
      return relation[0]?.title ?? fallback;
    }
    return relation?.title ?? fallback;
  };

  async function createSection(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (!user) {
      redirect("/login");
    }

    const title = String(formData.get("title") || "").trim();
    if (!title) {
      redirect("/personal?error=Section%20title%20is%20required");
    }

    const { data: lastSection } = await supabase
      .from("personal_sections")
      .select("sort_order")
      .eq("owner_id", user.id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextSort = (lastSection?.sort_order || 0) + 1;

    const { error } = await supabase.from("personal_sections").insert({
      title,
      owner_id: user.id,
      sort_order: nextSort,
    });

    if (error) {
      redirect(`/personal?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/personal");
  }

  async function renameSection(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (!user) {
      redirect("/login");
    }

    const sectionId = String(formData.get("section_id") || "").trim();
    const title = String(formData.get("title") || "").trim();

    if (!sectionId) {
      redirect("/personal?error=Missing%20section%20id");
    }

    if (!title) {
      redirect("/personal?error=Section%20title%20is%20required");
    }

    const { error } = await supabase
      .from("personal_sections")
      .update({ title })
      .eq("id", sectionId);

    if (error) {
      redirect(`/personal?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/personal");
  }

  async function deleteSection(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (!user) {
      redirect("/login");
    }

    const sectionId = String(formData.get("section_id") || "").trim();
    if (!sectionId) {
      redirect("/personal?error=Missing%20section%20id");
    }

    // Enforce "owner only" delete in-app (RLS also enforces this).
    const { data: section, error: sectionError } = await supabase
      .from("personal_sections")
      .select("id,owner_id")
      .eq("id", sectionId)
      .maybeSingle();

    if (sectionError) {
      redirect(`/personal?error=${encodeURIComponent(sectionError.message)}`);
    }

    if (!section) {
      redirect("/personal?error=Section%20not%20found");
    }

    if (section.owner_id !== user.id) {
      redirect("/personal?error=Only%20the%20section%20owner%20can%20delete%20it");
    }

    const { error } = await supabase.from("personal_sections").delete().eq("id", sectionId);

    if (error) {
      redirect(`/personal?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/personal");
  }

  async function createPage(formData: FormData) {
    "use server";
    const supabase = createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (!user) {
      redirect("/login");
    }

    const title = String(formData.get("title") || "").trim();
    let sectionId = String(formData.get("section_id") || "").trim();
    const privacy = String(formData.get("privacy") || "private");
    const shareScope = String(formData.get("share_scope") || "page");

    if (!title) {
      redirect("/personal?error=Page%20title%20is%20required");
    }

    if (!sectionId) {
      const { data: defaultSection } = await supabase
        .from("personal_sections")
        .select("id")
        .order("sort_order", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (defaultSection?.id) {
        sectionId = defaultSection.id;
      } else {
        const { data: createdSection, error: sectionError } = await supabase
          .from("personal_sections")
          .insert({
            title: "General",
            owner_id: user.id,
            sort_order: 1,
          })
          .select("id")
          .single();

        if (sectionError || !createdSection) {
          redirect(
            `/personal?error=${encodeURIComponent(
              sectionError?.message || "Unable to create section"
            )}`
          );
        }

        sectionId = createdSection.id;
      }
    }

    const shareMode =
      privacy === "private"
        ? "private"
        : shareScope === "section"
        ? "inherit"
        : "custom";

    const { data: page, error: pageError } = await supabase
      .from("personal_pages")
      .insert({
        title,
        section_id: sectionId,
        owner_id: user.id,
        share_mode: shareMode,
        content: defaultPageContent,
        content_text: defaultPageContentText,
      })
      .select("id")
      .single();

    if (pageError || !page) {
      redirect(
        `/personal?error=${encodeURIComponent(pageError?.message || "Unable to create page")}`
      );
    }

    if (privacy !== "private") {
      const members = getSelectedMembers(formData, user.id);
      if (members.length) {
        if (shareScope === "section") {
          const inserts = members.map((member) => ({
            section_id: sectionId,
            user_id: member.user_id,
            role: member.role,
          }));
          await supabase
            .from("personal_section_members")
            .upsert(inserts, { onConflict: "section_id,user_id" });
        } else {
          const inserts = members.map((member) => ({
            page_id: page.id,
            user_id: member.user_id,
            role: member.role,
          }));
          await supabase
            .from("personal_page_members")
            .upsert(inserts, { onConflict: "page_id,user_id" });
        }
      }
    }

    revalidatePath("/personal");
    redirect(`/personal/${page.id}`);
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Personal</h1>
          <p className="text-sm text-slate-600">
            Create private or shared pages with a rich text canvas.
          </p>
        </div>
      </section>

      {searchParams?.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams.error}
        </p>
      ) : null}

      <div className="space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Sections</h2>
          <form action={createSection} className="mt-4 flex flex-wrap gap-2">
            <input
              name="title"
              placeholder="New section title"
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-md btn-primary px-3 py-2 text-xs font-semibold text-white"
            >
              Add section
            </button>
          </form>

          {sections?.length ? (
            <div className="mt-5 space-y-3">
              {sections.map((section) => {
                const isOwner = section.owner_id === user.id;
                return (
                  <div
                    key={section.id}
                    className="rounded-md border border-slate-200 bg-white p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {section.title}
                        </p>
                        <p className="text-xs text-slate-500">
                          {isOwner ? "Owner" : "Shared"}
                        </p>
                      </div>
                      {isOwner ? (
                        <details className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                          <summary className="cursor-pointer select-none font-semibold">
                            Delete
                          </summary>
                          <div className="mt-2 space-y-2">
                            <p>
                              Pages in this section will remain, but will be moved to General.
                            </p>
                            <form action={deleteSection}>
                              <input type="hidden" name="section_id" value={section.id} />
                              <button
                                type="submit"
                                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                              >
                                Confirm delete section
                              </button>
                            </form>
                          </div>
                        </details>
                      ) : null}
                    </div>

                    {isOwner ? (
                      <form action={renameSection} className="mt-3 flex flex-wrap gap-2">
                        <input type="hidden" name="section_id" value={section.id} />
                        <input
                          name="title"
                          defaultValue={section.title}
                          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
                        >
                          Rename
                        </button>
                      </form>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Create page</h2>
          <form action={createPage} className="mt-4 grid gap-4 md:grid-cols-2">
            <input
              name="title"
              placeholder="Page title"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <select
              name="section_id"
              defaultValue={
                selectedSection !== "all" ? selectedSection : sections?.[0]?.id || ""
              }
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">General</option>
              {sections?.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.title}
                </option>
              ))}
            </select>
            <select
              name="privacy"
              defaultValue="private"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="private">Private</option>
              <option value="shared">Shared</option>
            </select>
            <select
              name="share_scope"
              defaultValue="page"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="page">Share page</option>
              <option value="section">Share section</option>
            </select>
            <details className="md:col-span-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium text-slate-700">
                Share with (optional)
              </summary>
              <div className="mt-3 space-y-2">
                {users?.length ? (
                  users.map((member) => (
                    <label
                      key={member.id}
                      className="flex flex-wrap items-center gap-3 text-sm text-slate-600"
                    >
                      <input
                        type="checkbox"
                        name="share_user"
                        value={member.id}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span className="min-w-[160px]">
                        {member.full_name || member.email}
                      </span>
                      <select
                        name={`role_${member.id}`}
                        defaultValue="view"
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      >
                        <option value="view">View</option>
                        <option value="edit">Edit</option>
                      </select>
                    </label>
                  ))
                ) : (
                  <p className="text-xs text-slate-500">No users found.</p>
                )}
              </div>
            </details>
            <button
              type="submit"
              className="md:col-span-2 rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Create page
            </button>
          </form>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Pages</h2>
          </div>
          <div className="border-b border-slate-200 px-6 py-4">
            <form className="grid gap-3 md:grid-cols-5">
              <input
                name="q"
                placeholder="Search pages"
                defaultValue={query}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                name="section"
                defaultValue={selectedSection}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="all">All sections</option>
                {sections?.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.title}
                  </option>
                ))}
              </select>
              <select
                name="filter"
                defaultValue={selectedFilter}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="all">All visibility</option>
                <option value="private">Private</option>
                <option value="shared">Shared</option>
              </select>
              <select
                name="sort"
                defaultValue={selectedSort}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="updated">Recently updated</option>
                <option value="title">Title</option>
              </select>
              <button
                type="submit"
                className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white"
              >
                Apply filters
              </button>
            </form>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3">Page</th>
                  <th className="px-6 py-3">Section</th>
                  <th className="px-6 py-3">Sharing</th>
                  <th className="px-6 py-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {pages?.length ? (
                  pages.map((page) => (
                    <tr key={page.id} className="border-t border-slate-200">
                      <td className="px-6 py-3 font-medium text-slate-900">
                        <Link href={`/personal/${page.id}`} className="hover:underline">
                          {page.title}
                        </Link>
                      </td>
                      <td className="px-6 py-3 text-slate-600">
                        {getRelationTitle(page.personal_sections, "General")}
                      </td>
                      <td className="px-6 py-3 text-slate-600">
                        {shareModeLabels[page.share_mode] || "Private"}
                      </td>
                      <td className="px-6 py-3 text-slate-600">
                        {page.updated_at
                          ? new Date(page.updated_at).toLocaleDateString("en-US")
                          : "-"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-6 py-6 text-slate-500" colSpan={4}>
                      No pages found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
