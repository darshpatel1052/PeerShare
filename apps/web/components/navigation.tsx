"use client";
import Link from "next/link";
import { useAuth } from "./auth-provider";
export default function Navigation() {
  const { me } = useAuth();
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="PeerScreen home">
        <span className="brand-icon">▶</span> PeerScreen
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/">Explore</Link>
        <Link href="/channel?id=peerscreen-lab">The lab</Link>
      </nav>
      <div className="account-nav">
        <span className="phase-badge">LOCAL PREVIEW</span>
        <Link href="/account" className="account-link">
          {me ? "Your account" : "Sign in"}
        </Link>
      </div>
    </header>
  );
}
