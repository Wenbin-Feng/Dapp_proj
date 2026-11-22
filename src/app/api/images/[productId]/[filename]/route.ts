import { readFile } from "node:fs/promises";
import { localImagePath } from "@/lib/local-storage";
import { ApiError } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ productId: string; filename: string }> },
) {
  const { productId, filename } = await context.params;
  try {
    const bytes = await readFile(
      localImagePath(`products/${productId}/${filename}`),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    const missing =
      error instanceof ApiError ||
      (error as NodeJS.ErrnoException).code === "ENOENT";
    return Response.json(
      {
        error: {
          code: missing ? "NOT_FOUND" : "STORAGE_UNAVAILABLE",
          message: missing
            ? "Image not found."
            : "Image storage is unavailable.",
        },
      },
      { status: missing ? 404 : 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
