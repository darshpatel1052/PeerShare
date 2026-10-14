import { Suspense } from "react";
import Analytics from "../../components/analytics";
export default function AnalyticsPage() {
  return (
    <Suspense fallback={<main id="main">Loading analytics…</main>}>
      <Analytics />
    </Suspense>
  );
}
