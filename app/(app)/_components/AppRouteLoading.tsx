type LoadingVariant = "table" | "matrix" | "dashboard" | "chat" | "cards" | "form";

function PulseBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-slate-100 ${className}`} />;
}

function LoadingHeader() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <PulseBlock className="h-4 w-24" />
          <PulseBlock className="h-7 w-48" />
        </div>
        <div className="flex gap-2">
          <PulseBlock className="h-10 w-24" />
          <PulseBlock className="h-10 w-28" />
        </div>
      </div>
    </section>
  );
}

function TableLoading() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PulseBlock className="h-6 w-32" />
          <div className="flex gap-2">
            <PulseBlock className="h-9 w-24" />
            <PulseBlock className="h-9 w-24" />
            <PulseBlock className="h-9 w-24" />
          </div>
        </div>
      </div>
      <div className="hidden divide-y divide-slate-100 md:block">
        {Array.from({ length: 9 }).map((_, index) => (
          <div key={index} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 px-6 py-4">
            <PulseBlock className="h-4 w-full" />
            <PulseBlock className="h-4 w-full" />
            <PulseBlock className="h-4 w-full" />
            <PulseBlock className="h-4 w-full" />
            <PulseBlock className="h-4 w-full" />
          </div>
        ))}
      </div>
      <div className="space-y-3 p-4 md:hidden">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-slate-200 p-4">
            <PulseBlock className="h-5 w-3/4" />
            <div className="mt-3 flex gap-2">
              <PulseBlock className="h-6 w-20" />
              <PulseBlock className="h-6 w-24" />
            </div>
            <PulseBlock className="mt-4 h-4 w-full" />
          </div>
        ))}
      </div>
    </section>
  );
}

function MatrixLoading() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PulseBlock className="h-6 w-40" />
          <PulseBlock className="h-10 w-36" />
        </div>
      </div>
      <div className="overflow-hidden p-4">
        <div className="grid min-w-[760px] grid-cols-6 gap-3">
          {Array.from({ length: 36 }).map((_, index) => (
            <PulseBlock key={index} className={index < 6 ? "h-5 w-full" : "h-9 w-full"} />
          ))}
        </div>
      </div>
    </section>
  );
}

function DashboardLoading() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <section key={index} className="rounded-lg border border-slate-200 bg-white p-4">
            <PulseBlock className="h-4 w-20" />
            <PulseBlock className="mt-4 h-8 w-16" />
            <PulseBlock className="mt-3 h-3 w-28" />
          </section>
        ))}
      </div>
      <TableLoading />
    </div>
  );
}

function ChatLoading() {
  return (
    <section className="grid h-[calc(100vh-9rem)] overflow-hidden rounded-lg border border-slate-200 bg-white md:grid-cols-[20rem_1fr]">
      <div className="border-b border-slate-200 p-4 md:border-b-0 md:border-r">
        <PulseBlock className="h-10 w-full" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="flex gap-3">
              <PulseBlock className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <PulseBlock className="h-4 w-3/4" />
                <PulseBlock className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col p-5">
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <PulseBlock
              key={index}
              className={`h-14 ${index % 2 === 0 ? "mr-24" : "ml-24"}`}
            />
          ))}
        </div>
        <PulseBlock className="mt-auto h-12 w-full" />
      </div>
    </section>
  );
}

function CardsLoading() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 9 }).map((_, index) => (
        <section key={index} className="rounded-lg border border-slate-200 bg-white p-4">
          <PulseBlock className="h-5 w-3/4" />
          <PulseBlock className="mt-3 h-4 w-full" />
          <PulseBlock className="mt-2 h-4 w-2/3" />
          <div className="mt-4 flex gap-2">
            <PulseBlock className="h-7 w-20" />
            <PulseBlock className="h-7 w-24" />
          </div>
        </section>
      ))}
    </div>
  );
}

function FormLoading() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index}>
            <PulseBlock className="h-4 w-24" />
            <PulseBlock className="mt-2 h-11 w-full" />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function AppRouteLoading({
  variant = "table",
  showHeader = true,
}: {
  variant?: LoadingVariant;
  showHeader?: boolean;
}) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      {showHeader ? <LoadingHeader /> : null}
      {variant === "matrix" ? (
        <MatrixLoading />
      ) : variant === "dashboard" ? (
        <DashboardLoading />
      ) : variant === "chat" ? (
        <ChatLoading />
      ) : variant === "cards" ? (
        <CardsLoading />
      ) : variant === "form" ? (
        <FormLoading />
      ) : (
        <TableLoading />
      )}
      <span className="sr-only">Loading</span>
    </div>
  );
}
