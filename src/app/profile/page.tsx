"use client";

import { useState, type FormEvent } from "react";
import { LoaderCircle, Save, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import {
  Badge,
  ErrorNotice,
  Loading,
  PageTitle,
  SuccessNotice,
} from "@/components/ui";
import { useWallet } from "@/components/wallet-provider";
import { api } from "@/lib/api-client";
import { formatDate, shortWallet } from "@/lib/format";
import { ROLE_LABELS, ROLES, type Role, type Profile } from "@/lib/types";

export default function ProfilePage() {
  const { profile } = useWallet();
  return (
    <AppShell>
      {profile ? (
        <ProfileForm key={profile.id} profile={profile} />
      ) : (
        <Loading text="Loading your profile…" />
      )}
    </AppShell>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const { refreshProfile, error: walletError } = useWallet();
  const [role, setRole] = useState(profile.role);
  const [name, setName] = useState(profile.display_name);
  const [organization, setOrganization] = useState(
    profile.organization_name || "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const needsOrganization = role !== "customer";
  const changed =
    role !== profile.role ||
    name.trim() !== profile.display_name ||
    organization.trim() !== (profile.organization_name || "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSuccess(false);
    setError(null);
    if (!name.trim()) {
      setError("Enter a display name.");
      document.getElementById("profile-display-name")?.focus();
      return;
    }
    if (needsOrganization && !organization.trim()) {
      setError("Enter your organization name.");
      document.getElementById("profile-organization-name")?.focus();
      return;
    }
    setSaving(true);
    let saved = false;
    try {
      const updated = await api<Profile>("/api/me", {
        method: "PATCH",
        body: JSON.stringify({
          role,
          display_name: name.trim(),
          organization_name: organization.trim() || null,
        }),
      });
      saved = true;
      setRole(updated.role);
      setName(updated.display_name);
      setOrganization(updated.organization_name || "");
      await refreshProfile();
      setSuccess(true);
    } catch (saveError) {
      setError(
        saved
          ? "Your changes were saved, but your profile could not be refreshed. Reload this page to see the update."
          : saveError instanceof Error
            ? saveError.message
            : "Your profile could not be saved. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="YOUR ACCOUNT"
        title="A profile that follows you."
        description="Keep your details up to date and see the wallet behind your product journey."
      />
      <div className="profile-layout">
        <aside
          className="panel profile-summary"
          aria-label="Your account summary"
        >
          <div className="profile-avatar" aria-hidden="true">
            {profile.display_name.slice(0, 1).toUpperCase()}
          </div>
          <h2>{profile.display_name}</h2>
          <Badge tone="green">{ROLE_LABELS[profile.role]}</Badge>
          <p className="mono" title={profile.wallet_address}>
            {shortWallet(profile.wallet_address)}
          </p>
          <p>Member since {formatDate(profile.created_at)}</p>
        </aside>
        <form
          className="panel profile-form"
          onSubmit={(event) => void submit(event)}
          aria-busy={saving}
        >
          <h2>Profile details</h2>
          <ErrorNotice error={error || walletError} />
          {success && (
            <SuccessNotice>Your profile has been updated.</SuccessNotice>
          )}
          <div className="field">
            <label htmlFor="profile-display-name">Display name</label>
            <input
              id="profile-display-name"
              name="display_name"
              autoComplete="nickname"
              required
              maxLength={80}
              value={name}
              disabled={saving}
              onChange={(event) => {
                setName(event.target.value);
                setSuccess(false);
                setError(null);
              }}
              aria-describedby="profile-name-hint"
            />
            <span id="profile-name-hint" className="field-hint">
              The name used in your workspace.
            </span>
          </div>
          <div className="field">
            <label htmlFor="profile-role">Account role</label>
            <select id="profile-role" value={role} disabled={saving}
              aria-describedby="profile-role-hint" onChange={event => {
                setRole(event.target.value as Role);
                setSuccess(false);
                setError(null);
              }}>
              {ROLES.map(value => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}
            </select>
            <span id="profile-role-hint" className="field-hint">
              Save your role to switch workspace tools with this wallet.
            </span>
          </div>
          <div className="field">
            <label htmlFor="profile-organization-name">
              Organization name{!needsOrganization && " (optional)"}
            </label>
            <input
              id="profile-organization-name"
              name="organization_name"
              autoComplete="organization"
              required={needsOrganization}
              maxLength={120}
              value={organization}
              disabled={saving}
              onChange={(event) => {
                setOrganization(event.target.value);
                setSuccess(false);
                setError(null);
              }}
              aria-describedby="profile-organization-hint"
            />
            <span id="profile-organization-hint" className="field-hint">
              {needsOrganization
                ? "Used for your organization's identity in product and service records."
                : "Add an organization if you use this account on its behalf."}
            </span>
          </div>
          <div className="field">
            <label htmlFor="profile-wallet">Wallet address</label>
            <input
              id="profile-wallet"
              className="mono"
              readOnly
              value={profile.wallet_address}
              aria-describedby="profile-wallet-hint"
            />
            <span id="profile-wallet-hint" className="field-hint">
              This is the wallet you signed in with.
            </span>
          </div>
          <div className="form-actions">
            <button
              type="submit"
              className="button"
              disabled={saving || !changed}
            >
              {saving ? (
                <>
                  <LoaderCircle
                    size={17}
                    className="spinner"
                    aria-hidden="true"
                  />
                  Saving changes…
                </>
              ) : (
                <>
                  <Save size={17} aria-hidden="true" />
                  Save changes
                </>
              )}
            </button>
          </div>
          <p className="form-note">
            <ShieldCheck size={13} aria-hidden="true" /> Your profile is linked
            to your wallet. Keep your wallet access secure.
          </p>
        </form>
      </div>
    </>
  );
}
