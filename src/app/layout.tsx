import type { Metadata } from "next";
import { WalletProvider } from "@/components/wallet-provider";
import { DemoChainProvider } from "@/components/demo-chain-provider";
import { BRAND } from "@/lib/brand";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} — Every product has a story`,
    template: `%s | ${BRAND.name}`,
  },
  applicationName: BRAND.name,
  icons: {
    icon: { url: BRAND.logoPath, type: "image/png" },
    shortcut: BRAND.logoPath,
    apple: BRAND.logoPath,
  },
  description:
    "Register, transfer and verify product passports. Keep ownership, warranty and service history connected.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <WalletProvider><DemoChainProvider>{children}</DemoChainProvider></WalletProvider>
      </body>
    </html>
  );
}
