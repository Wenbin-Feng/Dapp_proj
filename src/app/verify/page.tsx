"use client";
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Fingerprint,
  LoaderCircle,
  ScanLine,
  Search,
} from "lucide-react";
import {
  Badge,
  EmptyState,
  ErrorNotice,
  ProductFacts,
  ProductVisual,
  WarrantyPanel,
} from "@/components/ui";
import { PassportShell } from "@/components/app-shell";
import { ProductQr } from "@/components/qr-code";
import { ChainProof } from "@/components/chain-proof";
import { productGateway } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import type { PublicProductDetail } from "@/lib/types";
import { BRAND } from "@/lib/brand";
function extractQuery(input: string) {
  const value = input.trim();
  if (/^https?:\/\//i.test(value) || value.startsWith("/verify?")) {
    try {
      return (
        new URL(value, window.location.origin).searchParams.get("q")?.trim() ||
        value
      );
    } catch {
      return value;
    }
  }
  return value;
}
export default function VerifyPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
function Verify() {
  const passportQuery = useSearchParams().get("q") || "";
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState<PublicProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const search = useCallback(async (value: string) => {
    const current = ++sequence.current;
    const normalized = extractQuery(value);
    setProduct(null);
    setError(null);
    if (!normalized || normalized.length > 120) {
      setLoading(false);
      setError(
        `Enter a product ID, serial number or a ${BRAND.name} verification link.`,
      );
      return;
    }
    setQuery(normalized);
    setLoading(true);
    try {
      const result = await productGateway.verify(normalized);
      if (current === sequence.current) setProduct(result);
    } catch (e) {
      if (current === sequence.current)
        setError(
          e instanceof Error
            ? e.message
            : "We couldn't look up this product. Please try again.",
        );
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setQuery(passportQuery);
    if (passportQuery) {
      void search(passportQuery);
    } else {
      setProduct(null);
      setError(null);
      setLoading(false);
    }
    return () => {
      sequence.current++;
    };
  }, [passportQuery, search]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = extractQuery(query);
    if (
      !normalized ||
      normalized.length > 120 ||
      normalized === passportQuery
    ) {
      void search(normalized);
    } else {
      router.replace(`/verify?q=${encodeURIComponent(normalized)}`, {
        scroll: false,
      });
    }
  }
  return (
    <PassportShell>
      <div className="verify-heading">
        <span className="verify-icon">
          <ScanLine size={26} strokeWidth={1.5} aria-hidden="true" />
        </span>
        <h1>Verify a product</h1>
        <p>
          Look up a product&apos;s passport to check its identity, ownership
          history and warranty.
        </p>
        <Link className="text-link" href="/catalog">
          Browse product catalog
        </Link>
      </div>
      <form className="search-form" onSubmit={submit}>
        <div>
          <Search size={19} aria-hidden="true" />
          <input
            aria-label="Product ID, serial number or verification link"
            required
            maxLength={2048}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Product ID, serial number or passport link"
          />
        </div>
        <button className="button" disabled={loading}>
          {loading ? (
            <LoaderCircle size={17} className="spinner" aria-hidden="true" />
          ) : (
            <ScanLine size={17} aria-hidden="true" />
          )}
          {loading ? "Checking" : "Verify"}
        </button>
      </form>
      <div style={{ maxWidth: 660, margin: "0 auto" }}>
        <ErrorNotice error={error} />
      </div>
      {loading && (
        <div className="loading-state" role="status">
          <LoaderCircle size={23} className="spinner" aria-hidden="true" />
          Looking up the product passport…
        </div>
      )}
      {!loading && product && (
        <div className="verify-results">
          <section className="panel">
            <div className="verify-product-header">
              <div>
                <div className="eyebrow">REGISTERED PRODUCT PASSPORT</div>
                <h2>{product.model}</h2>
                <p className="mono">{product.serial_number}</p>
              </div>
              <Badge tone="green">Record found</Badge>
            </div>
            <ProductVisual path={product.image_path} alt={product.model} />
            <ProductFacts product={product} isPublic />
            <div
              style={{
                borderTop: "1px solid var(--border)",
                marginTop: 28,
                paddingTop: 26,
              }}
            >
              <div className="section-title">
                <Fingerprint size={21} aria-hidden="true" />
                <h3>Ownership journey</h3>
              </div>
              {product.history.length ? (
                <div className="timeline">
                  {product.history.map((event, index) => (
                    <article className="timeline-item" key={event.id}>
                      <h3>
                        {event.kind === "registered"
                          ? "Registered by the manufacturer"
                          : "Ownership transferred"}
                      </h3>
                      <p className="wallet-path">
                        <span className="mono">
                          {event.from_display || "Manufacturer registration"}
                        </span>
                        <ArrowRight size={13} aria-hidden="true" />
                        <span className="mono">{event.to_display}</span>
                        {index === product.history.length - 1 && (
                          <Badge tone="green">Current</Badge>
                        )}
                      </p>
                      <time dateTime={event.created_at}>
                        {formatDate(event.created_at)}
                      </time>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="small">No ownership events are available.</p>
              )}
            </div>
            <p className="form-note">
              Wallet addresses are shortened. Personal profiles and private
              service descriptions are not part of this public passport.
            </p>
          </section>
          <aside className="verify-side">
            <ChainProof proof={product.chain} />
            <WarrantyPanel product={product} />
            <ProductQr productId={product.id} />
          </aside>
        </div>
      )}
      {!loading && !product && !error && (
        <div className="verify-empty">
          <EmptyState
            title="A clear record, one search away."
            description="Enter the serial printed on your product, its passport ID, or paste a verification link. You can also scan the QR code on a product passport."
          />
        </div>
      )}
    </PassportShell>
  );
}
