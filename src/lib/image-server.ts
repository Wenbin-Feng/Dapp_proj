import sharp from "sharp";
import { IMAGE_LIMITS } from "./image-compression";
export async function normalizeProductImage(bytes: Uint8Array) {
  if (bytes.byteLength > IMAGE_LIMITS.outputBytes)
    throw new Error("Compressed images must be 1 MB or smaller.");
  const image = sharp(bytes, {
    limitInputPixels: IMAGE_LIMITS.inputPixels,
    animated: false,
    failOn: "warning",
  });
  const metadata = await image.metadata();
  if (
    !metadata.format ||
    !["jpeg", "png", "webp"].includes(metadata.format) ||
    (metadata.pages ?? 1) > 1
  )
    throw new Error("Only static JPEG, PNG and WebP images are supported.");
  for (const quality of [82, 72, 65]) {
    const normalized = await image
      .clone()
      .rotate()
      .resize({
        width: IMAGE_LIMITS.maxEdge,
        height: IMAGE_LIMITS.maxEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality })
      .toBuffer();
    if (normalized.byteLength <= IMAGE_LIMITS.outputBytes) return normalized;
  }
  const smaller = await image
    .clone()
    .rotate()
    .resize({
      width: 1200,
      height: 1200,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 65 })
    .toBuffer();
  if (smaller.byteLength > IMAGE_LIMITS.outputBytes)
    throw new Error("This image exceeds the upload limit after processing.");
  return smaller;
}
