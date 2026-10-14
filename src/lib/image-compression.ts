export const IMAGE_LIMITS = {
  inputBytes: 10 * 1024 * 1024,
  inputPixels: 25_000_000,
  maxEdge: 1600,
  targetBytes: 500 * 1024,
  outputBytes: 1024 * 1024,
};
export const INPUT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export function resizeDimensions(
  width: number,
  height: number,
  maxEdge = IMAGE_LIMITS.maxEdge,
) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
export interface CompressedImage {
  blob: Blob;
  fileName: string;
  originalBytes: number;
  width: number;
  height: number;
}
function encode(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new Error(
                "Image compression failed. Please try a different image.",
              ),
            ),
      type,
      quality,
    ),
  );
}
async function decode(
  file: File,
): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}> {
  if (typeof createImageBitmap !== "undefined") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      /* Use the browser image decoder as a compatibility fallback. */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(
      "This image could not be read. Choose a JPEG, PNG or WebP file.",
    );
  }
}
export async function compressProductImage(
  file: File,
): Promise<CompressedImage> {
  if (!INPUT_IMAGE_TYPES.includes(file.type))
    throw new Error("Choose a JPEG, PNG or WebP image.");
  if (file.size > IMAGE_LIMITS.inputBytes)
    throw new Error("Original images must be smaller than 10 MB.");
  const image = await decode(file);
  try {
    if (image.width * image.height > IMAGE_LIMITS.inputPixels)
      throw new Error("Choose an image under 25 megapixels.");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: true });
    if (!context)
      throw new Error(
        "Your browser cannot compress images. Please use a current browser.",
      );
    let edge = IMAGE_LIMITS.maxEdge;
    let result: Blob | null = null;
    for (let attempt = 0; attempt < 9; attempt++) {
      const dimensions = resizeDimensions(image.width, image.height, edge);
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      const quality = attempt === 0 ? 0.82 : attempt === 1 ? 0.72 : 0.65;
      result = await encode(canvas, "image/webp", quality);
      // Unsupported WebP encoders return PNG. Keep alpha; JPEG is safe only for a JPEG source.
      if (result.type !== "image/webp" && file.type === "image/jpeg")
        result = await encode(canvas, "image/jpeg", quality);
      if (result.size <= IMAGE_LIMITS.targetBytes) break;
      if (attempt >= 1) edge = Math.max(320, Math.floor(edge * 0.8));
    }
    if (!result || result.size > IMAGE_LIMITS.outputBytes)
      throw new Error(
        "This image is still too large after compression. Choose a simpler or smaller image.",
      );
    const extension =
      result.type === "image/webp"
        ? "webp"
        : result.type === "image/jpeg"
          ? "jpg"
          : "png";
    return {
      blob: result,
      fileName: `product.${extension}`,
      originalBytes: file.size,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    image.release();
  }
}
