"use client";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Box,
  ChevronRight,
  LoaderCircle,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ImageUploader } from "@/components/image-uploader";
import { ProductQr } from "@/components/qr-code";
import { useWallet } from "@/components/wallet-provider";
import {
  Badge,
  EmptyState,
  ErrorNotice,
  Loading,
  PageTitle,
  ProductFacts,
  ProductVisual,
  StatusBadge,
  SuccessNotice,
  WarrantyPanel,
} from "@/components/ui";
import { api } from "@/lib/api-client";
import { useProductGateway } from "@/components/product-gateway";
import { useDemoChain } from "@/components/demo-chain-provider";
import { TransactionLink } from "@/components/demo-chain-ui";
import { displayAmount } from "@/lib/chain/amounts";
import type { Hash } from "viem";
import {
  formatDate,
  shortWallet,
  warrantyStatus,
  WARRANTY_LABELS,
} from "@/lib/format";
import type { ProductDetail, ServiceCenter } from "@/lib/types";
const tabs = ["Overview", "Ownership History", "Warranty", "Service Records"];
export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useWallet();
  return <ProductView key={`${profile?.id || "signed-out"}:${id}`} id={id} />;
}
function ProductView({ id }: { id: string }) {
  const productGateway = useProductGateway();
  const chain = useDemoChain();
  const { profile } = useWallet();
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [receiver, setReceiver] = useState("");
  const [transferMode, setTransferMode] = useState("free");
  const [price, setPrice] = useState("");
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [centers, setCenters] = useState<ServiceCenter[]>([]);
  const [center, setCenter] = useState("");
  const [centersError, setCentersError] = useState<string | null>(null);
  const [centersLoading, setCentersLoading] = useState(false);
  const [description, setDescription] = useState("");
  const userId = profile?.id;
  const reload = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      setDetail(await productGateway.detail(id));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "We couldn't load this product.",
      );
    } finally {
      setLoading(false);
    }
  }, [id, userId]);
  useEffect(() => {
    if (userId) void reload();
  }, [userId, reload]);
  const loadCenters = useCallback(async () => {
    setCentersLoading(true);
    setCentersError(null);
    try {
      setCenters(await api<ServiceCenter[]>("/api/service-centers"));
    } catch (e) {
      setCentersError(
        e instanceof Error ? e.message : "Unable to load service centers.",
      );
    } finally {
      setCentersLoading(false);
    }
  }, []);
  useEffect(() => {
    if (profile?.role === "customer") void loadCenters();
  }, [profile?.role, loadCenters]);
  const product = detail?.product;
  const owner = product?.owner_id === profile?.id;
  const pendingTransfer = detail?.transfers.some(
    (item) => item.status === "pending",
  );
  const openClaim = detail?.claims.some(
    (item) => item.status === "submitted" || item.status === "approved",
  );
  const canTransfer =
    owner &&
    profile?.role !== "service_center" &&
    !pendingTransfer &&
    !openClaim;
  const canClaim =
    owner &&
    profile?.role === "customer" &&
    product &&
    warrantyStatus(product) === "active" &&
    !pendingTransfer &&
    !openClaim;
  async function transfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setMessage("");
    setBusy(true);
    try {
      await productGateway.transfer(
        id,
        receiver.trim(),
        transferMode === "paid" ? { price, expiresAt: expiry } : undefined,
      );
      setReceiver("");
      setMessage(
        "Transfer sent. Ownership changes when the recipient accepts it.",
      );
      await reload();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Unable to start this transfer.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function claim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setMessage("");
    setBusy(true);
    try {
      await productGateway.claim({
        product_id: id,
        service_center_id: center,
        description: description.trim(),
      });
      setDescription("");
      setMessage("Warranty request submitted to your selected service center.");
      await reload();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Unable to submit your request.",
      );
    } finally {
      setBusy(false);
    }
  }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : null;
    if (next !== null) {
      event.preventDefault();
      setTab(next);
      document.getElementById(`product-tab-${next}`)?.focus();
    }
  }
  return (
    <AppShell>
      <div className="breadcrumb">
        <Link href="/dashboard">
          <ArrowLeft size={13} aria-hidden="true" /> Your products
        </Link>
        <ChevronRight size={12} aria-hidden="true" />
        <span>Product passport</span>
      </div>
      {loading ? (
        <Loading text="Loading the product passport…" />
      ) : error ? (
        <>
          <ErrorNotice error={error} />
          <button
            className="button button-secondary"
            onClick={() => void reload()}
          >
            Try again
          </button>
        </>
      ) : (
        product &&
        detail && (
          <>
            <PageTitle
              eyebrow="PRODUCT PASSPORT"
              title={product.model}
              description={`${product.manufacturer_name} · ${product.serial_number}`}
              action={
                <Link
                  className="button button-secondary button-small"
                  href={`/verify?q=${encodeURIComponent(product.id)}`}
                >
                  Public passport
                  <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
              }
            />
            <ErrorNotice error={actionError} />
            {message && <SuccessNotice>{message}</SuccessNotice>}
            <div className="detail-layout">
              <div className="detail-main">
                <ProductVisual path={product.image_path} alt={product.model} />
                <div
                  className="detail-tabs"
                  role="tablist"
                  aria-label="Product passport sections"
                >
                  {tabs.map((label, index) => (
                    <button
                      key={label}
                      id={`product-tab-${index}`}
                      role="tab"
                      aria-selected={tab === index}
                      aria-controls={`product-panel-${index}`}
                      tabIndex={tab === index ? 0 : -1}
                      className={tab === index ? "active" : ""}
                      onClick={() => setTab(index)}
                      onKeyDown={(event) => tabKey(event, index)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div
                  role="tabpanel"
                  id={`product-panel-${tab}`}
                  aria-labelledby={`product-tab-${tab}`}
                  tabIndex={0}
                >
                  {tab === 0 && (
                    <section className="panel">
                      <div className="section-title">
                        <Box size={21} aria-hidden="true" />
                        <h2>Product identity</h2>
                        {owner && <Badge tone="green">Owned by you</Badge>}
                      </div>
                      <ProductFacts product={product} />
                      {product.chain && (
                        <p className="small">
                          Registration evidence:{" "}
                          <TransactionLink
                            hash={product.chain.transaction_hash as Hash}
                          />
                        </p>
                      )}
                      <div
                        style={{
                          borderTop: "1px solid var(--border)",
                          paddingTop: 22,
                          marginTop: 24,
                        }}
                      >
                        <p className="small muted">Product ID</p>
                        <p className="mono small" style={{ marginTop: 6 }}>
                          {product.id}
                        </p>
                      </div>
                    </section>
                  )}
                  {tab === 1 && (
                    <section className="panel">
                      <div className="section-title">
                        <ArrowLeftRight size={21} aria-hidden="true" />
                        <h2>Ownership journey</h2>
                        <Badge>{detail.history.length} events</Badge>
                      </div>
                      {detail.history.length ? (
                        <div className="timeline">
                          {detail.history.map((event, index) => (
                            <article className="timeline-item" key={event.id}>
                              <h3>
                                {event.kind === "registered"
                                  ? "Product registered"
                                  : "Ownership transferred"}
                              </h3>
                              <p className="wallet-path">
                                <span className="mono">
                                  {event.from_wallet
                                    ? shortWallet(event.from_wallet)
                                    : "Manufacturer registration"}
                                </span>
                                <ArrowRight size={13} aria-hidden="true" />
                                <span className="mono">
                                  {shortWallet(event.to_wallet)}
                                </span>
                                {index === detail.history.length - 1 && (
                                  <Badge tone="green">Current owner</Badge>
                                )}
                              </p>
                              <time dateTime={event.created_at}>
                                {formatDate(event.created_at)}
                              </time>
                              {event.price_pdc &&
                                BigInt(event.price_pdc) > 0n && (
                                  <p>
                                    Settled{" "}
                                    {displayAmount(BigInt(event.price_pdc), 18)}{" "}
                                    PDC
                                  </p>
                                )}
                              {event.transaction_hash && (
                                <p>
                                  <TransactionLink
                                    hash={event.transaction_hash as Hash}
                                  />
                                </p>
                              )}
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="small">
                          No ownership events are available.
                        </p>
                      )}
                    </section>
                  )}
                  {tab === 2 && (
                    <>
                      <WarrantyPanel product={product} />
                      {profile?.role === "customer" && owner && (
                        <section className="panel claim-form">
                          <div className="section-title">
                            <ShieldCheck size={21} aria-hidden="true" />
                            <h3>Request warranty service</h3>
                          </div>
                          {!canClaim ? (
                            <div className="notice notice-info">
                              {pendingTransfer
                                ? "An ownership transfer is pending. Resolve it before submitting a warranty request."
                                : openClaim
                                  ? "This product already has an open warranty request. You can track it in Warranty claims."
                                  : WARRANTY_LABELS[warrantyStatus(product)] ===
                                      "Starts on first sale"
                                    ? "Warranty begins when the first retail sale is accepted."
                                    : "New requests are unavailable because this product's warranty has expired or its service allowance is used up."}
                            </div>
                          ) : (
                            <form onSubmit={(event) => void claim(event)}>
                              <p className="muted">
                                Choose a registered service center and tell them
                                what needs attention.
                              </p>
                              <ErrorNotice error={centersError} />
                              {centersError && (
                                <button
                                  className="button button-secondary button-small"
                                  type="button"
                                  onClick={() => void loadCenters()}
                                >
                                  Reload service centers
                                </button>
                              )}
                              <div className="field">
                                <label htmlFor="service-center">
                                  Service center
                                </label>
                                <select
                                  id="service-center"
                                  required
                                  disabled={centersLoading || !centers.length}
                                  value={center}
                                  onChange={(event) =>
                                    setCenter(event.target.value)
                                  }
                                >
                                  <option value="">
                                    {centersLoading
                                      ? "Loading service centers…"
                                      : centers.length
                                        ? "Select a service center"
                                        : "No registered service centers yet"}
                                  </option>
                                  {centers.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.organization_name} ·{" "}
                                      {shortWallet(item.wallet_address)}
                                    </option>
                                  ))}
                                </select>
                                {!centersLoading &&
                                  !centers.length &&
                                  !centersError && (
                                    <span className="field-hint">
                                      A service center must complete
                                      registration before you can submit a
                                      request.
                                    </span>
                                  )}
                              </div>
                              <div className="field">
                                <label htmlFor="issue-description">
                                  Describe the issue
                                </label>
                                <textarea
                                  id="issue-description"
                                  required
                                  maxLength={2000}
                                  value={description}
                                  onChange={(event) =>
                                    setDescription(event.target.value)
                                  }
                                  placeholder="What happened? Include symptoms that will help the service team."
                                />
                                <span className="field-hint">
                                  Visible to you and the selected service
                                  center.
                                </span>
                              </div>
                              <button
                                className="button"
                                disabled={busy || !centers.length}
                              >
                                {busy ? (
                                  <>
                                    <LoaderCircle
                                      size={16}
                                      className="spinner"
                                      aria-hidden="true"
                                    />
                                    Submitting…
                                  </>
                                ) : (
                                  <>
                                    Submit warranty request
                                    <ArrowRight size={16} aria-hidden="true" />
                                  </>
                                )}
                              </button>
                            </form>
                          )}
                          <Link
                            href="/claims"
                            className="text-link"
                            style={{ marginTop: 22 }}
                          >
                            Track your warranty claims
                            <ArrowUpRight size={14} aria-hidden="true" />
                          </Link>
                        </section>
                      )}
                      {detail.claims.length > 0 && (
                        <section className="panel" style={{ marginTop: 22 }}>
                          <div className="section-title">
                            <h3>Your related warranty requests</h3>
                          </div>
                          <div className="activity-list">
                            {detail.claims.map((item) => (
                              <Link
                                key={item.id}
                                href="/claims"
                                className="activity-row"
                              >
                                <div>
                                  <strong>
                                    {item.service_center_name ||
                                      "Warranty request"}
                                  </strong>
                                  <p>{formatDate(item.created_at)}</p>
                                </div>
                                <StatusBadge status={item.status} />
                              </Link>
                            ))}
                          </div>
                        </section>
                      )}
                    </>
                  )}
                  {tab === 3 && (
                    <section className="panel">
                      <div className="section-title">
                        <Wrench size={21} aria-hidden="true" />
                        <h2>Service records</h2>
                        <Badge>{detail.services.length} repairs</Badge>
                      </div>
                      {detail.services.length ? (
                        detail.services.map((record, index) => (
                          <article className="service-record" key={record.id}>
                            <h3>
                              Completed repair ·{" "}
                              {detail.services.length - index}
                            </h3>
                            <p>{record.description}</p>
                            <time dateTime={record.created_at}>
                              {formatDate(record.created_at)}
                            </time>
                          </article>
                        ))
                      ) : (
                        <EmptyState
                          title="No service records to show"
                          description="Completed warranty repairs that you can access will appear here."
                        />
                      )}
                    </section>
                  )}
                </div>
                {profile?.id === product.manufacturer_id && (
                  <ImageUploader
                    productId={product.id}
                    initialPath={product.image_path}
                    onUploaded={(path) =>
                      setDetail((current) =>
                        current
                          ? {
                              ...current,
                              product: { ...current.product, image_path: path },
                            }
                          : current,
                      )
                    }
                  />
                )}
              </div>
              <aside className="detail-aside">
                <section className="panel">
                  <div className="section-title">
                    <ShieldCheck size={19} aria-hidden="true" />
                    <h3>Coverage at a glance</h3>
                  </div>
                  <StatusBadge status={warrantyStatus(product)} />
                  <p className="small" style={{ marginTop: 15 }}>
                    {product.max_claims - product.claims_used} of{" "}
                    {product.max_claims} service claims remaining.
                  </p>
                  <p className="small" style={{ marginTop: 6 }}>
                    {product.warranty_expires_at
                      ? `Coverage ends ${formatDate(product.warranty_expires_at)}.`
                      : "Coverage starts on the first retail sale."}
                  </p>
                  <button
                    className="button button-secondary button-small"
                    onClick={() => setTab(2)}
                  >
                    {profile?.role === "customer" && owner
                      ? "Warranty & service"
                      : "View warranty"}
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </section>
                {owner && profile?.role !== "service_center" && (
                  <section className="panel">
                    <div className="section-title">
                      <ArrowLeftRight size={19} aria-hidden="true" />
                      <h3>Pass it on</h3>
                    </div>
                    {canTransfer ? (
                      <form onSubmit={(event) => void transfer(event)}>
                        {chain.config?.productBackend === "chain" && (
                          <>
                            <div className="field">
                              <label htmlFor="transfer-kind">
                                Handover type
                              </label>
                              <select
                                id="transfer-kind"
                                value={transferMode}
                                disabled={busy}
                                onChange={(event) =>
                                  setTransferMode(event.target.value)
                                }
                              >
                                <option value="free">
                                  Free inventory or ownership handover
                                </option>
                                <option value="paid">Sell for PDC</option>
                              </select>
                            </div>
                            {transferMode === "paid" && (
                              <>
                                <div className="field">
                                  <label htmlFor="product-price">
                                    Fixed PDC price
                                  </label>
                                  <input
                                    id="product-price"
                                    required
                                    disabled={busy}
                                    inputMode="decimal"
                                    value={price}
                                    placeholder="100"
                                    onChange={(event) =>
                                      setPrice(event.target.value)
                                    }
                                  />
                                </div>
                                <div className="field">
                                  <label htmlFor="offer-expiry">
                                    Offer expires
                                  </label>
                                  <input
                                    id="offer-expiry"
                                    required
                                    disabled={busy}
                                    type="datetime-local"
                                    value={expiry}
                                    onChange={(event) =>
                                      setExpiry(event.target.value)
                                    }
                                  />
                                </div>
                                <p className="small muted">
                                  Only the specified buyer can pay and accept.
                                  The price is fixed in PDC; the AMM rate does
                                  not change it.
                                </p>
                              </>
                            )}
                          </>
                        )}
                        <p className="small" style={{ marginBottom: 19 }}>
                          Transfer to a registered{" "}
                          {profile?.role === "manufacturer"
                            ? "retailer"
                            : "customer"}
                          . The recipient must accept the handover.
                        </p>
                        <div className="field">
                          <label htmlFor="receiver-wallet">
                            Recipient wallet
                          </label>
                          <input
                            id="receiver-wallet"
                            className="mono"
                            required
                            pattern="0x[a-fA-F0-9]{40}"
                            maxLength={42}
                            title="A wallet address beginning with 0x followed by 40 hexadecimal characters"
                            value={receiver}
                            onChange={(event) =>
                              setReceiver(event.target.value)
                            }
                            placeholder="0x…"
                          />
                        </div>
                        <button className="button button-small" disabled={busy}>
                          {busy ? (
                            <>
                              <LoaderCircle
                                size={15}
                                className="spinner"
                                aria-hidden="true"
                              />
                              Sending…
                            </>
                          ) : (
                            <>
                              Initiate transfer
                              <ArrowRight size={15} aria-hidden="true" />
                            </>
                          )}
                        </button>
                      </form>
                    ) : (
                      <>
                        <p className="small">
                          {pendingTransfer
                            ? "A transfer is awaiting confirmation. Ownership remains with you until it is accepted."
                            : "An open warranty request must be resolved before this product can be transferred."}
                        </p>
                        <Link
                          href={pendingTransfer ? "/transfers" : "/claims"}
                          className="button button-secondary button-small"
                        >
                          {pendingTransfer
                            ? "Manage pending transfer"
                            : "View warranty request"}
                          <ArrowRight size={14} aria-hidden="true" />
                        </Link>
                      </>
                    )}
                  </section>
                )}
                <ProductQr productId={product.id} />
              </aside>
            </div>
          </>
        )
      )}
    </AppShell>
  );
}
