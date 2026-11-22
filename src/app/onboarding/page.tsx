"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Factory,
  LoaderCircle,
  Store,
  UserRound,
  Wrench,
} from "lucide-react";
import { useWallet } from "@/components/wallet-provider";
import { api } from "@/lib/api-client";
import { shortWallet } from "@/lib/format";
import { ROLES, ROLE_LABELS, type Profile, type Role } from "@/lib/types";
import { ErrorNotice, Loading, Logo, PageTitle } from "@/components/ui";
const icons = {
  manufacturer: Factory,
  retailer: Store,
  customer: UserRound,
  service_center: Wrench,
};
const descriptions = {
  manufacturer:
    "Register products, set their warranty and pass inventory to retailers.",
  retailer: "Receive inventory and transfer products to their first customers.",
  customer:
    "Manage your products, make warranty claims and transfer ownership.",
  service_center:
    "Review assigned warranty claims and record completed repairs.",
};
export default function Onboarding() {
  const wallet = useWallet();
  const router = useRouter();
  const [role, setRole] = useState<Role>("customer");
  const [assignedRole, setAssignedRole] = useState<Role | null>(null);
  useEffect(() => {
    let active = true;
    setAssignedRole(null);
    if (wallet.address) {
      void api<{walletRole?: string}>("/api/chain/status").then(status => {
        const assigned = ROLES.find(value => value === status.walletRole);
        if (active && assigned) {
          setAssignedRole(assigned);
          setRole(assigned);
        }
      }).catch(() => {}); // The server checks the role again when the form is saved.
    }
    return () => { active = false; };
  }, [wallet.address]);
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!wallet.loading && !wallet.connecting) {
      if (!wallet.address) router.replace("/login");
      else if (wallet.profile) router.replace("/dashboard");
    }
  }, [
    wallet.loading,
    wallet.connecting,
    wallet.address,
    wallet.profile,
    router,
  ]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    if (!name.trim()) {
      setError("Enter a display name.");
      document.getElementById("display-name")?.focus();
      return;
    }
    if (role !== "customer" && !organization.trim()) {
      setError("Enter your organization name.");
      document.getElementById("organization-name")?.focus();
      return;
    }
    setSaving(true);
    try {
      await api<Profile>("/api/onboarding", {
        method: "POST",
        body: JSON.stringify({
          display_name: name.trim(),
          role,
          organization_name: role === "customer" ? null : organization.trim(),
        }),
      });
      await wallet.refreshProfile();
      router.replace("/dashboard");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "We couldn't save your profile. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="auth-layout">
      <header className="auth-top">
        <Logo />
        <Link href="/verify" className="nav-text">
          Public verification
        </Link>
      </header>
      <main id="main-content" className="onboarding-main">
        <PageTitle
          eyebrow="ONE LAST STEP"
          title="Find your place in the journey."
          description="Tell us a little about yourself. Your profile will be linked to your connected wallet."
        />
        {wallet.loading || !wallet.address || Boolean(wallet.profile) ? (
          <Loading />
        ) : (
          <form
            className="panel form-panel"
            onSubmit={(event) => void submit(event)}
            aria-busy={saving}
          >
            <ErrorNotice error={error || wallet.error} />
            <fieldset
              disabled={saving}
              style={{ border: 0, padding: 0, margin: 0 }}
            >
              <legend className="small" style={{ fontWeight: 600 }}>
                Choose your role
              </legend>
              <div className="role-grid">
                {ROLES.map((item) => {
                  const Icon = icons[item];
                  return (
                    <button
                      className={`role-option ${role === item ? "selected" : ""}`}
                      type="button"
                      key={item}
                      aria-pressed={role === item}
                      disabled={assignedRole !== null && assignedRole !== item}
                      onClick={() => { setError(null); setRole(item); }}
                    >
                      <Icon size={24} aria-hidden="true" />
                      <strong>{ROLE_LABELS[item]}</strong>
                      {role === item && (
                        <span className="role-check">
                          <Check size={12} aria-hidden="true" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="notice notice-info">
              {descriptions[role]} Your role is fixed once this profile is
              saved.
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="display-name">Display name</label>
                <input
                  id="display-name"
                  autoComplete="nickname"
                  required
                  disabled={saving}
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="How should we address you?"
                />
                <span className="field-hint">
                  Your name is visible in your own workspace.
                </span>
              </div>
              {role !== "customer" && (
                <div className="field">
                  <label htmlFor="organization-name">Organization name</label>
                  <input
                    id="organization-name"
                    autoComplete="organization"
                    required
                    disabled={saving}
                    maxLength={120}
                    value={organization}
                    onChange={(event) => setOrganization(event.target.value)}
                    placeholder="Your company or service center"
                  />
                  <span className="field-hint">
                    Used for manufacturer identity and service center discovery.
                  </span>
                </div>
              )}
              <div className="field full-width">
                <label htmlFor="connected-wallet">Connected wallet</label>
                <input
                  id="connected-wallet"
                  className="mono"
                  readOnly
                  value={wallet.address}
                />
                <span className="field-hint">
                  {shortWallet(wallet.address)} · You can change your name
                  later.
                </span>
              </div>
            </div>
            <div className="form-actions">
              <button className="button" disabled={saving}>
                {saving ? (
                  <>
                    <LoaderCircle
                      size={17}
                      className="spinner"
                      aria-hidden="true"
                    />
                    Saving profile…
                  </>
                ) : (
                  <>
                    Enter your workspace{" "}
                    <ArrowRight size={17} aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
