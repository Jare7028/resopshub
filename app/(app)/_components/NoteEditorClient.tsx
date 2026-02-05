"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, TiptapBubbleMenu, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import { createEmptyDoc } from "@/lib/editorContent";

type ContextMenuState = {
  open: boolean;
  x: number;
  y: number;
};

type SlashRange = {
  from: number;
  to: number;
};

type SlashCommand = {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  run: (editor: Editor, range: SlashRange) => void;
};

type SlashMenuState = {
  open: boolean;
  query: string;
  x: number;
  y: number;
  index: number;
  range: SlashRange | null;
  items: SlashCommand[];
};

type NoteEditorClientProps = {
  entityId: string;
  initialContent: unknown;
  title: string;
  placeholder: string;
  onSave: (entityId: string, content: unknown) => Promise<void>;
  lastEditedAtLabel?: string | null;
  lastEditedByLabel?: string | null;
};

const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "paragraph",
    label: "Paragraph",
    description: "Start with plain text.",
    keywords: ["text", "p"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    id: "heading1",
    label: "Heading 1",
    description: "Large section heading.",
    keywords: ["h1", "title"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    id: "heading2",
    label: "Heading 2",
    description: "Medium section heading.",
    keywords: ["h2", "subtitle"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    id: "heading3",
    label: "Heading 3",
    description: "Small section heading.",
    keywords: ["h3"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    id: "bullet-list",
    label: "Bulleted list",
    description: "Create a bulleted list.",
    keywords: ["bullet", "list", "ul"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "ordered-list",
    label: "Numbered list",
    description: "Create a numbered list.",
    keywords: ["number", "list", "ol"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "checklist",
    label: "Checklist",
    description: "Track tasks with checkboxes.",
    keywords: ["check", "todo", "task"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "quote",
    label: "Quote / Callout",
    description: "Emphasize a quote or callout.",
    keywords: ["quote", "callout", "blockquote"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: "table",
    label: "Table",
    description: "Insert a 3x3 table.",
    keywords: ["table", "grid", "rows", "cols"],
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    id: "divider",
    label: "Divider",
    description: "Insert a horizontal rule.",
    keywords: ["divider", "hr", "line"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

function normalizeContent(content: unknown) {
  if (content && typeof content === "object") {
    const value = content as { type?: string };
    if (value.type === "doc") {
      return content;
    }
  }
  return createEmptyDoc();
}

function getSlashMatch(editor: Editor) {
  const { state } = editor;
  if (!state.selection.empty) {
    return null;
  }

  const { from } = state.selection;
  const start = Math.max(0, from - 120);
  const textBefore = state.doc.textBetween(start, from, "\n", "\n");
  const slashIndex = textBefore.lastIndexOf("/");

  if (slashIndex === -1) {
    return null;
  }

  const charBefore = slashIndex > 0 ? textBefore[slashIndex - 1] : " ";
  if (charBefore && !/\s/.test(charBefore)) {
    return null;
  }

  const query = textBefore.slice(slashIndex + 1);
  if (query.includes(" ") || query.length > 32) {
    return null;
  }

  const fromPos = from - query.length - 1;
  return {
    range: { from: fromPos, to: from },
    query,
  };
}

function filterSlashCommands(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return SLASH_COMMANDS;
  }
  return SLASH_COMMANDS.filter((command) => {
    const label = command.label.toLowerCase();
    if (label.includes(normalized)) {
      return true;
    }
    return command.keywords.some((keyword) => keyword.includes(normalized));
  });
}

export default function NoteEditorClient({
  entityId,
  initialContent,
  title,
  placeholder,
  onSave,
  lastEditedAtLabel,
  lastEditedByLabel,
}: NoteEditorClientProps) {
  const [isPending, startTransition] = useTransition();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
  });
  const [slashMenu, setSlashMenu] = useState<SlashMenuState>({
    open: false,
    query: "",
    x: 0,
    y: 0,
    index: 0,
    range: null,
    items: [],
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const slashMenuStateRef = useRef<SlashMenuState>(slashMenu);
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    slashMenuStateRef.current = slashMenu;
  }, [slashMenu]);

  const closeSlashMenu = useCallback(() => {
    setSlashMenu((prev) =>
      prev.open
        ? { ...prev, open: false, query: "", items: [], range: null, index: 0 }
        : prev
    );
  }, []);

  const applySlashCommand = useCallback(
    (command: SlashCommand, range: SlashRange) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) {
        return;
      }
      command.run(currentEditor, range);
      closeSlashMenu();
    },
    [closeSlashMenu]
  );

  const handleEditorKeyDown = useCallback(
    (_view: unknown, event: KeyboardEvent) => {
      const menu = slashMenuStateRef.current;
      if (!menu.open) {
        return false;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashMenu((prev) => {
          if (!prev.items.length) {
            return prev;
          }
          return {
            ...prev,
            index: (prev.index + 1) % prev.items.length,
          };
        });
        return true;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashMenu((prev) => {
          if (!prev.items.length) {
            return prev;
          }
          return {
            ...prev,
            index: (prev.index - 1 + prev.items.length) % prev.items.length,
          };
        });
        return true;
      }

      if (event.key === "Enter") {
        if (menu.items.length && menu.range) {
          event.preventDefault();
          const command = menu.items[menu.index] || menu.items[0];
          applySlashCommand(command, menu.range);
          return true;
        }
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeSlashMenu();
        return true;
      }

      return false;
    },
    [applySlashCommand, closeSlashMenu]
  );

  const updateSlashMenu = useCallback(
    (editor: Editor) => {
      const match = getSlashMatch(editor);
      if (!match) {
        if (slashMenuStateRef.current.open) {
          closeSlashMenu();
        }
        return;
      }

      const items = filterSlashCommands(match.query);
      const coords = editor.view.coordsAtPos(match.range.from);
      setSlashMenu((prev) => {
        const queryChanged = prev.query !== match.query;
        const nextIndex = items.length
          ? Math.min(queryChanged ? 0 : prev.index, items.length - 1)
          : 0;
        return {
          open: true,
          query: match.query,
          x: coords.left,
          y: coords.bottom + 6,
          index: nextIndex,
          range: match.range,
          items,
        };
      });
    },
    [closeSlashMenu]
  );

  const handlePaste = useCallback((_view: unknown, event: ClipboardEvent) => {
    const clipboard = event.clipboardData;
    if (!clipboard) {
      return false;
    }

    const imageItems = Array.from(clipboard.items || []).filter((item) =>
      item.type.startsWith("image/")
    );

    if (!imageItems.length) {
      return false;
    }

    event.preventDefault();

    imageItems.forEach((item) => {
      const file = item.getAsFile();
      if (!file) {
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const src = reader.result;
        if (typeof src === "string") {
          editorRef.current?.chain().focus().setImage({ src }).run();
        }
      };
      reader.readAsDataURL(file);
    });

    return true;
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Highlight,
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: normalizeContent(initialContent),
    editorProps: {
      attributes: {
        class: "note-editor",
      },
      handleKeyDown: handleEditorKeyDown,
      handlePaste,
    },
    onUpdate: ({ editor }) => {
      updateSlashMenu(editor);
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      const json = editor.getJSON();
      saveTimer.current = setTimeout(() => {
        startTransition(() => {
          void onSave(entityId, json);
        });
      }, 600);
    },
    onSelectionUpdate: ({ editor }) => {
      updateSlashMenu(editor);
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => (prev.open ? { ...prev, open: false } : prev));
  }, []);

  useEffect(() => {
    if (!contextMenu.open) {
      return;
    }

    const handleClick = () => closeContextMenu();
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };
    window.addEventListener("click", handleClick);
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [contextMenu.open, closeContextMenu]);

  useEffect(() => {
    if (!slashMenu.open) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      if (slashMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      closeSlashMenu();
    };

    window.addEventListener("click", handleClick);
    return () => {
      window.removeEventListener("click", handleClick);
    };
  }, [slashMenu.open, closeSlashMenu]);

  useEffect(() => {
    if (!contextMenu.open || !contextMenuRef.current) {
      return;
    }

    const rect = contextMenuRef.current.getBoundingClientRect();
    const padding = 8;
    const maxLeft = window.innerWidth - rect.width - padding;
    const maxTop = window.innerHeight - rect.height - padding;
    const nextLeft = Math.max(padding, Math.min(contextMenu.x, maxLeft));
    const nextTop = Math.max(padding, Math.min(contextMenu.y, maxTop));

    if (nextLeft !== contextMenu.x || nextTop !== contextMenu.y) {
      setContextMenu((prev) =>
        prev.open ? { ...prev, x: nextLeft, y: nextTop } : prev
      );
    }
  }, [contextMenu.open, contextMenu.x, contextMenu.y]);

  useEffect(() => {
    if (!slashMenu.open || !slashMenuRef.current) {
      return;
    }

    const rect = slashMenuRef.current.getBoundingClientRect();
    const padding = 8;
    const maxLeft = window.innerWidth - rect.width - padding;
    const maxTop = window.innerHeight - rect.height - padding;
    const nextLeft = Math.max(padding, Math.min(slashMenu.x, maxLeft));
    const nextTop = Math.max(padding, Math.min(slashMenu.y, maxTop));

    if (nextLeft !== slashMenu.x || nextTop !== slashMenu.y) {
      setSlashMenu((prev) =>
        prev.open ? { ...prev, x: nextLeft, y: nextTop } : prev
      );
    }
  }, [slashMenu.open, slashMenu.x, slashMenu.y]);

  const handleContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    setContextMenu({
      open: true,
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  const run = useCallback(
    (command: () => void) => {
      if (!editor) {
        return;
      }
      command();
      closeContextMenu();
      editor.commands.focus();
    },
    [editor, closeContextMenu]
  );

  const bubbleActions = useMemo(
    () => [
      {
        label: "B",
        active: editor?.isActive("bold"),
        onClick: () => editor?.chain().focus().toggleBold().run(),
      },
      {
        label: "I",
        active: editor?.isActive("italic"),
        onClick: () => editor?.chain().focus().toggleItalic().run(),
      },
      {
        label: "U",
        active: editor?.isActive("underline"),
        onClick: () => editor?.chain().focus().toggleUnderline().run(),
      },
      {
        label: "Highlight",
        active: editor?.isActive("highlight"),
        onClick: () => editor?.chain().focus().toggleHighlight().run(),
      },
      {
        label: "Bullet list",
        active: editor?.isActive("bulletList"),
        onClick: () => editor?.chain().focus().toggleBulletList().run(),
      },
      {
        label: "Numbered list",
        active: editor?.isActive("orderedList"),
        onClick: () => editor?.chain().focus().toggleOrderedList().run(),
      },
      {
        label: "Checklist",
        active: editor?.isActive("taskList"),
        onClick: () => editor?.chain().focus().toggleTaskList().run(),
      },
    ],
    [editor]
  );

  const metaLabel = useMemo(() => {
    if (!lastEditedAtLabel && !lastEditedByLabel) {
      return "";
    }
    const parts: string[] = [];
    if (lastEditedAtLabel) {
      parts.push(`Last edited ${lastEditedAtLabel}`);
    }
    if (lastEditedByLabel) {
      parts.push(`by ${lastEditedByLabel}`);
    }
    return parts.join(" ");
  }, [lastEditedAtLabel, lastEditedByLabel]);

  if (!editor) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="h-[240px] animate-pulse rounded-md bg-slate-100" />
      </div>
    );
  }

  const activeSlashItem = slashMenu.items[slashMenu.index];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <span className="text-xs text-slate-400">
          {isPending ? "Saving..." : "Saved"}
          {metaLabel ? ` - ${metaLabel}` : ""}
        </span>
      </div>

      <div className="mt-4" onContextMenu={handleContextMenu}>
        <TiptapBubbleMenu
          editor={editor}
          tippyOptions={{ duration: 150 }}
          className="rounded-md border border-slate-200 bg-white p-1 shadow-md"
        >
          <div className="flex flex-wrap items-center gap-1">
            {bubbleActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                className={`rounded-md px-2 py-1 text-xs font-medium ${
                  action.active
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>
        </TiptapBubbleMenu>
        <EditorContent editor={editor} />
      </div>

      {slashMenu.open ? (
        <div
          className="fixed z-50 w-72 rounded-md border border-slate-200 bg-white shadow-lg"
          style={{ top: slashMenu.y, left: slashMenu.x }}
          ref={slashMenuRef}
        >
          <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase text-slate-400">
            Slash commands
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {slashMenu.items.length ? (
              slashMenu.items.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() =>
                    setSlashMenu((prev) => ({ ...prev, index }))
                  }
                  onClick={() =>
                    slashMenu.range ? applySlashCommand(item, slashMenu.range) : null
                  }
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm ${
                    index === slashMenu.index
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="font-semibold">{item.label}</span>
                  <span className="text-xs text-slate-500">{item.description}</span>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-slate-500">
                No commands match "{slashMenu.query}".
              </div>
            )}
          </div>
          {activeSlashItem ? (
            <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-400">
              Tip: type to filter, use arrows then Enter to insert.
            </div>
          ) : null}
        </div>
      ) : null}

      {contextMenu.open ? (
        <div
          className="fixed z-50 w-52 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          ref={contextMenuRef}
        >
          <button
            type="button"
            onClick={() => run(() => editor.chain().focus().setParagraph().run())}
            className="context-menu-item"
          >
            Paragraph
          </button>
          <button
            type="button"
            onClick={() => run(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}
            className="context-menu-item"
          >
            Heading 1
          </button>
          <button
            type="button"
            onClick={() => run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}
            className="context-menu-item"
          >
            Heading 2
          </button>
          <button
            type="button"
            onClick={() => run(() => editor.chain().focus().toggleBulletList().run())}
            className="context-menu-item"
          >
            Bulleted list
          </button>
          <button
            type="button"
            onClick={() => run(() => editor.chain().focus().toggleOrderedList().run())}
            className="context-menu-item"
          >
            Numbered list
          </button>
          <button
            type="button"
            onClick={() => run(() => editor.chain().focus().toggleTaskList().run())}
            className="context-menu-item"
          >
            Checklist
          </button>
          <button
            type="button"
            onClick={() => run(() => editor.chain().focus().toggleBlockquote().run())}
            className="context-menu-item"
          >
            Quote / Callout
          </button>
          <button
            type="button"
            onClick={() =>
              run(() => editor.chain().focus().insertTable({ rows: 3, cols: 3 }).run())
            }
            className="context-menu-item"
          >
            Insert table
          </button>
          <button
            type="button"
            onClick={() => run(() => editor.chain().focus().setHorizontalRule().run())}
            className="context-menu-item"
          >
            Divider
          </button>
        </div>
      ) : null}
    </section>
  );
}
