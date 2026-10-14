"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Check, Download, QrCode } from "lucide-react";
export function ProductQr({ productId }: { productId: string }) {
  const [image, setImage] = useState("");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  useEffect(() => {
    let active = true;
    const nextUrl = `${window.location.origin}/verify?q=${encodeURIComponent(productId)}`;
    setUrl(nextUrl);
    void QRCode.toDataURL(nextUrl, {
      width: 216,
      margin: 2,
      color: { dark: "#080d18", light: "#ffffff" },
      errorCorrectionLevel: "M",
    })
      .then((value) => {
        if (active) setImage(value);
      })
      .catch(() => {
        if (active)
          setCopyError(
            "QR preview unavailable. You can still copy the verification link.",
          );
      });
    return () => {
      active = false;
    };
  }, [productId]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyError("");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(
        "Copy unavailable. Select the link below to copy it manually.",
      );
    }
  }
  return (
    <div className="panel qr-panel">
      <div className="section-title">
        <QrCode size={20} aria-hidden="true" />
        <h3>Share this passport</h3>
      </div>
      <p className="small muted">
        Anyone can scan to verify the product and its ownership journey.
      </p>
      {image && (
        <img
          src={image}
          width={180}
          height={180}
          alt="QR code for the public product passport"
          className="qr-image"
        />
      )}
      <div className="button-row">
        <button
          className="button button-secondary button-small"
          onClick={() => void copy()}
        >
          {copied ? (
            <Check size={16} aria-hidden="true" />
          ) : (
            <Copy size={16} aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy link"}
        </button>
        {image && (
          <a
            className="button button-ghost button-small"
            href={image}
            download={`origin-${productId}.png`}
          >
            <Download size={16} aria-hidden="true" />
            QR
          </a>
        )}
      </div>
      <input
        className="qr-url mono"
        aria-label="Public verification link"
        readOnly
        value={url}
        onFocus={(event) => event.target.select()}
      />
      {copyError && (
        <p className="small" role="status">
          {copyError}
        </p>
      )}
    </div>
  );
}
