"use client";

import dynamic from "next/dynamic";

const LazyNoteEditorClient = dynamic(() => import("./NoteEditorClient"), {
  ssr: false,
  loading: () => (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
      Loading editor...
    </div>
  ),
});

export default LazyNoteEditorClient;
