"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import EmojiPickerButton from "@/app/(app)/_components/EmojiPickerButton";
import { insertTextAtSelection } from "@/lib/emoji";
import { buildSocialInlineImageToken } from "@/lib/socialPostContent";

type UploadedSocialImage = {
  storage_path: string;
  url: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
};

function SubmitButton({
  disabled,
}: {
  disabled: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded-md btn-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Posting..." : "Post update"}
    </button>
  );
}

export default function SocialPostComposer({
  socialPageId,
  canPost,
  action,
}: {
  socialPageId: string;
  canPost: boolean;
  action: (formData: FormData) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [uploadedImages, setUploadedImages] = useState<UploadedSocialImage[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const maxImages = 6;

  const uploadImage = async (file: File) => {
    const formData = new FormData();
    formData.set("file", file);

    const response = await fetch(`/api/social/pages/${socialPageId}/images`, {
      method: "POST",
      body: formData,
    });

    const json = (await response.json().catch(() => ({}))) as {
      error?: string;
      image?: UploadedSocialImage;
    };

    if (!response.ok || !json.image) {
      throw new Error(json.error || "Unable to upload image.");
    }

    return json.image;
  };

  const uploadImageFiles = async (files: File[]) => {
    if (!files.length) return;
    if (!canPost) return;

    const remainingSlots = maxImages - uploadedImages.length;
    const limitedFiles = files.slice(0, Math.max(remainingSlots, 0));

    if (!limitedFiles.length) {
      setUploadError(`You can attach up to ${maxImages} images per post.`);
      return;
    }

    setUploadError("");
    setIsUploading(true);

    try {
      const uploaded = await Promise.all(limitedFiles.map((file) => uploadImage(file)));
      const existingPaths = new Set(uploadedImages.map((item) => item.storage_path));
      const deduped = uploaded.filter((item) => !existingPaths.has(item.storage_path));
      setUploadedImages((previous) => [...previous, ...deduped]);
      if (deduped.length) {
        const inlineText = deduped
          .map((item) => buildSocialInlineImageToken(item.storage_path))
          .filter(Boolean)
          .map((token) => `\n${token}\n`)
          .join("\n");

        setBody((current) => {
          const textarea = bodyTextareaRef.current;
          const selectionStart = textarea?.selectionStart ?? current.length;
          const selectionEnd = textarea?.selectionEnd ?? current.length;
          const { nextValue, nextSelection } = insertTextAtSelection({
            value: current,
            selectionStart,
            selectionEnd,
            text: inlineText,
          });
          requestAnimationFrame(() => {
            const nextTextarea = bodyTextareaRef.current;
            if (!nextTextarea) return;
            nextTextarea.focus();
            nextTextarea.setSelectionRange(nextSelection, nextSelection);
          });
          return nextValue;
        });
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

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
    <form action={action} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-slate-900">Share an update</h2>
        <p className="text-xs text-slate-500">Post text, add images, and keep your team aligned.</p>
      </div>

      <input
        type="hidden"
        name="images_json"
        value={JSON.stringify(
          uploadedImages.map((image) => ({
            storage_path: image.storage_path,
            url: image.url,
            filename: image.filename,
            mime_type: image.mime_type,
            size_bytes: image.size_bytes,
          }))
        )}
      />

      <textarea
        ref={bodyTextareaRef}
        name="body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onPaste={async (event) => {
          const items = Array.from(event.clipboardData?.items || []);
          const imageItems = items.filter((item) => item.type.startsWith("image/"));
          if (!imageItems.length) return;

          event.preventDefault();
          const files = imageItems
            .map((item) => item.getAsFile())
            .filter((file): file is File => Boolean(file));
          await uploadImageFiles(files);
        }}
        rows={4}
        placeholder="What should people know today? Type @name to mention someone."
        className="w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
        disabled={!canPost}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <EmojiPickerButton
            onSelect={insertEmoji}
            disabled={!canPost || isUploading}
            className="inline-flex h-[36px] w-[36px] items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canPost || isUploading || uploadedImages.length >= maxImages}
          >
            {isUploading ? "Uploading..." : "Add images"}
          </button>
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
          <p className="text-xs text-slate-500">
            {uploadedImages.length}/{maxImages} images
          </p>
        </div>

        <SubmitButton
          disabled={!canPost || isUploading || !body.trim()}
        />
      </div>

      {uploadError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {uploadError}
        </p>
      ) : (
        <p className="text-xs text-slate-500">
          Images are inserted inline where your cursor is.
        </p>
      )}

      {uploadedImages.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {uploadedImages.map((image) => (
            <div
              key={image.storage_path}
              className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
            >
              <div className="relative aspect-square">
                <Image
                  src={image.url}
                  alt={image.filename || "Uploaded image"}
                  fill
                  sizes="(max-width: 768px) 50vw, 180px"
                  className="object-cover"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setUploadedImages((previous) =>
                    previous.filter((item) => item.storage_path !== image.storage_path)
                  );
                  setBody((current) => {
                    const token = buildSocialInlineImageToken(image.storage_path);
                    return current
                      .split(token)
                      .join("")
                      .replace(/\n{3,}/g, "\n\n")
                      .trimStart();
                  });
                }}
                className="absolute right-2 top-2 rounded-md bg-slate-900/75 px-2 py-1 text-[11px] font-semibold text-white"
                title="Remove image"
                aria-label="Remove image"
                disabled={!canPost}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {!canPost ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          You have view-only access to this page.
        </p>
      ) : null}
    </form>
  );
}
