"use client";
import Link from "next/link";
import { type PlaylistDetail } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { Icon } from "./ui";
export default function PlaylistQueue({
  playlistID,
  videoID,
}: {
  playlistID: string;
  videoID: string;
}) {
  const { state, retry } = useResource<PlaylistDetail>(
    `/playlists/${playlistID}`,
  );
  if (state.status === "error")
    return (
      <section className="playlist-queue">
        <p className="muted">This playlist is unavailable.</p>
        <button className="text-button" onClick={retry}>
          Retry playlist
        </button>
      </section>
    );
  if (state.status !== "ready") return null;
  const videos = state.value.items.flatMap((item) =>
    item.video ? [item.video] : [],
  );
  return (
    <section className="playlist-queue">
      <div className="section-heading">
        <Link href={`/playlist?id=${playlistID}`}>
          <Icon name="list" />
          {state.value.playlist.title}
        </Link>
        <span className="muted">{videos.length} videos</span>
      </div>
      <nav aria-label="Playlist videos">
        {videos.map((video, index) => (
          <Link
            key={video.id}
            href={`/watch?v=${video.id}&playlist=${playlistID}&autoplay=1`}
            aria-current={video.id === videoID ? "page" : undefined}
          >
            <span>
              {video.id === videoID ? <Icon name="play" /> : index + 1}
            </span>
            <img src={video.thumbnail_url} alt="" />
            <strong>{video.title}</strong>
          </Link>
        ))}
      </nav>
    </section>
  );
}
