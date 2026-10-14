"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Fingerprint,
  LoaderCircle,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useWallet } from "@/components/wallet-provider";
import { ErrorNotice, Loading, Logo } from "@/components/ui";
export default function Login() {
  const wallet = useWallet();
  const router = useRouter();
  useEffect(() => {
    if (!wallet.loading && !wallet.connecting && wallet.address)
      router.replace(wallet.profile ? "/dashboard" : "/onboarding");
  }, [
    wallet.loading,
    wallet.connecting,
    wallet.address,
    wallet.profile,
    router,
  ]);
  return (
    <div className="auth-layout">
      <header className="auth-top">
        <Logo />
        <Link href="/verify" className="nav-text">
          Verify without signing in{" "}
          <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
      </header>
      <main id="main-content" className="auth-main">
        <div className="auth-story">
          <div className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</div>
          <h1>
            A product journey.
            <br />
            <span>A place for you.</span>
          </h1>
          <p>
            Connect your wallet to register products, manage ownership and keep
            warranty care in one place.
          </p>
          <div className="auth-benefits">
            <div className="auth-benefit">
              <Fingerprint size={22} aria-hidden="true" />
              <div>
                <strong>Your wallet, your identity</strong>
                <span>No password to create or remember.</span>
              </div>
            </div>
            <div className="auth-benefit">
              <ShieldCheck size={22} aria-hidden="true" />
              <div>
                <strong>Sign in with a message</strong>
                <span>Login does not send a transaction or charge gas.</span>
              </div>
            </div>
          </div>
        </div>
        <section className="auth-panel" aria-labelledby="connect-title">
          <div className="wallet-icon">
            <Wallet size={29} aria-hidden="true" />
          </div>
          <h2 id="connect-title">Connect your wallet</h2>
          <p>
            Use MetaMask to sign a secure login message. If this is your first
            visit, we&apos;ll help you complete your profile.
          </p>
          <ErrorNotice error={wallet.error} />
          {wallet.loading ? (
            <Loading text="Checking your session…" />
          ) : (
            <button
              type="button"
              className="button"
              disabled={wallet.connecting || Boolean(wallet.address)}
              aria-busy={wallet.connecting}
              onClick={() => void wallet.connect()}
            >
              {wallet.connecting ? (
                <>
                  <LoaderCircle
                    className="spinner"
                    size={18}
                    aria-hidden="true"
                  />
                  Waiting for MetaMask…
                </>
              ) : (
                <>
                  <Wallet size={18} aria-hidden="true" />
                  Continue with MetaMask
                  <ArrowUpRight size={17} aria-hidden="true" />
                </>
              )}
            </button>
          )}
          <div className="auth-info">
            <ShieldCheck size={17} aria-hidden="true" />
            <span>
              Check the message in your wallet before signing. Your role and
              profile will be linked to this wallet.
            </span>
          </div>
          <p className="form-note">
            Open this site in a browser with MetaMask installed, or in the
            MetaMask app&apos;s browser.
          </p>
        </section>
      </main>
    </div>
  );
}
