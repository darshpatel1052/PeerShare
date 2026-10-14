import { Suspense } from "react";
import Playlist from "../../components/playlist";
export default function PlaylistPage() {
  return (
    <Suspense fallback={<main id="main">Loading playlist…</main>}>
      <Playlist />
    </Suspense>
  );
}
