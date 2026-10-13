"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function Channel() {
  const id = useSearchParams().get("id");
  if (id !== "peerscreen-lab")
    return (
      <main id="main">
        <h1>Channel not found</h1>
        <Link href="/">Back to explore</Link>
      </main>
    );
  return (
    <main id="main">
      <span className="eyebrow">The testing ground</span>
      <h1>PeerScreen Lab</h1>
      <p className="muted">
        Small, generated videos that help us build and verify the delivery
        experience.
      </p>
      <div className="section-title">
        <h2>Videos</h2>
      </div>
      <Link className="video-card" href="/watch?v=signal-garden">
        <div className="poster">
          <img
            src="/media/fixture/thumbnail.jpg"
            alt="Colourful generated test pattern"
          />
          <span className="duration">1:00</span>
        </div>
        <h3>Signal garden</h3>
        <p className="muted">Generated compatibility fixture</p>
      </Link>
    </main>
  );
}
