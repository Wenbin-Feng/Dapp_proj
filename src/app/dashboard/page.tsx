"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Box,
  Plus,
  ScanLine,
  Search,
  ShieldCheck,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useDashboard } from "@/components/data";
import { useWallet } from "@/components/wallet-provider";
import {
  EmptyState,
  ErrorNotice,
  Loading,
  PageTitle,
  ProductCard,
  StatusBadge,
} from "@/components/ui";
import { formatDate, shortWallet, warrantyStatus } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/types";
export default function Dashboard() {
  const { profile } = useWallet();
  const { data, loading, error, reload } = useDashboard();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const products = data?.products || [];
  const transfers = data?.transfers || [];
  const claims = data?.claims || [];
  const pending = transfers.filter((item) => item.status === "pending");
  const openClaims = claims.filter((item) =>
    ["submitted", "approved"].includes(item.status),
  );
  const filtered = products.filter(
    (item) =>
      `${item.model} ${item.serial_number}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" || warrantyStatus(item) === "active"),
  );
  const descriptions = {
    manufacturer:
      "Register products and manage the first steps of their ownership journey.",
    retailer: "Receive inventory and connect each product with its next owner.",
    customer:
      "Your products, their ownership and their care. All in one place.",
    service_center:
      "A clear view of warranty requests and the repairs in your care.",
  };
  return (
    <AppShell>
      <PageTitle
        eyebrow={
          profile ? `${ROLE_LABELS[profile.role]} workspace` : "Your workspace"
        }
        title={`Welcome${profile ? `, ${profile.display_name}` : ""}.`}
        description={
          profile
            ? descriptions[profile.role]
            : "Your product journey starts here."
        }
        action={
          profile?.role === "manufacturer" ? (
            <Link href="/products/new" className="button">
              <Plus size={17} aria-hidden="true" />
              Register product
            </Link>
          ) : undefined
        }
      />
      <ErrorNotice error={error} />
      {error && (
        <button
          className="button button-secondary button-small"
          onClick={() => void reload()}
        >
          Try again
        </button>
      )}
      {loading ? (
        <Loading />
      ) : (
        data && (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <Box size={22} aria-hidden="true" />
                <div className="stat-label">
                  {profile?.role === "service_center"
                    ? "Assigned claims"
                    : "Products in your wallet"}
                </div>
                <div className="stat-value">
                  {profile?.role === "service_center"
                    ? claims.length
                    : products.length}
                </div>
                <div className="stat-foot">
                  {profile?.role === "service_center"
                    ? "Your complete service queue"
                    : "Currently owned by you"}
                </div>
              </div>
              <div className="stat-card">
                <ArrowLeftRight size={22} aria-hidden="true" />
                <div className="stat-label">Pending transfers</div>
                <div className="stat-value">{pending.length}</div>
                <div className="stat-foot">Awaiting an ownership handover</div>
              </div>
              <div className="stat-card">
                <ShieldCheck size={22} aria-hidden="true" />
                <div className="stat-label">Open warranty claims</div>
                <div className="stat-value">{openClaims.length}</div>
                <div className="stat-foot">Submitted or being repaired</div>
              </div>
            </div>
            {profile?.role !== "service_center" && (
              <>
                <div className="section-row">
                  <div>
                    <h2>
                      {profile?.role === "customer"
                        ? "Your product collection"
                        : "Your inventory"}
                    </h2>
                    <p>Every product, with its story attached.</p>
                  </div>
                  <Link className="text-link" href="/catalog">
                    Browse product catalog{" "}
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </div>
                <div className="filter-bar">
                  <button
                    className={`filter-button ${filter === "all" ? "active" : ""}`}
                    onClick={() => setFilter("all")}
                    aria-pressed={filter === "all"}
                  >
                    My products
                  </button>
                  <button
                    className={`filter-button ${filter === "active" ? "active" : ""}`}
                    onClick={() => setFilter("active")}
                    aria-pressed={filter === "active"}
                  >
                    Active warranty
                  </button>
                  <label className="search-inline">
                    <Search size={16} aria-hidden="true" />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      aria-label="Search your products"
                      placeholder="Search model or serial…"
                    />
                  </label>
                </div>
                {filtered.length ? (
                  <div className="product-grid">
                    {filtered.map((product) => (
                      <ProductCard product={product} key={product.id} />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title={
                      products.length
                        ? "No matching products"
                        : "Your journey starts with a product."
                    }
                    description={
                      products.length
                        ? "Try a different model, serial number or filter."
                        : profile?.role === "manufacturer"
                          ? "Register your first product to create its digital passport."
                          : "When a product is transferred to you and you accept it, its passport will appear here."
                    }
                    action={
                      profile?.role === "manufacturer" && !products.length ? (
                        <Link
                          href="/products/new"
                          className="button button-small"
                        >
                          <Plus size={16} aria-hidden="true" />
                          Register your first product
                        </Link>
                      ) : !products.length ? (
                        <Link
                          href="/transfers"
                          className="button button-secondary button-small"
                        >
                          Check incoming transfers
                          <ArrowRight size={15} aria-hidden="true" />
                        </Link>
                      ) : undefined
                    }
                  />
                )}
              </>
            )}
            <div className="dashboard-columns">
              <section className="panel">
                <div className="section-title">
                  <h2>
                    {profile?.role === "service_center"
                      ? "Recent warranty requests"
                      : "Recent ownership activity"}
                  </h2>
                  <Link
                    className="text-link"
                    href={
                      profile?.role === "service_center"
                        ? "/claims"
                        : "/transfers"
                    }
                  >
                    View all
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                </div>
                {profile?.role === "service_center" ? (
                  claims.length ? (
                    <div className="activity-list">
                      {claims.slice(0, 4).map((claim) => (
                        <Link
                          className="activity-row"
                          href="/claims"
                          key={claim.id}
                        >
                          <span className="icon-tile">
                            <ShieldCheck size={18} aria-hidden="true" />
                          </span>
                          <div>
                            <strong>
                              {claim.model || "Product warranty claim"}
                            </strong>
                            <p>{formatDate(claim.created_at)}</p>
                          </div>
                          <StatusBadge status={claim.status} />
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="small">
                      No claims assigned yet. Customers can choose your
                      organization when they request warranty service.
                    </p>
                  )
                ) : transfers.length ? (
                  <div className="activity-list">
                    {transfers.slice(0, 4).map((transfer) => (
                      <Link
                        className="activity-row"
                        href="/transfers"
                        key={transfer.id}
                      >
                        <span className="icon-tile">
                          <ArrowLeftRight size={18} aria-hidden="true" />
                        </span>
                        <div>
                          <strong>
                            {transfer.model || "Product ownership transfer"}
                          </strong>
                          <p>
                            {transfer.to_user_id === profile?.id
                              ? `From ${shortWallet(transfer.from_wallet)}`
                              : `To ${shortWallet(transfer.to_wallet)}`}{" "}
                            · {formatDate(transfer.created_at)}
                          </p>
                        </div>
                        <StatusBadge status={transfer.status} />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="small">
                    Ownership handovers will appear here as products begin their
                    journey.
                  </p>
                )}
              </section>
              <section className="panel">
                <div className="section-title">
                  <h2>Keep the story moving</h2>
                </div>
                <div className="quick-list">
                  <Link href="/verify">
                    <span>
                      <ScanLine size={18} aria-hidden="true" />
                      Verify a product
                    </span>
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </Link>
                  <Link
                    href={
                      profile?.role === "service_center"
                        ? "/claims"
                        : "/transfers"
                    }
                  >
                    <span>
                      {profile?.role === "service_center" ? (
                        <ShieldCheck size={18} aria-hidden="true" />
                      ) : (
                        <ArrowLeftRight size={18} aria-hidden="true" />
                      )}
                      {profile?.role === "service_center"
                        ? "Manage warranty claims"
                        : "Manage ownership transfers"}
                    </span>
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </Link>
                  <Link href="/profile">
                    <span>
                      <Box size={18} aria-hidden="true" />
                      Review your profile
                    </span>
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </Link>
                </div>
              </section>
            </div>
          </>
        )
      )}
    </AppShell>
  );
}
