import Link from "next/link";

export default function Home() {
  return (
    <main id="main">
      <section className="hero">
        <span className="eyebrow">An independent video space</span>
        <h1>
          Good videos.
          <br />
          Better together.
        </h1>
        <p className="muted">
          Watch through a reliable video connection. Choose to share a little
          bandwidth and help other viewers along the way.
        </p>
      </section>
      <div className="section-title">
        <h2>From the lab</h2>
        <span className="muted">1 generated test video</span>
      </div>
      <Link className="video-card" href="/watch?v=signal-garden">
        <div className="poster">
          <img
            src="/media/fixture/thumbnail.jpg"
            alt="Colourful generated video test pattern"
          />
          <span className="duration">1:00</span>
        </div>
        <h3>Signal garden</h3>
        <p className="muted">
          PeerScreen Lab · Generated compatibility fixture
        </p>
      </Link>
      <p className="notice">
        This local preview tests real video playback and peer delivery. Creator
        accounts and publishing are coming in the next phases.
      </p>
    </main>
  );
}
