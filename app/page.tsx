import { redirect } from "next/navigation";
import { getCurrentRequestUser } from "@/lib/supabase/currentUser";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = createSupabaseServerClient();
  const authUser = await getCurrentRequestUser(supabase, "home.auth");

  if (authUser) {
    redirect("/clients");
  }

  redirect("/login");
}
