"use client";

import type { ChangeEvent, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import { selectedRect } from "prosemirror-tables";
import { createEmptyDoc } from "@/lib/editorContent";

type ContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  inTable: boolean;
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
  onCreateTask?: (input: {
    title: string;
    dueDate: string | null;
    dueTime: string | null;
    assignToMe: boolean;
  }) => Promise<{ taskId: string }>;
  lastEditedAtLabel?: string | null;
  lastEditedByLabel?: string | null;
  showTopToolbar?: boolean;
  enableZoomControls?: boolean;
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

const TABLE_COLUMN_TYPES = [
  { id: "text", label: "Text" },
  { id: "number", label: "Number" },
  { id: "date", label: "Date" },
  { id: "url", label: "URL" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "checkbox", label: "Checkbox" },
] as const;

type TableColumnType = (typeof TABLE_COLUMN_TYPES)[number]["id"];

function getActiveTableColumnType(editor: Editor | null | undefined): TableColumnType {
  if (!editor || !editor.isActive("table")) {
    return "text";
  }
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    const name = node.type.name;
    if (name === "tableCell" || name === "tableHeader") {
      const colType = (node.attrs?.colType as string | undefined) || "text";
      return TABLE_COLUMN_TYPES.some((type) => type.id === colType)
        ? (colType as TableColumnType)
        : "text";
    }
  }
  return "text";
}

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

function filterSlashCommands(commands: SlashCommand[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return commands;
  }
  return commands.filter((command) => {
    const label = command.label.toLowerCase();
    if (label.includes(normalized)) {
      return true;
    }
    return command.keywords.some((keyword) => keyword.includes(normalized));
  });
}

function normalizeInlineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isPersonalPathLink(value: string) {
  return /^\/personal\/[a-f0-9-]+(?:[?#][^\s]*)?$/i.test(value.trim());
}

function getSelectedText(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  if (empty) {
    return "";
  }
  return normalizeInlineText(editor.state.doc.textBetween(from, to, " "));
}

function getCurrentLineText(editor: Editor) {
  const { $from } = editor.state.selection;
  return normalizeInlineText($from.parent.textContent || "");
}

function getSuggestedTaskTitle(editor: Editor) {
  return getSelectedText(editor) || getCurrentLineText(editor);
}

export default function NoteEditorClient({
  entityId,
  initialContent,
  title,
  placeholder,
  onSave,
  onCreateTask,
  lastEditedAtLabel,
  lastEditedByLabel,
  showTopToolbar = true,
  enableZoomControls = false,
}: NoteEditorClientProps) {
  const [isPending, startTransition] = useTransition();
  const [isTaskPending, startTaskTransition] = useTransition();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    inTable: false,
  });
  const [activeTableColType, setActiveTableColType] = useState<TableColumnType>("text");
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
  const taskTitleRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);

  const [taskCreator, setTaskCreator] = useState<{
    open: boolean;
    title: string;
    dueDate: string;
    dueTime: string;
    assignToMe: boolean;
    error: string;
  }>({
    open: false,
    title: "",
    dueDate: "",
    dueTime: "",
    assignToMe: true,
    error: "",
  });

  const [taskToast, setTaskToast] = useState<{ taskId: string; title: string } | null>(
    null
  );

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

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => (prev.open ? { ...prev, open: false } : prev));
  }, []);

  const closeTaskCreator = useCallback(() => {
    setTaskCreator((prev) => (prev.open ? { ...prev, open: false, error: "" } : prev));
  }, []);

  const openTaskCreator = useCallback(
    (prefillTitle = "") => {
      if (!onCreateTask) {
        return;
      }
      closeContextMenu();
      closeSlashMenu();
      setTaskCreator({
        open: true,
        title: prefillTitle,
        dueDate: "",
        dueTime: "",
        assignToMe: true,
        error: "",
      });
    },
    [onCreateTask, closeContextMenu, closeSlashMenu]
  );

  const slashCommands = useMemo(() => {
    if (!onCreateTask) {
      return SLASH_COMMANDS;
    }

    const taskCommand: SlashCommand = {
      id: "task",
      label: "Task",
      description: "Create a task from your note.",
      keywords: ["task", "todo", "action", "action item"],
      run: (editor, range) => {
        editor.chain().focus().deleteRange(range).run();
        openTaskCreator(getSuggestedTaskTitle(editor));
      },
    };

    return [...SLASH_COMMANDS, taskCommand];
  }, [onCreateTask, openTaskCreator]);

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

      const items = filterSlashCommands(slashCommands, match.query);
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
    [closeSlashMenu, slashCommands]
  );

  const handlePaste = useCallback((_view: unknown, event: ClipboardEvent) => {
    const clipboard = event.clipboardData;
    if (!clipboard) {
      return false;
    }

    const pastedText = clipboard.getData("text/plain").trim();
    if (pastedText && isPersonalPathLink(pastedText)) {
      event.preventDefault();
      editorRef.current
        ?.chain()
        .focus()
        .insertContent({
          type: "text",
          text: pastedText,
          marks: [{ type: "link", attrs: { href: pastedText } }],
        })
        .run();
      return true;
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
      TableHeader.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            colType: {
              default: "text",
              parseHTML: (element) => element.getAttribute("data-col-type") || "text",
              renderHTML: (attributes) =>
                attributes.colType ? { "data-col-type": attributes.colType } : {},
            },
          };
        },
      }),
      TableCell.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            colType: {
              default: "text",
              parseHTML: (element) => element.getAttribute("data-col-type") || "text",
              renderHTML: (attributes) =>
                attributes.colType ? { "data-col-type": attributes.colType } : {},
            },
          };
        },
      }),
      Link.configure({
        autolink: true,
        linkOnPaste: true,
        openOnClick: true,
        defaultProtocol: "https",
        HTMLAttributes: {
          rel: null,
          target: null,
        },
      }),
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
      const nextColType = getActiveTableColumnType(editor);
      setActiveTableColType((prev) => (prev === nextColType ? prev : nextColType));
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
      const nextColType = getActiveTableColumnType(editor);
      setActiveTableColType((prev) => (prev === nextColType ? prev : nextColType));
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

  useEffect(() => {
    if (!taskCreator.open) {
      return;
    }
    const timer = window.setTimeout(() => taskTitleRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [taskCreator.open]);

  useEffect(() => {
    if (!taskToast) {
      return;
    }
    const timer = window.setTimeout(() => setTaskToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [taskToast]);

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

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();

      const target = event.target as HTMLElement | null;
      const inTable = Boolean(target?.closest("table"));

      if (editor) {
        const pos = editor.view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        if (pos) {
          editor.chain().focus().setTextSelection(pos.pos).run();
        } else {
          editor.commands.focus();
        }
      }

      setContextMenu({
        open: true,
        x: event.clientX,
        y: event.clientY,
        inTable,
      });
    },
    [editor]
  );

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

  const submitTask = useCallback(() => {
    if (!onCreateTask) {
      return;
    }

    const taskTitle = normalizeInlineText(taskCreator.title);
    const dueDate = (taskCreator.dueDate || "").trim() || null;
    const dueTime = (taskCreator.dueTime || "").trim() || null;

    if (!taskTitle) {
      setTaskCreator((prev) => ({ ...prev, error: "Task title is required" }));
      return;
    }

    if (dueTime && !dueDate) {
      setTaskCreator((prev) => ({ ...prev, error: "Choose a due date if you set a time" }));
      return;
    }

    startTaskTransition(() => {
      void onCreateTask({
        title: taskTitle,
        dueDate,
        dueTime,
        assignToMe: taskCreator.assignToMe,
      })
        .then((result) => {
          setTaskToast({ taskId: result.taskId, title: taskTitle });
          setTaskCreator((prev) => ({ ...prev, open: false, error: "" }));
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "Unable to create task";
          setTaskCreator((prev) => ({ ...prev, error: message }));
        });
    });
  }, [onCreateTask, startTaskTransition, taskCreator]);

  const setSelectedTableColumnsType = useCallback(
    (colType: TableColumnType) => {
      if (!editor) {
        return;
      }
      if (!editor.isActive("table")) {
        return;
      }

      let rect: ReturnType<typeof selectedRect> | null = null;
      try {
        rect = selectedRect(editor.state);
      } catch {
        rect = null;
      }
      if (!rect) {
        return;
      }

      const { map, tableStart, table } = rect;
      const tr = editor.state.tr;
      const left = rect.left;
      const right = rect.right;

      for (let col = left; col < right; col += 1) {
        const columnRect = { left: col, right: col + 1, top: 0, bottom: map.height };
        const cellOffsets = map.cellsInRect(columnRect);
        cellOffsets.forEach((offset) => {
          const pos = tableStart + offset;
          const node = tr.doc.nodeAt(pos);
          if (!node) {
            return;
          }
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, colType });
        });
      }

      // Keep the table node reference in sync for table maps in follow-up ops.
      if (table && table.type) {
        // no-op placeholder; ensures we keep the variables used above intentional.
      }

      editor.view.dispatch(tr);
      editor.commands.focus();
    },
    [editor]
  );

  const editorScale = Math.max(0.2, zoomPercent / 100);

  const currentBlockStyle = useMemo(() => {
    if (!editor) {
      return "paragraph";
    }
    if (editor.isActive("heading", { level: 1 })) return "h1";
    if (editor.isActive("heading", { level: 2 })) return "h2";
    if (editor.isActive("heading", { level: 3 })) return "h3";
    if (editor.isActive("blockquote")) return "quote";
    return "paragraph";
  }, [editor]);

  const applyBlockStyle = useCallback(
    (nextStyle: string) => {
      if (!editor) {
        return;
      }
      if (nextStyle === "h1") {
        editor.chain().focus().toggleHeading({ level: 1 }).run();
        return;
      }
      if (nextStyle === "h2") {
        editor.chain().focus().toggleHeading({ level: 2 }).run();
        return;
      }
      if (nextStyle === "h3") {
        editor.chain().focus().toggleHeading({ level: 3 }).run();
        return;
      }
      if (nextStyle === "quote") {
        editor.chain().focus().toggleBlockquote().run();
        return;
      }
      editor.chain().focus().setParagraph().run();
    },
    [editor]
  );

  const setLinkFromPrompt = useCallback(() => {
    if (!editor) {
      return;
    }
    const currentHref = editor.getAttributes("link")?.href || "";
    const nextHref = window.prompt("Enter link URL", currentHref);
    if (nextHref === null) {
      return;
    }
    const trimmedHref = nextHref.trim();
    if (!trimmedHref) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmedHref }).run();
  }, [editor]);

  const insertImageFromPrompt = useCallback(() => {
    if (!editor) {
      return;
    }
    const src = window.prompt("Enter image URL");
    const trimmedSrc = String(src || "").trim();
    if (!trimmedSrc) {
      return;
    }
    editor.chain().focus().setImage({ src: trimmedSrc }).run();
  }, [editor]);

  const insertSectionBox = useCallback(() => {
    if (!editor) {
      return;
    }
    editor
      .chain()
      .focus()
      .insertContent({
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Section box" }],
          },
        ],
      })
      .run();
  }, [editor]);

  const clearFormatting = useCallback(() => {
    if (!editor) {
      return;
    }
    editor.chain().focus().unsetAllMarks().clearNodes().run();
  }, [editor]);

  const triggerAttachmentPicker = useCallback(() => {
    attachmentInputRef.current?.click();
  }, []);

  const handleAttachmentSelected = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.currentTarget.value = "";
      if (!file || !editor) {
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        window.alert("Attachment is too large. Use files up to 5 MB.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") {
          return;
        }
        if (file.type.startsWith("image/")) {
          editor.chain().focus().setImage({ src: result }).run();
          return;
        }
        editor
          .chain()
          .focus()
          .insertContent({
            type: "paragraph",
            content: [
              {
                type: "text",
                text: file.name,
                marks: [{ type: "link", attrs: { href: result } }],
              },
            ],
          })
          .run();
      };
      reader.readAsDataURL(file);
    },
    [editor]
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

  const metaTooltip = useMemo(() => {
    if (!lastEditedAtLabel && !lastEditedByLabel) {
      return "";
    }
    const parts: string[] = [];
    if (lastEditedAtLabel) {
      parts.push(`Last edited: ${lastEditedAtLabel}`);
    }
    if (lastEditedByLabel) {
      parts.push(`Edited by: ${lastEditedByLabel}`);
    }
    return parts.join("\n");
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
        <div className="flex flex-wrap items-center gap-2">
          {onCreateTask ? (
            <button
              type="button"
              onClick={() => openTaskCreator(getSuggestedTaskTitle(editor))}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
            >
              + Task
            </button>
          ) : null}
          <span className="text-xs text-slate-400">
            {isPending ? "Saving..." : "Saved"}
            {metaLabel ? ` - ${metaLabel}` : ""}
          </span>
        </div>
      </div>

      {taskToast ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <span>
            Task created: <span className="font-semibold">{taskToast.title}</span>
          </span>
          <div className="flex items-center gap-3">
            <a
              href={`/tasks/${taskToast.taskId}`}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-800 underline underline-offset-2 hover:text-emerald-900"
            >
              Open
            </a>
            <button
              type="button"
              onClick={() => setTaskToast(null)}
              className="text-xs font-semibold text-emerald-800 hover:text-emerald-900"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {showTopToolbar ? (
        <div className="sticky top-0 z-20 mt-4 space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold text-slate-600">Style</label>
            <select
              value={currentBlockStyle}
              onChange={(event) => applyBlockStyle(event.target.value)}
              className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
            >
              <option value="paragraph">Paragraph</option>
              <option value="h1">Heading 1</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
              <option value="quote">Callout / Quote</option>
            </select>

            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                editor.isActive("bold")
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-700"
              }`}
            >
              Bold
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                editor.isActive("italic")
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-700"
              }`}
            >
              Italic
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                editor.isActive("underline")
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-700"
              }`}
            >
              Underline
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHighlight().run()}
              className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                editor.isActive("highlight")
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-700"
              }`}
            >
              Highlight
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                editor.isActive("bulletList")
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-700"
              }`}
            >
              Bullets
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                editor.isActive("orderedList")
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-700"
              }`}
            >
              Numbered
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleTaskList().run()}
              className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                editor.isActive("taskList")
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-700"
              }`}
            >
              Checklist
            </button>
            <button
              type="button"
              onClick={insertSectionBox}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
            >
              Add box
            </button>
            <button
              type="button"
              onClick={setLinkFromPrompt}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
            >
              Link
            </button>
            <button
              type="button"
              onClick={insertImageFromPrompt}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
            >
              Image
            </button>
            <button
              type="button"
              onClick={triggerAttachmentPicker}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
            >
              Attachment
            </button>
            <button
              type="button"
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run()
              }
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
            >
              Table
            </button>
            <button
              type="button"
              onClick={clearFormatting}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
            >
              Clear format
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().undo().run()}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().redo().run()}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
            >
              Redo
            </button>
          </div>
          {editor.isActive("table") ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Selected column type</span>
              <select
                value={activeTableColType}
                onChange={(event) =>
                  setSelectedTableColumnsType(event.target.value as TableColumnType)
                }
                className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
              >
                {TABLE_COLUMN_TYPES.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className={showTopToolbar ? "mt-3" : "mt-4"}
        onContextMenu={handleContextMenu}
        title={metaTooltip || undefined}
      >
        <BubbleMenu
          editor={editor}
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
            {editor.isActive("table") ? (
              <label className="ml-1 flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600">
                <span className="font-semibold text-slate-500">Column</span>
                <select
                  value={activeTableColType}
                  onChange={(event) =>
                    setSelectedTableColumnsType(event.target.value as TableColumnType)
                  }
                  className="bg-transparent text-xs text-slate-700 outline-none"
                >
                  {TABLE_COLUMN_TYPES.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </BubbleMenu>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-4">
          <div
            style={{
              transform: `scale(${editorScale})`,
              transformOrigin: "top left",
              width: `${100 / editorScale}%`,
            }}
          >
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
      <input
        ref={attachmentInputRef}
        type="file"
        className="hidden"
        onChange={handleAttachmentSelected}
      />

      {enableZoomControls ? (
        <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          <button
            type="button"
            onClick={() => setZoomPercent((prev) => Math.max(20, prev - 10))}
            className="h-8 w-8 rounded-md border border-slate-300 text-sm font-semibold text-slate-700 hover:border-slate-400"
            aria-label="Zoom out"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => setZoomPercent(100)}
            className="h-8 min-w-[3.8rem] rounded-md border border-slate-300 px-2 text-xs font-semibold text-slate-700 hover:border-slate-400"
            aria-label="Reset zoom"
          >
            {zoomPercent}%
          </button>
          <button
            type="button"
            onClick={() => setZoomPercent((prev) => Math.min(1000, prev + 10))}
            className="h-8 w-8 rounded-md border border-slate-300 text-sm font-semibold text-slate-700 hover:border-slate-400"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      ) : null}

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
                No commands match &quot;{slashMenu.query}&quot;.
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
          className="fixed z-50 w-56 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          ref={contextMenuRef}
        >
          {onCreateTask ? (
            <>
              <button
                type="button"
                onClick={() => openTaskCreator(getSuggestedTaskTitle(editor))}
                className="context-menu-item font-semibold text-slate-900"
              >
                Create task
              </button>
              <div className="my-1 border-t border-slate-200" />
            </>
          ) : null}
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
              run(() =>
                editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
              )
            }
            className="context-menu-item"
          >
            Insert table
          </button>
          {contextMenu.inTable ? (
            <>
              <div className="my-1 border-t border-slate-200" />
              <button
                type="button"
                onClick={() => run(() => editor.chain().focus().addRowBefore().run())}
                className="context-menu-item"
              >
                Insert row above
              </button>
              <button
                type="button"
                onClick={() => run(() => editor.chain().focus().addRowAfter().run())}
                className="context-menu-item"
              >
                Insert row below
              </button>
              <button
                type="button"
                onClick={() => run(() => editor.chain().focus().addColumnBefore().run())}
                className="context-menu-item"
              >
                Insert column left
              </button>
              <button
                type="button"
                onClick={() => run(() => editor.chain().focus().addColumnAfter().run())}
                className="context-menu-item"
              >
                Insert column right
              </button>
              <button
                type="button"
                onClick={() => run(() => editor.chain().focus().deleteRow().run())}
                className="context-menu-item"
              >
                Delete row
              </button>
              <button
                type="button"
                onClick={() => run(() => editor.chain().focus().deleteColumn().run())}
                className="context-menu-item"
              >
                Delete column
              </button>
              <button
                type="button"
                onClick={() => run(() => editor.chain().focus().deleteTable().run())}
                className="context-menu-item text-red-600 hover:text-red-700"
              >
                Delete table
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => run(() => editor.chain().focus().setHorizontalRule().run())}
            className="context-menu-item"
          >
            Divider
          </button>
        </div>
      ) : null}

      {taskCreator.open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"
          onMouseDown={() => closeTaskCreator()}
        >
          <div
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Create task
                </p>
                <h3 className="text-lg font-semibold text-slate-900">New task</h3>
              </div>
              <button
                type="button"
                onClick={() => closeTaskCreator()}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
              >
                Close
              </button>
            </div>

            {taskCreator.error ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {taskCreator.error}
              </p>
            ) : null}

            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                submitTask();
              }}
            >
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-600">Title</label>
                <input
                  ref={taskTitleRef}
                  value={taskCreator.title}
                  onChange={(event) =>
                    setTaskCreator((prev) => ({ ...prev, title: event.target.value }))
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Task title"
                  required
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">Due date</label>
                  <input
                    type="date"
                    value={taskCreator.dueDate}
                    onChange={(event) =>
                      setTaskCreator((prev) => ({ ...prev, dueDate: event.target.value }))
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">Time</label>
                  <input
                    type="time"
                    value={taskCreator.dueTime}
                    onChange={(event) =>
                      setTaskCreator((prev) => ({ ...prev, dueTime: event.target.value }))
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={taskCreator.assignToMe}
                  onChange={(event) =>
                    setTaskCreator((prev) => ({ ...prev, assignToMe: event.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300"
                />
                Assign to me
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => closeTaskCreator()}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isTaskPending}
                  className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {isTaskPending ? "Creating..." : "Create task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
