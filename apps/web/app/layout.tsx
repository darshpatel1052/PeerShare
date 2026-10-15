import type { Metadata } from "next";
import Navigation from "../components/navigation";
import Link from "next/link";
import { BrandMark } from "../components/ui";
import { AuthProvider } from "../components/auth-provider";
import "./globals.css";
import "./product-shell.css";
import { ThemeProvider } from "../components/theme-provider";

export const metadata: Metadata = {
  title: {
    default: "PeerShare · Watch, create and share",
    template: "%s · PeerShare",
  },
  description:
    "Discover videos, follow your curiosity, and publish on your own channel.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <ThemeProvider>
          <AuthProvider>
            <Navigation />
            {children}
          </AuthProvider>
        </ThemeProvider>
        <footer className="site-footer">
          <div className="footer-inner">
            <span className="footer-brand">
              <BrandMark />
              PeerShare
            </span>

            <nav aria-label="Footer navigation">
              <Link href="/">Explore</Link>
              <Link href="/account">Your workspace</Link>
              <Link href="/settings">Settings</Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
