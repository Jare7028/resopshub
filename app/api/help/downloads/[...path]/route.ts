import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  HELP_GUIDE_DOWNLOADS_BUCKET,
  buildAttachmentContentDisposition,
  guessHelpDownloadContentType,
  normalizeHelpDownloadPathFromSegments,
} from "@/lib/helpGuideDownloads";

export const dynamic = "force-dynamic";

const LOCAL_HELP_DOWNLOADS_DIR = resolve(process.cwd(), "public", "downloads");

type DownloadPayload = {
  body: ArrayBuffer;
  contentType: string;
  sizeBytes: number;
};

function createDownloadHeaders(filename: string, contentType: string, sizeBytes: number) {
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Content-Disposition", buildAttachmentContentDisposition(filename));
  headers.set("Cache-Control", "public, max-age=3600, s-maxage=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  if (Number.isFinite(sizeBytes) && sizeBytes >= 0) {
    headers.set("Content-Length", String(sizeBytes));
  }
  return headers;
}

async function downloadFromSupabaseStorage(storagePath: string): Promise<DownloadPayload | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.storage
      .from(HELP_GUIDE_DOWNLOADS_BUCKET)
      .download(storagePath);
    if (error || !data) {
      return null;
    }
    const body = await data.arrayBuffer();
    return {
      body,
      sizeBytes: body.byteLength,
      contentType: data.type || guessHelpDownloadContentType(storagePath),
    };
  } catch {
    return null;
  }
}

async function downloadFromLocalFallback(storagePath: string): Promise<DownloadPayload | null> {
  const segments = storagePath.split("/").filter(Boolean);
  if (!segments.length) {
    return null;
  }

  const absolutePath = resolve(LOCAL_HELP_DOWNLOADS_DIR, ...segments);
  if (
    absolutePath !== LOCAL_HELP_DOWNLOADS_DIR &&
    !absolutePath.startsWith(`${LOCAL_HELP_DOWNLOADS_DIR}${sep}`)
  ) {
    return null;
  }

  try {
    const fileBuffer = await readFile(absolutePath);
    const body = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength
    );
    return {
      body,
      sizeBytes: fileBuffer.byteLength,
      contentType: guessHelpDownloadContentType(storagePath),
    };
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const params = await context.params;
  const storagePath = normalizeHelpDownloadPathFromSegments(params.path || []);
  if (!storagePath) {
    return NextResponse.json({ error: "Invalid help download path." }, { status: 400 });
  }

  const filename = storagePath.split("/").pop() || "download";
  const storagePayload = await downloadFromSupabaseStorage(storagePath);
  if (storagePayload) {
    return new NextResponse(storagePayload.body, {
      status: 200,
      headers: createDownloadHeaders(filename, storagePayload.contentType, storagePayload.sizeBytes),
    });
  }

  const localPayload = await downloadFromLocalFallback(storagePath);
  if (localPayload) {
    return new NextResponse(localPayload.body, {
      status: 200,
      headers: createDownloadHeaders(filename, localPayload.contentType, localPayload.sizeBytes),
    });
  }

  return NextResponse.json({ error: "Help download file not found." }, { status: 404 });
}
