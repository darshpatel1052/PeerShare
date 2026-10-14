"use client";
import { useAuth } from "./auth-provider";
import MemberGate from "./member-gate";
import VideoList from "./video-list";
export default function Following() {
  const { me } = useAuth();
  return (
    <main id="main" className="explore-page">
      <MemberGate
        title="Following"
        description="Sign in to see new videos from channels you follow."
      >
        <VideoList key={me?.user.id} following />
      </MemberGate>
    </main>
  );
}
