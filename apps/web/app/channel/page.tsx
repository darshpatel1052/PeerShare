import { Suspense } from "react";
import Channel from "../../components/channel";

export default function ChannelPage() {
  return (
    <Suspense fallback={<main id="main">Loading channel…</main>}>
      <Channel />
    </Suspense>
  );
}
