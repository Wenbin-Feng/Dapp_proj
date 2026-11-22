import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { localImagePath } from "@/lib/local-storage";
import { requireAuth } from "@/lib/auth";
import { ApiError, route } from "@/lib/http";
import { normalizeProductImage } from "@/lib/image-server";
import { IMAGE_LIMITS } from "@/lib/image-compression";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async (req) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      throw new ApiError(400, "INVALID_ID", "Invalid product ID.");
    const { db, userId } = await requireAuth(req, { roles: ["manufacturer"] });
    const product = db.product(id);
    if (!product) throw new ApiError(404, "NOT_FOUND", "Product not found.");
    if (product.manufacturer_id !== userId)
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Only this product's manufacturer can update its image.",
      );
    if (!req.headers.get("content-type")?.startsWith("multipart/form-data"))
      throw new ApiError(
        400,
        "INVALID_FILE",
        "Upload an image using multipart/form-data.",
      );
    const reader = req.body?.getReader();
    if (!reader)
      throw new ApiError(400, "INVALID_FILE", "Choose an image to upload.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > IMAGE_LIMITS.outputBytes + 65536) {
          await reader.cancel();
          throw new ApiError(
            413,
            "FILE_TOO_LARGE",
            "Compressed images must be 1 MB or smaller.",
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const formRequest = new Request(req.url, {
      method: "POST",
      headers: { "content-type": req.headers.get("content-type")! },
      body: Buffer.concat(chunks),
    });
    let form: FormData;
    try {
      form = await formRequest.formData();
    } catch {
      throw new ApiError(
        400,
        "INVALID_FILE",
        "The image upload could not be read.",
      );
    }
    const file = form.get("file");
    if (!(file instanceof File))
      throw new ApiError(400, "INVALID_FILE", "Choose an image to upload.");
    let bytes: Buffer;
    try {
      bytes = await normalizeProductImage(
        new Uint8Array(await file.arrayBuffer()),
      );
    } catch (error) {
      throw new ApiError(
        400,
        "INVALID_FILE",
        error instanceof Error &&
        /^(Compressed|Only static|This image)/.test(error.message)
          ? error.message
          : "Choose a valid JPEG, PNG or WebP image under 1 MB.",
      );
    }
    const newPath = `products/${id}/${randomUUID()}.webp`;
    const target = localImagePath(newPath);
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
    } catch {
      await unlink(target).catch(() => undefined);
      throw new ApiError(
        503,
        "UPLOAD_FAILED",
        "Image upload failed. Your previous image is unchanged; please retry.",
      );
    }
    let updated = false;
    try {
      updated = db.replaceImage(userId, id, product.image_path, newPath);
    } catch {
      /* Delete the unreferenced file and preserve the old image below. */
    }
    if (!updated) {
      await unlink(target).catch(() => undefined);
      throw new ApiError(
        409,
        "IMAGE_CONFLICT",
        "The product changed during upload. Refresh and try again; the existing image is preserved.",
      );
    }
    if (product.image_path?.startsWith(`products/${id}/`)) {
      await unlink(localImagePath(product.image_path)).catch(() => undefined);
    }
    return Response.json({ data: { image_path: newPath } });
  })(request);
}
