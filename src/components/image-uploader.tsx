"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Upload } from "lucide-react";
import {
  compressProductImage,
  type CompressedImage,
} from "@/lib/image-compression";
import { api } from "@/lib/api-client";
import { productImageUrl } from "@/lib/format";
export function ImageUploader({
  productId,
  initialPath = null,
  onUploaded,
}: {
  productId: string;
  initialPath?: string | null;
  onUploaded?: (path: string) => void;
}) {
  const [compressed, setCompressed] = useState<CompressedImage | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [path, setPath] = useState(initialPath);
  const [stage, setStage] = useState<"idle" | "compressing" | "uploading">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  useEffect(() => {
    setPath(initialPath);
  }, [initialPath]);
  useEffect(() => {
    generation.current++;
    setCompressed(null);
    setPreview(null);
    setStage("idle");
    setMessage("");
  }, [productId]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function choose(file: File) {
    const current = ++generation.current;
    setStage("compressing");
    setMessage("");
    setCompressed(null);
    try {
      const next = await compressProductImage(file);
      if (current !== generation.current) return;
      setCompressed(next);
      setPreview(URL.createObjectURL(next.blob));
    } catch (error) {
      if (current === generation.current)
        setMessage(
          error instanceof Error ? error.message : "Image compression failed.",
        );
    } finally {
      if (current === generation.current) setStage("idle");
    }
  }
  async function upload() {
    if (!compressed) return;
    setStage("uploading");
    setMessage("");
    const form = new FormData();
    form.append("file", compressed.blob, compressed.fileName);
    try {
      const result = await api<{ image_path: string }>(
        `/api/products/${productId}/image`,
        { method: "POST", body: form },
      );
      setPath(result.image_path);
      setCompressed(null);
      setPreview(null);
      setMessage("Product image updated.");
      onUploaded?.(result.image_path);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Upload failed. Your existing image is unchanged; try again.",
      );
    } finally {
      setStage("idle");
    }
  }
  const image = preview || productImageUrl(path);
  return (
    <section className="image-uploader" aria-label="Product image upload">
      <div className="upload-preview">
        {image ? (
          <img src={image} alt="Product image preview" />
        ) : (
          <ImagePlus size={36} aria-hidden="true" />
        )}
      </div>
      <input
        ref={input}
        id={`image-${productId}`}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void choose(file);
          event.target.value = "";
        }}
      />
      <div className="upload-controls">
        <strong>Product image</strong>
        <p className="muted">
          JPEG, PNG or WebP · automatically optimized before upload.
        </p>
        <button
          type="button"
          className="button button-secondary"
          disabled={stage !== "idle"}
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={16} />
          {path ? "Choose replacement" : "Choose image"}
        </button>
        {compressed && (
          <>
            <p className="muted">
              {Math.ceil(compressed.originalBytes / 1024)} KB →{" "}
              {Math.ceil(compressed.blob.size / 1024)} KB · {compressed.width} ×{" "}
              {compressed.height}
            </p>
            <button
              type="button"
              className="button"
              disabled={stage !== "idle"}
              onClick={() => void upload()}
            >
              <Upload size={16} />
              {stage === "uploading" ? "Uploading…" : "Upload optimized image"}
            </button>
          </>
        )}
        {stage === "compressing" && (
          <p role="status">
            <LoaderCircle size={16} className="spinner" /> Optimizing image…
          </p>
        )}
        {stage === "uploading" && (
          <p role="status">Uploading to product storage…</p>
        )}
        {message && (
          <p role="status" className="upload-message">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
