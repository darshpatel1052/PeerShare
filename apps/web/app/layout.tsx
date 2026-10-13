import type { Metadata } from "next";
import Navigation from "../components/navigation";
import Link from "next/link";
import { BrandMark } from "../components/ui";
import { AuthProvider } from "../components/auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "PeerScreen · Video, shared",
  description:
    "Independent video, shared. Watch, explore, and make a space of your own.",
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
        <AuthProvider>
          <Navigation />
          {children}
        </AuthProvider>
        <footer className="site-footer">
          <div className="footer-inner">
            <span className="footer-brand">
              <BrandMark />
              PeerScreen
            </span>
            <span className="footer-tagline">Video, shared.</span>
            <nav aria-label="Footer navigation">
              <Link href="/">Explore</Link>
              <Link href="/account">Your workspace</Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
