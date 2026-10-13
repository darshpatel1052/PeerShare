"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { resourceID, type Channel } from "../lib/api";
import { useResource } from "../lib/use-resource";
import VideoList from "./video-list";
export default function ChannelPage() {
  const id = resourceID(useSearchParams().get("id"), "channel");
  const { state, retry } = useResource<Channel>(id ? `/channels/${id}` : null);
  if (!id || (state.status === "error" && state.error.status === 404))
    return (
      <main id="main">
        <h1>Channel not found</h1>
        <Link href="/">Back to explore</Link>
      </main>
    );
  if (state.status === "loading")
    return (
      <main id="main">
        <p role="status">Loading channel…</p>
      </main>
    );
  if (state.status === "error")
    return (
      <main id="main">
        <h1>Channel unavailable</h1>
        <div role="alert" className="error">
          <p>{state.error.message}</p>
          <button onClick={retry}>Retry channel</button>
        </div>
      </main>
    );
  const channel = state.value;
  return (
    <main id="main">
      <span className="eyebrow">@{channel.handle}</span>
      <h1>{channel.title}</h1>
      <p className="muted">
        {channel.description ||
          `A video space by ${channel.owner_display_name}.`}
      </p>
      <div className="section-title">
        <h2>Videos</h2>
      </div>
      <VideoList key={id} channelID={id} />
    </main>
  );
}
