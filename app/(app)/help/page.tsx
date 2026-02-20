import HelpCenterClient from "./_components/HelpCenterClient";
import { loadHelpGuides } from "@/lib/helpGuidesStore";

export const dynamic = "force-dynamic";

export default async function HelpPage() {
  const { guides } = await loadHelpGuides();
  return <HelpCenterClient guides={guides} />;
}
