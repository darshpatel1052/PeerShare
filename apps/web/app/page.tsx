import VideoList from "../components/video-list";

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
        <span className="muted">Published videos</span>
      </div>
      <VideoList />
      <p className="notice">
        Sign in to create your channel. This preview includes a generated test
        video; uploads and publishing arrive in the next phase.
      </p>
    </main>
  );
}
