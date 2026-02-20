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
    throw new Error(payload.error || "Unable to upload image.");
  }

  const uploadedUrl = String(payload.image?.url || "").trim();
  if (!uploadedUrl) {
    throw new Error("Image upload did not return a URL.");
  }

  return uploadedUrl;
}
