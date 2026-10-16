"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  LoaderCircle,
  ShieldCheck,
  Wrench,
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
import { formatDate, shortWallet } from "@/lib/format";
import type { Claim } from "@/lib/types";
export default function Claims() {
  const productGateway = useProductGateway();
  const { profile } = useWallet();
  const { data, loading, error, reload } = useDashboard();
  const [filter, setFilter] = useState("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const claims = data?.claims || [];
  const filtered = claims.filter(
    (item) =>
      filter === "all" ||
      (filter === "open" && ["submitted", "approved"].includes(item.status)) ||
      item.status === filter,
  );
  async function action(
    claim: Claim,
    operation: "approve" | "reject" | "complete",
    text?: string,
  ) {
    setBusy(claim.id);
    setActionError(null);
    setMessage("");
    try {
      await productGateway.claimAction(claim.id, {
        action: operation,
        ...(operation === "reject"
          ? { reason: text }
          : operation === "complete"
            ? { resolution: text }
            : {}),
      });
      setMessage(
        operation === "approve"
          ? "Claim approved. Record the completed repair when service is finished."
          : operation === "reject"
            ? "Claim rejected. The service allowance is unchanged."
            : "Repair completed and recorded. One service claim has been used.",
      );
      await reload();
    } catch (e) {
      setActionError(
        e instanceof Error
          ? e.message
          : "The warranty request couldn't be updated.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <AppShell>
      <PageTitle
        eyebrow={
          profile?.role === "service_center"
            ? "PRODUCT CARE, CONNECTED"
            : "COVERAGE THAT STAYS WITH YOU"
        }
        title="Warranty claims"
        description={
          profile?.role === "service_center"
            ? "Review requests assigned to your organization, then record the work that keeps each product going."
            : "Follow your service requests from submission to completed repair."
        }
        action={
          profile?.role === "customer" ? (
            <Link
              href="/dashboard"
              className="button button-secondary button-small"
            >
              Choose a product
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          ) : undefined
        }
      />
      <ErrorNotice error={error || actionError} />
      {message && <SuccessNotice>{message}</SuccessNotice>}
      {error && (
        <button
          className="button button-secondary button-small"
          onClick={() => void reload()}
        >
          Reload warranty claims
        </button>
      )}
      {loading ? (
        <Loading text="Loading warranty requests…" />
      ) : (
        data && (
          <>
            <div className="filter-bar">
              {["open", "completed", "rejected", "all"].map((item) => (
                <button
                  className={`filter-button ${filter === item ? "active" : ""}`}
                  key={item}
                  aria-pressed={filter === item}
                  onClick={() => setFilter(item)}
                >
                  {item === "open"
                    ? "Open requests"
                    : item === "all"
                      ? "All requests"
                      : item === "completed"
                        ? "Completed"
                        : "Rejected"}
                </button>
              ))}
            </div>
            {filtered.length ? (
              <div className="claim-grid">
                {filtered.map((claim) => (
                  <ClaimCard
                    key={claim.id}
                    claim={claim}
                    canAct={
                      profile?.role === "service_center" &&
                      claim.service_center_id === profile.id
                    }
                    busy={busy !== null}
                    processing={busy === claim.id}
                    onAction={action}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title={
                  claims.length
                    ? "No requests in this view"
                    : profile?.role === "service_center"
                      ? "Your service queue is clear."
                      : "A little care goes a long way."
                }
                description={
                  claims.length
                    ? "Try another status to see your previous warranty requests."
                    : profile?.role === "service_center"
                      ? "Customers' requests will appear here when they choose your service center."
                      : "Open an eligible product's passport and choose Warranty to request service from a registered center."
                }
                action={
                  profile?.role === "customer" ? (
                    <Link
                      href="/dashboard"
                      className="button button-secondary button-small"
                    >
                      View your products
                      <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                  ) : undefined
                }
              />
            )}
            <p className="form-note">
              Only completed repairs count toward the service allowance.
              Rejected requests do not use a claim.
            </p>
          </>
        )
      )}
    </AppShell>
  );
}
function ClaimCard({
  claim,
  canAct,
  busy,
  processing,
  onAction,
}: {
  claim: Claim;
  canAct: boolean;
  busy: boolean;
  processing: boolean;
  onAction: (
    claim: Claim,
    operation: "approve" | "reject" | "complete",
    text?: string,
  ) => Promise<void>;
}) {
  const [form, setForm] = useState<"reject" | "complete" | null>(null);
  const [text, setText] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form) {
      await onAction(claim, form, text.trim());
    }
  }
  return (
    <article className="panel claim-card">
      <div className="section-title">
        <span className="icon-tile">
          <ShieldCheck size={21} aria-hidden="true" />
        </span>
        <div>
          <Link
            href={`/products/${claim.product_id}`}
            className="table-product"
          >
            <h3>{claim.model || "Product warranty request"}</h3>
          </Link>
          <p className="mono">{claim.serial_number || claim.product_id}</p>
        </div>
        <StatusBadge status={claim.status} />
      </div>
      <p className="claim-description">{claim.description}</p>
      <div className="claim-meta">
        <span>
          {canAct
            ? `Customer ${claim.customer_wallet ? shortWallet(claim.customer_wallet) : "wallet"}`
            : claim.service_center_name || "Assigned service center"}
        </span>
        <time dateTime={claim.created_at}>{formatDate(claim.created_at)}</time>
      </div>
      {claim.decision_reason && (
        <p className="claim-resolution">
          <strong>Decision reason</strong>
          {claim.decision_reason}
        </p>
      )}
      {claim.resolution && (
        <p className="claim-resolution">
          <strong>Completed repair</strong>
          {claim.resolution}
        </p>
      )}
      {claim.resolved_at && (
        <p className="small muted" style={{ marginTop: 16 }}>
          Resolved {formatDate(claim.resolved_at)}
        </p>
      )}
      {canAct && claim.status === "submitted" && !form && (
        <div className="button-row">
          <button
            className="button button-small"
            disabled={busy}
            onClick={() => void onAction(claim, "approve")}
          >
            {processing ? (
              <LoaderCircle size={15} className="spinner" aria-hidden="true" />
            ) : (
              <Check size={15} aria-hidden="true" />
            )}
            Approve request
          </button>
          <button
            className="button button-ghost button-small"
            disabled={busy}
            onClick={() => {
              setForm("reject");
              setText("");
            }}
          >
            <X size={15} aria-hidden="true" />
            Reject
          </button>
        </div>
      )}
      {canAct && claim.status === "approved" && !form && (
        <button
          className="button button-small"
          disabled={busy}
          onClick={() => {
            setForm("complete");
            setText("");
          }}
        >
          <Wrench size={15} aria-hidden="true" />
          Record completed repair
        </button>
      )}
      {form && canAct && ["submitted", "approved"].includes(claim.status) && (
        <form
          className="claim-action-panel"
          onSubmit={(event) => void submit(event)}
        >
          <div className="field">
            <label htmlFor={`claim-text-${claim.id}`}>
              {form === "reject"
                ? "Reason for rejecting this request"
                : "Repair performed & outcome"}
            </label>
            <textarea
              id={`claim-text-${claim.id}`}
              required
              maxLength={2000}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                form === "reject"
                  ? "Explain the decision to the customer."
                  : "Describe the work completed and the product's condition."
              }
            />
            <span className="field-hint">
              {form === "reject"
                ? "Rejection leaves the service allowance unchanged."
                : "Completing this repair uses one service claim and adds a service record to the passport."}
            </span>
          </div>
          <div className="button-row">
            <button
              className={`button button-small ${form === "reject" ? "button-danger" : ""}`}
              disabled={busy}
            >
              {processing && (
                <LoaderCircle
                  size={15}
                  className="spinner"
                  aria-hidden="true"
                />
              )}
              {form === "reject"
                ? "Confirm rejection"
                : "Complete & record repair"}
            </button>
            <button
              className="button button-ghost button-small"
              type="button"
              disabled={busy}
              onClick={() => setForm(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
