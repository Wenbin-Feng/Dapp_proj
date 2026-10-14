import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowLeftRight,
  Box,
  Fingerprint,
  ScanLine,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { BrandMark, Logo, PublicHeader } from "@/components/ui";
import { BRAND } from "@/lib/brand";
const features = [
  {
    icon: Fingerprint,
    title: "An identity that lasts.",
    text: "A unique passport connects each product to its manufacturer, serial number and original warranty.",
  },
  {
    icon: ArrowLeftRight,
    title: "Ownership, passed on.",
    text: "Transfer a product with confidence. Each handover is accepted by its next owner and becomes part of its story.",
  },
  {
    icon: ShieldCheck,
    title: "Care without the paperwork.",
    text: "Keep warranty coverage, service claims and completed repairs together, even when a product changes hands.",
  },
];
const journey = [
  {
    title: "Manufacturer",
    text: "Register the product and define its warranty. Its passport begins here.",
  },
  {
    title: "Retailer",
    text: "Receive inventory and hand over each product to its first customer.",
  },
  {
    title: "Customer",
    text: "Own it, care for it, and transfer it with its history intact.",
  },
  {
    title: "Service center",
    text: "Assess warranty claims and record the repairs that keep it going.",
  },
];
export default function Home() {
  return (
    <div className="landing">
      <PublicHeader />
      <main id="main-content">
        <section className="hero">
          <div>
            <div className="hero-eyebrow">
              <span className="status-dot" /> PRODUCT IDENTITY, CONNECTED
            </div>
            <h1>
              Every product
              <br />
              has a story.
              <br />
              <span>Keep it intact.</span>
            </h1>
            <p className="hero-description">
              From its first registration to its next owner. One digital
              passport for provenance, ownership and everything in between.
            </p>
            <div className="button-row">
              <Link href="/login" className="button">
                Connect your wallet{" "}
                <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
              <Link href="/verify" className="button button-ghost">
                <ScanLine size={18} aria-hidden="true" />
                Verify a product
              </Link>
            </div>
            <div className="hero-trust">
              <Wallet size={15} aria-hidden="true" />
              Your wallet is your identity. Your product has its own.
            </div>
          </div>
          <div
            className="passport-scene"
            aria-label="Illustration of a product passport"
          >
            <div className="scene-grid" />
            <span className="illustration-label">Passport illustration</span>
            <div className="illustration-card">
              <div className="illustration-card-top">
                <div className="illustration-brand-title">
                  <strong>{BRAND.name}</strong>
                  <span>Digital passport</span>
                </div>
                <BrandMark className="brand-mark-small" />
              </div>
              <div className="product-art">
                <svg viewBox="0 0 180 180" fill="none" aria-hidden="true">
                  <defs>
                    <linearGradient
                      id="cube-top"
                      x1="35"
                      y1="25"
                      x2="135"
                      y2="100"
                    >
                      <stop stopColor="#749d93" />
                      <stop offset="1" stopColor="#264d43" />
                    </linearGradient>
                    <linearGradient
                      id="cube-side"
                      x1="90"
                      y1="75"
                      x2="145"
                      y2="150"
                    >
                      <stop stopColor="#315e51" />
                      <stop offset="1" stopColor="#122c26" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M90 20 154 57 90 94 26 57Z"
                    fill="url(#cube-top)"
                    stroke="#9ac0b1"
                    strokeWidth="1.2"
                  />
                  <path
                    d="m26 57 64 37v74l-64-37Z"
                    fill="#193c33"
                    stroke="#527d6d"
                    strokeWidth="1.2"
                  />
                  <path
                    d="m90 94 64-37v74l-64 37Z"
                    fill="url(#cube-side)"
                    stroke="#6c9d86"
                    strokeWidth="1.2"
                  />
                  <path
                    d="m58 38 64 37v29"
                    stroke="#b1d9c5"
                    strokeWidth="1.2"
                  />
                  <path
                    d="m37 112 24 14m-24-5 15 9"
                    stroke="#6c9d86"
                    strokeWidth="2"
                  />
                  <path
                    d="M90 20v12m64 25-10 6M26 57l10 6M90 168v-13"
                    stroke="#4ae3b5"
                    strokeWidth="3"
                  />
                </svg>
              </div>
              <h2 className="illustration-title">One product. One passport.</h2>
              <p className="illustration-subtitle">
                A lasting record, wherever it goes.
              </p>
              <dl className="illustration-fields">
                <div>
                  <dt>PRODUCT IDENTITY</dt>
                  <dd>Unique serial & manufacturer</dd>
                </div>
                <div>
                  <dt>OWNERSHIP</dt>
                  <dd>A traceable journey</dd>
                </div>
                <div>
                  <dt>WARRANTY</dt>
                  <dd>Coverage that stays connected</dd>
                </div>
                <div>
                  <dt>SERVICE HISTORY</dt>
                  <dd>Every repair, in one place</dd>
                </div>
              </dl>
            </div>
            <div className="floating-note">
              <ShieldCheck size={29} strokeWidth={1.4} aria-hidden="true" />
              <div>
                <strong>Its history travels with it.</strong>
                <span>From first owner to next.</span>
              </div>
            </div>
          </div>
        </section>
        <div className="landing-strip">
          <div className="strip-item">
            <Fingerprint size={25} strokeWidth={1.4} aria-hidden="true" />
            <div>
              <strong>Unique by design</strong>
              <span>One identity for each product</span>
            </div>
          </div>
          <div className="strip-item">
            <ArrowLeftRight size={25} strokeWidth={1.4} aria-hidden="true" />
            <div>
              <strong>A continuous journey</strong>
              <span>Registration, ownership and resale</span>
            </div>
          </div>
          <div className="strip-item">
            <ScanLine size={25} strokeWidth={1.4} aria-hidden="true" />
            <div>
              <strong>Open to verification</strong>
              <span>A passport anyone can check</span>
            </div>
          </div>
        </div>
        <section className="landing-section">
          <div className="section-heading">
            <div>
              <div className="eyebrow">BEYOND A RECEIPT</div>
              <h2>
                Everything that matters.
                <br />
                Connected for good.
              </h2>
            </div>
            <p>
              Products change hands. Their identity, coverage and history should
              stay together.
            </p>
          </div>
          <div className="feature-grid">
            {features.map(({ icon: Icon, title, text }) => (
              <article className="feature-card" key={title}>
                <Icon size={31} strokeWidth={1.3} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="landing-section journey-section" id="how-it-works">
          <div className="section-heading">
            <div>
              <div className="eyebrow">FOUR ROLES. ONE SHARED STORY.</div>
              <h2>Built for the whole journey.</h2>
            </div>
            <p>
              Each participant adds the next chapter, with clear
              responsibilities at every step.
            </p>
          </div>
          <div className="journey-grid">
            {journey.map((item, index) => (
              <article className="journey-item" key={item.title}>
                <div className="journey-number">0{index + 1} /</div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="landing-cta">
          <div>
            <h2>
              Start with a wallet.
              <br />
              Build a lasting record.
            </h2>
            <p>Connect MetaMask and find your place in the product journey.</p>
          </div>
          <Link href="/login" className="button">
            Open your workspace <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </section>
      </main>
      <footer className="public-footer">
        <Logo />
        <span>Product provenance, made clear.</span>
        <Link href="/verify" className="text-link">
          Explore verification <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </footer>
    </div>
  );
}
