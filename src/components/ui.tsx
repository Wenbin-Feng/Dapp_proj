"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  CircleAlert,
  Fingerprint,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  formatDate,
  productImageUrl,
  shortWallet,
  warrantyStatus,
  WARRANTY_LABELS,
} from "@/lib/format";
import type { Product, PublicProductDetail } from "@/lib/types";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="brand" aria-label="Origin home">
      <span className="brand-mark">
        <Fingerprint size={25} aria-hidden="true" />
      </span>
      {!compact && (
        <span>
          origin<span className="brand-period">.</span>
        </span>
      )}
    </Link>
  );
}
export function PublicHeader() {
  return (
    <header className="public-header">
      <div className="public-header-inner">
        <Logo />
        <nav aria-label="Main navigation">
          <Link href="/#how-it-works" className="nav-text">
            How it works
          </Link>
          <Link href="/verify" className="nav-text">
            Verify a product
          </Link>
          <Link href="/login" className="button button-small">
            Connect wallet <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </nav>
      </div>
    </header>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function StatusBadge({ status }: { status: string }) {
  const tone = ["active", "accepted", "completed"].includes(status)
    ? "green"
    : ["pending", "submitted", "approved"].includes(status)
      ? "amber"
      : ["expired", "exhausted", "rejected", "cancelled"].includes(status)
        ? "red"
        : "neutral";
  return <Badge tone={tone}>{status.replaceAll("_", " ")}</Badge>;
}
export function ErrorNotice({ error }: { error: string | null | undefined }) {
  return error ? (
    <div className="notice notice-error" role="alert">
      <CircleAlert size={18} aria-hidden="true" />
      <span>{error}</span>
    </div>
  ) : null;
}
export function SuccessNotice({ children }: { children: ReactNode }) {
  return (
    <div className="notice notice-success" role="status">
      <Check size={18} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
export function Loading({
  text = "Loading your workspace…",
}: {
  text?: string;
}) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle size={25} className="spinner" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Box size={28} aria-hidden="true" />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function ProductVisual({
  path,
  alt,
  className = "",
}: {
  path: string | null;
  alt: string;
  className?: string;
}) {
  const url = productImageUrl(path);
  return (
    <div className={`product-visual ${className}`}>
      {url ? (
        <img src={url} alt={alt} loading="lazy" />
      ) : (
        <div className="product-placeholder">
          <Box size={52} strokeWidth={1} aria-hidden="true" />
          <span>No image yet</span>
        </div>
      )}
    </div>
  );
}
export function ProductCard({ product }: { product: Product }) {
  const status = warrantyStatus(product);
  return (
    <Link href={`/products/${product.id}`} className="product-card">
      <ProductVisual path={product.image_path} alt={product.model} />
      <div className="product-card-body">
        <div className="product-card-top">
          <span className="small muted">{product.manufacturer_name}</span>
          <ArrowUpRight size={18} aria-hidden="true" />
        </div>
        <h3>{product.model}</h3>
        <p className="mono small muted">{product.serial_number}</p>
        <div className="product-card-footer">
          <Badge
            tone={
              status === "active"
                ? "green"
                : status === "not_started"
                  ? "neutral"
                  : "amber"
            }
          >
            {WARRANTY_LABELS[status]}
          </Badge>
          <ChevronRight size={16} aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}
export function ProductFacts({
  product,
  isPublic = false,
}: {
  product: Product | PublicProductDetail;
  isPublic?: boolean;
}) {
  return (
    <dl className="facts-grid">
      <div>
        <dt>Serial number</dt>
        <dd className="mono">{product.serial_number}</dd>
      </div>
      <div>
        <dt>Manufacturer</dt>
        <dd>{product.manufacturer_name}</dd>
      </div>
      <div>
        <dt>Registered</dt>
        <dd>{formatDate(product.created_at)}</dd>
      </div>
      <div>
        <dt>Current owner</dt>
        <dd className="mono">
          {isPublic && "owner_display" in product
            ? product.owner_display
            : "owner_wallet" in product
              ? shortWallet(product.owner_wallet)
              : "—"}
        </dd>
      </div>
      <div>
        <dt>Warranty period</dt>
        <dd>{product.warranty_duration_days} days</dd>
      </div>
      <div>
        <dt>Service allowance</dt>
        <dd>
          {product.claims_used} of {product.max_claims} used
        </dd>
      </div>
    </dl>
  );
}
export function WarrantyPanel({
  product,
}: {
  product: Product | PublicProductDetail;
}) {
  const status = warrantyStatus(product);
  const remaining = Math.max(0, product.max_claims - product.claims_used);
  return (
    <div className="panel warranty-panel">
      <div className="section-title">
        <span className="icon-tile">
          <ShieldCheck size={23} aria-hidden="true" />
        </span>
        <div>
          <h3>Warranty coverage</h3>
          <p>{WARRANTY_LABELS[status]}</p>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="warranty-metrics">
        <div>
          <span className="metric-number">
            {remaining}
            <span> / {product.max_claims}</span>
          </span>
          <p>service claims remaining</p>
        </div>
        <div>
          <span className="metric-number">
            {product.warranty_duration_days}
            <span> days</span>
          </span>
          <p>from the first retail sale</p>
        </div>
      </div>
      <div
        className="progress-track"
        aria-label={`${remaining} of ${product.max_claims} service claims remaining`}
      >
        <span
          style={{
            width: `${product.max_claims ? (remaining / product.max_claims) * 100 : 0}%`,
          }}
        />
      </div>
      <dl className="facts-grid">
        <div>
          <dt>Coverage starts</dt>
          <dd>{formatDate(product.warranty_started_at)}</dd>
        </div>
        <div>
          <dt>Coverage ends</dt>
          <dd>{formatDate(product.warranty_expires_at)}</dd>
        </div>
      </dl>
      <p className="small muted">
        Ownership changes preserve the original coverage and service history. A
        claim is counted only when a repair is completed.
      </p>
    </div>
  );
}
