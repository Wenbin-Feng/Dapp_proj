"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Fingerprint, LoaderCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useWallet } from "@/components/wallet-provider";
import { EmptyState, ErrorNotice, PageTitle } from "@/components/ui";
import { productGateway } from "@/lib/api-client";
export default function NewProduct() {
  const { profile } = useWallet();
  const router = useRouter();
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [days, setDays] = useState("365");
  const [claims, setClaims] = useState("3");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const product = await productGateway.register({
        model: model.trim(),
        serial_number: serial.trim(),
        warranty_duration_days: Number(days),
        max_claims: Number(claims),
      });
      router.push(`/products/${product.id}`);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Registration failed. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <AppShell>
      <div className="breadcrumb">
        <Link href="/dashboard">
          <ArrowLeft size={13} aria-hidden="true" /> Your inventory
        </Link>
        <span>/</span>
        <span>Register product</span>
      </div>
      <PageTitle
        eyebrow="THE FIRST CHAPTER"
        title="Give your product an identity."
        description="Create its digital passport. Define the product and the warranty that travels with it."
      />
      {profile && profile.role !== "manufacturer" ? (
        <EmptyState
          title="Manufacturer access required"
          description="Product registration is available to manufacturer profiles."
          action={
            <Link href="/dashboard" className="button button-secondary">
              Return to workspace
            </Link>
          }
        />
      ) : (
        <div className="new-product-layout">
          <form
            className="panel form-panel"
            onSubmit={(event) => void submit(event)}
          >
            <h2>Product details</h2>
            <ErrorNotice error={error} />
            <div className="form-grid">
              <div className="field full-width">
                <label htmlFor="model">Product model</label>
                <input
                  id="model"
                  required
                  maxLength={120}
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="e.g. Studio Headphones Pro"
                />
              </div>
              <div className="field full-width">
                <label htmlFor="serial">Serial number</label>
                <input
                  id="serial"
                  required
                  maxLength={120}
                  className="mono"
                  value={serial}
                  onChange={(event) => setSerial(event.target.value)}
                  placeholder="Enter the product's unique serial"
                />
                <span className="field-hint">
                  Must be unique across all registered products.
                </span>
              </div>
              <div className="field">
                <label htmlFor="warranty-days">Warranty duration (days)</label>
                <input
                  id="warranty-days"
                  type="number"
                  min={1}
                  max={36500}
                  step={1}
                  required
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                />
                <span className="field-hint">
                  Starts when the first customer accepts the retail transfer.
                </span>
              </div>
              <div className="field">
                <label htmlFor="claim-limit">Maximum service claims</label>
                <input
                  id="claim-limit"
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  required
                  value={claims}
                  onChange={(event) => setClaims(event.target.value)}
                />
                <span className="field-hint">
                  Counted only after a repair is completed.
                </span>
              </div>
              <div className="field full-width">
                <label htmlFor="manufacturer">Registered manufacturer</label>
                <input
                  id="manufacturer"
                  readOnly
                  value={profile?.organization_name || ""}
                />
              </div>
            </div>
            <p className="form-note">
              You can add an optimized product image after registration.
            </p>
            <div className="form-actions">
              <Link href="/dashboard" className="button button-ghost">
                Cancel
              </Link>
              <button className="button" disabled={saving}>
                {saving ? (
                  <>
                    <LoaderCircle
                      size={17}
                      className="spinner"
                      aria-hidden="true"
                    />
                    Creating passport…
                  </>
                ) : (
                  <>
                    Register product
                    <ArrowRight size={17} aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          </form>
          <aside className="panel info-panel">
            <Fingerprint size={32} strokeWidth={1.3} aria-hidden="true" />
            <h3>
              One identity.
              <br />
              Its whole journey.
            </h3>
            <p>
              Registration creates a permanent product identity and makes your
              organization its first owner.
            </p>
            <ol>
              <li>Register a unique serial number and set the warranty.</li>
              <li>Add a product image to complete the passport.</li>
              <li>Initiate a transfer to a registered retailer.</li>
              <li>
                The first retail sale activates the customer&apos;s warranty.
              </li>
            </ol>
          </aside>
        </div>
      )}
    </AppShell>
  );
}
