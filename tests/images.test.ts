import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { normalizeProductImage } from "../src/lib/image-server";
import { resizeDimensions, IMAGE_LIMITS } from "../src/lib/image-compression";
describe("Product image processing", () => {
  it("shrinks portrait and landscape images without distortion or enlarging small ones", () => {
    expect(resizeDimensions(4000, 2000)).toEqual({ width: 1600, height: 800 });
    expect(resizeDimensions(1000, 4000)).toEqual({ width: 400, height: 1600 });
    expect(resizeDimensions(320, 200)).toEqual({ width: 320, height: 200 });
  });
  it("normalizes actual PNG bytes to WebP and preserves transparency", async () => {
    const bytes = await sharp({
      create: {
        width: 2000,
        height: 1000,
        channels: 4,
        background: { r: 60, g: 220, b: 170, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const result = await normalizeProductImage(bytes);
    const metadata = await sharp(result).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(1600);
    expect(metadata.height).toBe(800);
    expect(metadata.hasAlpha).toBe(true);
    expect(result.byteLength).toBeLessThanOrEqual(IMAGE_LIMITS.outputBytes);
    expect(metadata.exif).toBeUndefined();
  });
  it("rejects non-image content even if the caller claims it is an image", async () => {
    await expect(
      normalizeProductImage(
        Buffer.from("<svg><script>alert(1)</script></svg>"),
      ),
    ).rejects.toThrow();
  });
  it("corrects camera orientation and strips EXIF metadata", async () => {
    const source = await sharp({
      create: { width: 800, height: 1600, channels: 3, background: "#257b61" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const normalized = await normalizeProductImage(source);
    const metadata = await sharp(normalized).metadata();
    expect(metadata.width).toBe(1600);
    expect(metadata.height).toBe(800);
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });
  it("rejects uploads larger than the hard limit before decoding", async () => {
    await expect(
      normalizeProductImage(new Uint8Array(IMAGE_LIMITS.outputBytes + 1)),
    ).rejects.toThrow("1 MB");
  });
});
