import Link from "next/link";
import type { DashboardSnapshotCard } from "./types";

export default function DashboardSnapshotCard({
  card,
}: {
  card: DashboardSnapshotCard;
}) {
  const content = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{card.label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${card.accent || "text-slate-900"}`}>
        {card.value}
      </p>
      {card.helper ? <p className="mt-1 text-xs text-slate-500">{card.helper}</p> : null}
    </>
  );

  if (card.href) {
    return (
      <Link
        href={card.href}
        className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow"
      >
        {content}
      </Link>
    );
  }

  return <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">{content}</div>;
}
