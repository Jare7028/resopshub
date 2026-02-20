export async function uploadPersonalPageImage(input: { pageId: string; file: File }) {
  const pageId = String(input.pageId || "").trim();
  if (!pageId) {
    throw new Error("A personal page id is required to upload an image.");
  }

  const formData = new FormData();
  const fileName = String(input.file.name || "").trim() || "image";
  formData.set("file", input.file, fileName);

  const response = await fetch(
    `/api/personal/pages/${encodeURIComponent(pageId)}/images`,
    {
      method: "POST",
      body: formData,
    }
  );

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    image?: { url?: string };
  };

  if (!response.ok) {
    console.warn("[personal.image.debug] upload_response_error", {
      pageId,
      status: response.status,
      error: payload.error || "Unable to upload image.",
    });
    throw new Error(payload.error || "Unable to upload image.");
  }

  const uploadedUrl = String(payload.image?.url || "").trim();
  if (!uploadedUrl) {
    console.warn("[personal.image.debug] upload_response_missing_url", { pageId });
    throw new Error("Image upload did not return a URL.");
  }

  console.info("[personal.image.debug] upload_response_success", {
    pageId,
    url: uploadedUrl.slice(0, 180),
  });

  return uploadedUrl;
}
