"use client";

import { useMemo } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import TextAlign from "@tiptap/extension-text-align";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";

function createDefaultDoc() {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function normalizeDoc(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createDefaultDoc();
  }
  return value;
}

export default function HelpRichContent({ content }: { content: unknown }) {
  const doc = useMemo(() => normalizeDoc(content), [content]);
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [
      StarterKit,
      Highlight,
      Underline,
      TextStyle,
      FontSize,
      FontFamily,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ allowBase64: true }),
      Link.configure({
        openOnClick: true,
        autolink: false,
        linkOnPaste: false,
      }),
      Table,
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: doc,
    editorProps: {
      attributes: {
        class: "note-editor",
      },
    },
  });

  return <EditorContent editor={editor} />;
}
