import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "PeerScreen · Video, shared",
  description:
    "A video publishing application with opt-in peer-assisted delivery.",
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
        <header className="site-header">
          <Link href="/" className="brand" aria-label="PeerScreen home">
            <span className="brand-icon">▶</span> PeerScreen
          </Link>
          <nav aria-label="Main navigation">
            <Link href="/">Explore</Link>
            <Link href="/channel?id=peerscreen-lab">The lab</Link>
          </nav>
          <span className="phase-badge">LOCAL PREVIEW</span>
        </header>
        {children}
        <footer>
          PeerScreen{" "}
          <span>Video, shared. Built one verified step at a time.</span>
        </footer>
      </body>
    </html>
  );
}
