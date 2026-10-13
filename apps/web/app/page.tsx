import VideoList from "../components/video-list";
export default function Home() {
  return (
    <main id="main" className="explore-page">
      <VideoList featured />
    </main>
  );
}
