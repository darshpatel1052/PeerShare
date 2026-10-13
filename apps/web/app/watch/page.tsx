import { Suspense } from "react";
import Watch from "../../components/watch";

export default function WatchPage() {
  return (
    <Suspense fallback={<main id="main">Loading video…</main>}>
      <Watch />
    </Suspense>
  );
}
