"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import EmojiPickerButton from "@/app/(app)/_components/EmojiPickerButton";
import MentionTextarea from "@/app/(app)/_components/MentionTextarea";
import { insertTextAtSelection } from "@/lib/emoji";

export type LinkEntityType =
  | "task"
  | "project"
  | "feature_suggestion"
  | "note"
  | "client";

type LinkOption = {
  id: string;
  label: string;
};

type AttachedLink = {
  entityType: LinkEntityType;
  entityId: string;
  label: string;
};

type AttachedImage = {
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  url: string;
};

type InsertDraftRequest = {
  id: string;
  text?: string;
  reply_to_message_id?: string;
  reply_preview?: string;
};

type ActiveReply = {
  messageId: string;
  preview: string;
};

const typeLabel: Record<LinkEntityType, string> = {
  task: "Task",
  project: "Project",
  feature_suggestion: "Feature Request",
  note: "Note",
  client: "Client",
};

const attachableLinkTypes: LinkEntityType[] = [
  "task",
  "project",
  "feature_suggestion",
];

export default function ChatComposer(props: {
  conversationId: string;
  onSend: (input: {
    body: string;
    links: AttachedLink[];
    attachments: Array<{
      storage_path: string;
      filename: string;
      mime_type: string;
      size_bytes: number;
      url?: string | null;
    }>;
    replyToMessageId?: string;
  }) => Promise<void>;
  isSending?: boolean;
  insertDraftRequest?: InsertDraftRequest | null;
}) {
  const { conversationId, onSend, isSending = false, insertDraftRequest = null } = props;
  const [body, setBody] = useState("");
  const [isSlashOpen, setIsSlashOpen] = useState(false);
  const [entityType, setEntityType] = useState<LinkEntityType>("task");
  const [query, setQuery] = useState("");
  const [entityId, setEntityId] = useState("");
  const [entityOptions, setEntityOptions] = useState<LinkOption[]>([]);
  const [isLoadingEntityOptions, setIsLoadingEntityOptions] = useState(false);
  const [entityOptionsError, setEntityOptionsError] = useState("");
  const [attachedLinks, setAttachedLinks] = useState<AttachedLink[]>([]);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [activeReply, setActiveReply] = useState<ActiveReply | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastInsertedRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isSlashOpen) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsLoadingEntityOptions(true);
      setEntityOptionsError("");
      try {
        const params = new URLSearchParams();
        params.set("type", entityType);
        if (query.trim()) {
          params.set("q", query.trim());
        }
        const res = await fetch(`/api/chat/link-options?${params.toString()}`, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          options?: LinkOption[];
        };
        if (!res.ok) {
          throw new Error(json.error || "Unable to load options");
        }
        const nextOptions = json.options || [];
        setEntityOptions(nextOptions);
        setEntityId((prev) =>
          prev && nextOptions.some((option) => option.id === prev) ? prev : ""
        );
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        setEntityOptions([]);
        setEntityId("");
        setEntityOptionsError(err instanceof Error ? err.message : "Unable to load options");
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingEntityOptions(false);
        }
      }
    }, 120);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [entityType, isSlashOpen, query]);

  useEffect(() => {
    if (!insertDraftRequest?.id) {
      return;
    }
    if (lastInsertedRequestIdRef.current === insertDraftRequest.id) {
      return;
    }
    lastInsertedRequestIdRef.current = insertDraftRequest.id;
    const replyToMessageId = String(insertDraftRequest.reply_to_message_id || "").trim();
    const replyPreview = String(insertDraftRequest.reply_preview || "").trim();
    if (replyToMessageId) {
      setActiveReply({
        messageId: replyToMessageId,
        preview: replyPreview || "Replying to message",
      });
      requestAnimationFrame(() => {
        bodyTextareaRef.current?.focus();
      });
    }

    const snippet = String(insertDraftRequest.text || "").trim();
    if (!snippet) {
      return;
    }

    setBody((current) => {
      const normalizedCurrent = current.replace(/\s+$/, "");
      const nextBody = normalizedCurrent
        ? `${normalizedCurrent}\n${snippet}\n`
        : `${snippet}\n`;
      requestAnimationFrame(() => {
        const textarea = bodyTextareaRef.current;
        if (!textarea) return;
        const caret = nextBody.length;
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
      });
      return nextBody;
    });
  }, [insertDraftRequest]);

  const uploadImage = async (file: File) => {
    const formData = new FormData();
    formData.set("conversation_id", conversationId);
    formData.set("file", file);
    const res = await fetch("/api/chat/uploads", {
      method: "POST",
      body: formData,
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      attachment?: AttachedImage;
    };
    if (!res.ok || !json.attachment) {
      throw new Error(json.error || "Unable to upload image");
    }
    return json.attachment;
  };

  const attachSelected = (selectedOption: LinkOption) => {
    const nextLink: AttachedLink = {
      entityType,
      entityId: selectedOption.id,
      label: selectedOption.label,
    };
    setAttachedLinks((prev) => {
      if (
        prev.some(
          (item) =>
            item.entityType === nextLink.entityType && item.entityId === nextLink.entityId
        )
      ) {
        return prev;
      }
      return [...prev, nextLink];
    });
    setEntityId("");
    setQuery("");
    setIsSlashOpen(false);
  };

  const uploadImageFiles = async (files: File[]) => {
    if (!files.length) return;
    setUploadError("");
    setIsUploadingImage(true);
    try {
      const uploaded = await Promise.all(files.map((file) => uploadImage(file)));
      setAttachedImages((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Unable to upload selected image"
      );
    } finally {
      setIsUploadingImage(false);
    }
  };

  const sendDisabled =
    isSending ||
    isUploadingImage ||
    (!body.trim() && !attachedLinks.length && !attachedImages.length);

  const insertEmoji = (emoji: string) => {
    setBody((current) => {
      const textarea = bodyTextareaRef.current;
      const selectionStart = textarea?.selectionStart ?? current.length;
      const selectionEnd = textarea?.selectionEnd ?? current.length;
      const { nextValue, nextSelection } = insertTextAtSelection({
        value: current,
        selectionStart,
        selectionEnd,
        text: emoji,
      });
      requestAnimationFrame(() => {
        const nextTextarea = bodyTextareaRef.current;
        if (!nextTextarea) return;
        nextTextarea.focus();
        nextTextarea.setSelectionRange(nextSelection, nextSelection);
      });
      return nextValue;
    });
  };

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setUploadError("");
        if (!body.trim() && !attachedLinks.length && !attachedImages.length) {
          return;
        }
        await onSend({
          body,
          links: attachedLinks,
          attachments: attachedImages.map((image) => ({
            storage_path: image.storage_path,
            filename: image.filename,
            mime_type: image.mime_type,
            size_bytes: image.size_bytes,
            url: image.url,
          })),
          replyToMessageId: activeReply?.messageId,
        });
        setBody("");
        setAttachedLinks([]);
        setAttachedImages([]);
        setActiveReply(null);
        setQuery("");
        setEntityId("");
      }}
      className="space-y-3 rounded-md border border-slate-200 bg-white p-3"
    >
      <div className="rounded-md border border-slate-300 bg-white">
        {activeReply ? (
          <div className="flex items-start justify-between gap-2 rounded-t-md border-b border-slate-200 bg-slate-50 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Replying to</p>
              <p className="line-clamp-1 text-xs text-slate-700">{activeReply.preview}</p>
            </div>
            <button
              type="button"
              onClick={() => setActiveReply(null)}
              className="shrink-0 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
            >
              Clear
            </button>
          </div>
        ) : null}
        <MentionTextarea
          ref={bodyTextareaRef}
          value={body}
          onValueChange={setBody}
          onPaste={async (event) => {
            const items = Array.from(event.clipboardData?.items || []);
            const imageItems = items.filter((item) => item.type.startsWith("image/"));
            if (!imageItems.length) {
              return;
            }

            event.preventDefault();
            const files = imageItems
              .map((item) => item.getAsFile())
              .filter((file): file is File => Boolean(file));
            await uploadImageFiles(files);
          }}
          onKeyDown={(event) => {
            if (event.key === "/") {
              setIsSlashOpen(true);
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!sendDisabled) {
                event.currentTarget.form?.requestSubmit();
              }
            }
          }}
          rows={3}
          placeholder="Message... Use @name to mention someone. Paste image, or type / to attach open Task, Project, or Feature Request."
          className="w-full resize-none rounded-t-md border-0 px-3 py-2 text-sm focus:outline-none"
        />
        <div className="flex items-center justify-between border-t border-slate-200 px-2 py-1.5">
          <div className="flex items-center gap-1">
            <EmojiPickerButton onSelect={insertEmoji} disabled={isSending || isUploadingImage} />
            <button
              type="button"
              onClick={() => setIsSlashOpen((prev) => !prev)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              title="Attach link"
              aria-label="Attach link"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L10 5" />
                <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L14 19" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              title="Upload image"
              aria-label="Upload image"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={async (event) => {
              const files = Array.from(event.currentTarget.files || []);
              event.currentTarget.value = "";
              await uploadImageFiles(files);
            }}
          />
          <button
            type="submit"
            disabled={sendDisabled}
            className="rounded-md btn-primary px-3 py-1.5 text-xs font-semibold text-white"
          >
            {isSending ? "Sending..." : isUploadingImage ? "Uploading..." : "Send"}
          </button>
        </div>
      </div>

      {uploadError ? <p className="text-xs text-red-600">{uploadError}</p> : null}

      {attachedImages.length ? (
        <div className="flex flex-wrap gap-2">
          {attachedImages.map((image, index) => (
            <div
              key={`${image.storage_path}-${index}`}
              className="relative h-16 w-16 overflow-hidden rounded-md border border-slate-200 bg-slate-50"
            >
              <Image
                src={image.url}
                alt={image.filename}
                fill
                unoptimized
                sizes="64px"
                className="object-cover"
              />
              <button
                type="button"
                onClick={() =>
                  setAttachedImages((prev) =>
                    prev.filter((item) => item.storage_path !== image.storage_path)
                  )
                }
                className="absolute right-1 top-1 rounded bg-black/70 px-1 text-[10px] text-white"
                title="Remove image"
              >
                x
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {attachedLinks.length ? (
        <div className="flex flex-wrap gap-2">
          {attachedLinks.map((link) => (
            <button
              key={`${link.entityType}:${link.entityId}`}
              type="button"
              onClick={() =>
                setAttachedLinks((prev) =>
                  prev.filter(
                    (item) =>
                      !(
                        item.entityType === link.entityType && item.entityId === link.entityId
                      )
                  )
                )
              }
              className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs text-slate-700"
              title="Remove link"
            >
              {typeLabel[link.entityType]}: {link.label} x
            </button>
          ))}
        </div>
      ) : null}

      {isSlashOpen ? (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-600">
            Slash link: choose a type, find an open item, and click it to attach instantly.
          </p>
          <div className="flex flex-wrap gap-2">
            {attachableLinkTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setEntityType(type);
                  setEntityId("");
                  setQuery("");
                }}
                className={`rounded-md px-2 py-1 text-xs font-medium ${
                  entityType === type
                    ? "tab-active"
                    : "border border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                /{typeLabel[type].toLowerCase().replace(/\s+/g, "-")}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${typeLabel[entityType]}...`}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          {entityOptionsError ? (
            <p className="text-xs text-red-600">{entityOptionsError}</p>
          ) : null}
          <select
            value={entityId}
            onChange={(event) => {
              const nextEntityId = event.target.value;
              setEntityId(nextEntityId);
              if (!nextEntityId) return;
              const option = entityOptions.find((item) => item.id === nextEntityId);
              if (!option) return;
              attachSelected(option);
            }}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Select {typeLabel[entityType]}</option>
            {entityOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {isLoadingEntityOptions ? (
            <p className="text-xs text-slate-500">Loading options...</p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
