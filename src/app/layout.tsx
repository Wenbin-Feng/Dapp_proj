import type { Metadata } from "next";
import { WalletProvider } from "@/components/wallet-provider";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Origin — Every product has a story",
    template: "%s | Origin",
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
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
