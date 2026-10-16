"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  LoaderCircle,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useDashboard } from "@/components/data";
import { useWallet } from "@/components/wallet-provider";
import {
  EmptyState,
  ErrorNotice,
  Loading,
  PageTitle,
  StatusBadge,
  SuccessNotice,
} from "@/components/ui";
import { useProductGateway } from "@/components/product-gateway";
import { PaidOffer } from "@/components/paid-offer";
import { TransactionLink } from "@/components/demo-chain-ui";
import { displayAmount } from "@/lib/chain/amounts";
import type { Hash } from "viem";
import { formatDate, shortWallet } from "@/lib/format";
export default function Transfers() {
  const productGateway = useProductGateway();
  const { profile } = useWallet();
  const { data, loading, error, reload } = useDashboard();
  const [filter, setFilter] = useState("all");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const transfers = data?.transfers || [];
  const filtered = transfers.filter(
    (item) =>
      (filter === "all" ||
        (filter === "incoming" && item.to_user_id === profile?.id) ||
        (filter === "outgoing" && item.from_user_id === profile?.id)) &&
      (!pendingOnly || item.status === "pending"),
  );
  async function action(id: string, operation: "accept" | "reject" | "cancel") {
    setBusy(id);
    setActionError(null);
    setMessage("");
    try {
      await productGateway.transferAction(id, operation);
      setMessage(
        operation === "accept"
          ? "Transfer accepted. The product now belongs to your wallet."
          : operation === "reject"
            ? "Transfer rejected. Ownership stays with the sender."
            : "Transfer cancelled. Ownership stays with you.",
      );
      await reload();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "The transfer couldn't be updated.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <AppShell>
      <PageTitle
        eyebrow="OWNERSHIP, IN MOTION"
        title="Product transfers"
        description="Each handover needs two sides. Send a product on, or accept the next chapter of its journey."
        action={
          <Link
            href="/dashboard"
            className="button button-secondary button-small"
          >
            Your products
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        }
      />
      <ErrorNotice error={error || actionError} />
      {message && <SuccessNotice>{message}</SuccessNotice>}
      {error && (
        <button
          className="button button-secondary button-small"
          onClick={() => void reload()}
        >
          Reload transfers
        </button>
      )}
      {loading ? (
        <Loading text="Loading ownership transfers…" />
      ) : (
        data && (
          <>
            <div className="filter-bar">
              {["all", "incoming", "outgoing"].map((item) => (
                <button
                  key={item}
                  className={`filter-button ${filter === item ? "active" : ""}`}
                  aria-pressed={filter === item}
                  onClick={() => setFilter(item)}
                >
                  {item === "all"
                    ? "All transfers"
                    : item === "incoming"
                      ? "Incoming"
                      : "Outgoing"}
                  {item !== "all" &&
                    ` (${transfers.filter((transfer) => (item === "incoming" ? transfer.to_user_id === profile?.id : transfer.from_user_id === profile?.id)).length})`}
                </button>
              ))}
              <button
                className={`filter-button ${pendingOnly ? "active" : ""}`}
                aria-pressed={pendingOnly}
                onClick={() => setPendingOnly(!pendingOnly)}
              >
                Pending only
              </button>
            </div>
            {filtered.length ? (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">
                    Your incoming and outgoing product ownership transfers
                  </caption>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Direction & recipient</th>
                      <th>Started</th>
                      <th>Status</th>
                      <th style={{ textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((transfer) => {
                      const incoming = transfer.to_user_id === profile?.id;
                      return (
                        <tr key={transfer.id}>
                          <td>
                            <Link
                              href={`/products/${transfer.product_id}`}
                              className="table-product"
                            >
                              <strong>
                                {transfer.model || "Product passport"}
                              </strong>
                              <span className="mono small muted">
                                {transfer.serial_number || transfer.product_id}
                              </span>
                            </Link>
                          </td>
                          <td>
                            <strong
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 7,
                              }}
                            >
                              {incoming ? (
                                <ArrowDownLeft size={14} aria-hidden="true" />
                              ) : (
                                <ArrowUpRight size={14} aria-hidden="true" />
                              )}
                              {incoming ? "Incoming" : "Outgoing"}
                            </strong>
                            <span className="mono small muted">
                              {incoming
                                ? shortWallet(transfer.from_wallet)
                                : "You"}{" "}
                              →{" "}
                              {incoming
                                ? "You"
                                : shortWallet(transfer.to_wallet)}
                            </span>
                          </td>
                          <td className="small muted">
                            {formatDate(transfer.created_at)}
                          </td>
                          <td>
                            <StatusBadge status={transfer.status} />
                            {transfer.price_pdc &&
                              BigInt(transfer.price_pdc) > 0n && (
                                <p className="small">
                                  {displayAmount(
                                    BigInt(transfer.price_pdc),
                                    18,
                                  )}{" "}
                                  PDC
                                </p>
                              )}
                            {transfer.expires_at && (
                              <p className="small muted">
                                Expires {formatDate(transfer.expires_at)}
                              </p>
                            )}
                            {transfer.transaction_hash && (
                              <TransactionLink
                                hash={transfer.transaction_hash as Hash}
                              />
                            )}
                          </td>
                          <td>
                            {transfer.status === "pending" ? (
                              <div className="button-row">
                                {incoming ? (
                                  <>
                                    {transfer.price_pdc &&
                                    BigInt(transfer.price_pdc) > 0n ? (
                                      <PaidOffer
                                        transfer={transfer}
                                        disabled={busy !== null}
                                        accept={() =>
                                          action(transfer.id, "accept")
                                        }
                                      />
                                    ) : (
                                      <button
                                        className="button button-small"
                                        disabled={busy !== null}
                                        onClick={() =>
                                          void action(transfer.id, "accept")
                                        }
                                      >
                                        {busy === transfer.id ? (
                                          <LoaderCircle
                                            size={14}
                                            className="spinner"
                                            aria-hidden="true"
                                          />
                                        ) : (
                                          <Check size={14} aria-hidden="true" />
                                        )}
                                        Accept
                                      </button>
                                    )}
                                    <button
                                      className="button button-ghost button-small"
                                      disabled={busy !== null}
                                      onClick={() =>
                                        void action(transfer.id, "reject")
                                      }
                                    >
                                      <X size={14} aria-hidden="true" />
                                      Reject
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    className="button button-ghost button-small"
                                    disabled={busy !== null}
                                    onClick={() =>
                                      void action(transfer.id, "cancel")
                                    }
                                  >
                                    {busy === transfer.id && (
                                      <LoaderCircle
                                        size={14}
                                        className="spinner"
                                        aria-hidden="true"
                                      />
                                    )}
                                    Cancel transfer
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span
                                className="small muted"
                                style={{ textAlign: "right" }}
                              >
                                {transfer.resolved_at
                                  ? formatDate(transfer.resolved_at)
                                  : "Resolved"}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title={
                  transfers.length
                    ? "No transfers in this view"
                    : "Ready for the next owner."
                }
                description={
                  transfers.length
                    ? "Choose a different direction or remove the pending filter."
                    : "Incoming and outgoing product transfers will appear here. Start an ownership handover from a product's passport."
                }
                action={
                  <Link
                    href="/dashboard"
                    className="button button-secondary button-small"
                  >
                    Explore your products
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                }
              />
            )}
            <p className="form-note">
              A product stays with its current owner until the recipient
              accepts. Pending transfers and open warranty claims cannot
              overlap.
            </p>
          </>
        )
      )}
    </AppShell>
  );
}
