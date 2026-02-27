"use client";

export default function AddRowButton() {
  return (
    <button
      type="button"
      className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
      onClick={() => {
        window.dispatchEvent(new CustomEvent("employee-info:add-row"));
      }}
    >
      Add Row
    </button>
  );
}
