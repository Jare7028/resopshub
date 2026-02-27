"use client";

export default function AddRowButton() {
  return (
    <button
      type="button"
      className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-100"
      onClick={() => {
        window.dispatchEvent(new CustomEvent("inventory:add-row"));
      }}
    >
      <span className="text-sm leading-none">+</span>
      <span>Add Row</span>
    </button>
  );
}
