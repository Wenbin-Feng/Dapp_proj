"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  ArrowUpRight,
  Box,
  LayoutDashboard,
  LogOut,
  Menu,
  ScanLine,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useWallet } from "@/components/wallet-provider";
import { shortWallet } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/types";
import { BRAND } from "@/lib/brand";
import { Loading, Logo } from "./ui";
import { ChainNotice } from "./chain-notice";

const links = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/transfers", label: "Transfers", icon: ArrowLeftRight },
  { href: "/claims", label: "Warranty claims", icon: ShieldCheck },
  { href: "/verify", label: "Verify a product", icon: ScanLine },
  { href: "/profile", label: "My profile", icon: UserRound },
];
export function AppShell({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const navigationToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        navigationToggle.current?.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  useEffect(() => {
    if (!wallet.loading && !wallet.connecting) {
      if (!wallet.address) router.replace("/login");
      else if (!wallet.profile) router.replace("/onboarding");
    }
  }, [
    wallet.loading,
    wallet.connecting,
    wallet.address,
    wallet.profile,
    router,
  ]);
  useEffect(() => setOpen(false), [pathname]);
  if (wallet.loading || !wallet.profile)
    return (
      <>
        <PublicHeaderFallback />
        <Loading />
      </>
    );
  return (
    <div className="app-layout">
      <header className="mobile-header">
        <Logo />
        <button
          ref={navigationToggle}
          className="button-icon"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="workspace-sidebar"
          onClick={() => setOpen(!open)}
        >
          {open ? <X /> : <Menu />}
        </button>
      </header>
      {open && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        id="workspace-sidebar"
        className={`sidebar ${open ? "sidebar-open" : ""}`}
      >
        <div className="sidebar-brand">
          <Logo />
          <span className="workspace-tag">PRODUCT PASSPORT</span>
        </div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav aria-label="Workspace navigation">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`sidebar-link ${pathname === href || (href === "/dashboard" && pathname.startsWith("/products")) ? "active" : ""}`}
              aria-current={pathname === href ? "page" : undefined}
            >
              <Icon size={19} aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
        {wallet.profile.role === "manufacturer" && (
          <Link href="/products/new" className="button sidebar-action">
            <Box size={18} aria-hidden="true" />
            Register product
          </Link>
        )}
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="status-dot" />
            One product. Its whole story.
            <ArrowUpRight size={15} aria-hidden="true" />
          </div>
          <div className="account-card">
            <span className="avatar">
              {wallet.profile.display_name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{wallet.profile.display_name}</strong>
              <span>{ROLE_LABELS[wallet.profile.role]}</span>
              <span className="mono">
                {shortWallet(wallet.profile.wallet_address)}
              </span>
            </div>
            <button
              className="button-icon"
              onClick={() => void wallet.signOut()}
              aria-label="Sign out"
            >
              <LogOut size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
      <main id="main-content" className="app-main">
        <ChainNotice />
        <div className="workspace-topbar">
          <span>
            <span className="status-dot" /> Wallet connected
          </span>
          <span className="mono">
            {shortWallet(wallet.profile.wallet_address)}
          </span>
        </div>
        <div className="app-content">{children}</div>
        <footer className="app-footer">
          <span>{BRAND.name} · Product provenance, made clear.</span>
          <Link href="/verify">
            Public verification <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </footer>
      </main>
    </div>
  );
}
function PublicHeaderFallback() {
  return (
    <div className="auth-top">
      <Logo />
      <Link className="nav-text" href="/verify">
        Verify a product
      </Link>
    </div>
  );
}
