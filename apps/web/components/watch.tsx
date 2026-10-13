"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { resourceID, type VideoDetail } from "../lib/api";
import { useResource } from "../lib/use-resource";
import {
  createPlayer,
  emptyStats,
  type PlayerHandle,
} from "@peerscreen/player";

export default function Watch() {
  const id = resourceID(useSearchParams().get("v"), "video");
  const resource = useResource<VideoDetail>(id ? `/videos/${id}` : null);
  const metadata =
    resource.state.status === "ready" ? resource.state.value : undefined;
  const activeID = useRef("");
  const video = useRef<HTMLVideoElement>(null);
  const handle = useRef<PlayerHandle | null>(null);
  const resume = useRef({ time: 0, playing: false });
  const [sharing, setSharing] = useState(false);
  const [stats, setStats] = useState(emptyStats);
  const [qualities, setQualities] = useState<number[]>([]);
  const [quality, setQuality] = useState(0);
  const [ready, setReady] = useState(false);
  const [peerSupported, setPeerSupported] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!metadata || !video.current) return;
    if (activeID.current !== metadata.id) {
      activeID.current = metadata.id;
      resume.current = { time: 0, playing: false };
      setSharing(false);
    }
    const controller = new AbortController();
    const element = video.current;
    const resumeAt = resume.current.time;
    const wasPlaying = resume.current.playing;
    setReady(false);
    setError("");
    setStats(emptyStats());
    setQuality(0);
    createPlayer({
      video: element,
      manifestUrl: metadata.playback.manifest_url,
      integrityUrl: metadata.playback.integrity_url,
      trackerUrl: metadata.playback.tracker_url,
      mediaId: metadata.id,
      acceptedVersionId: `${metadata.accepted_generation_id}:${metadata.accepted_attempt_id}`,
      peerSharing: sharing,
      signal: controller.signal,
      onStats: (value) => {
        if (!controller.signal.aborted) setStats(value);
      },
      onReady: (heights, supportsPeer) => {
        if (controller.signal.aborted) return;
        setQualities(heights);
        setReady(true);
        setPeerSupported(supportsPeer);
        element.currentTime = resumeAt;
        if (wasPlaying) void element.play().catch(() => {});
      },
      onError: (message) => {
        if (!controller.signal.aborted) setError(message);
      },
    })
      .then((player) => {
        if (controller.signal.aborted) player.destroy();
        else handle.current = player;
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Video could not be loaded",
          );
      });
    return () => {
      resume.current = {
        time: Number.isFinite(element.currentTime) ? element.currentTime : 0,
        playing: !element.paused,
      };
      controller.abort();
      handle.current?.destroy();
      handle.current = null;
    };
  }, [metadata, sharing, retry]);

  if (
    !id ||
    (resource.state.status === "error" && resource.state.error.status === 404)
  )
    return (
      <main id="main">
        <h1>Video not found</h1>
        <p className="muted">This video is unavailable in the local preview.</p>
        <Link className="button" href="/">
          Back to explore
        </Link>
      </main>
    );
  if (resource.state.status === "loading")
    return (
      <main id="main">
        <p role="status">Loading video…</p>
      </main>
    );
  if (resource.state.status === "error")
    return (
      <main id="main">
        <h1>Video unavailable</h1>
        <div className="error" role="alert">
          <p>{resource.state.error.message}</p>
          <button onClick={resource.retry}>Retry video</button>
        </div>
      </main>
    );
  const item = resource.state.value;
  return (
    <main id="main">
      <div className="watch-layout">
        <section>
          <div className="player-frame">
            <video
              ref={video}
              controls
              playsInline
              preload="metadata"
              poster={item.thumbnail_url}
              aria-label={`${item.title} video player`}
            />
          </div>
          <div className="controls">
            <span role="status" data-testid="player-status" className="muted">
              {ready ? "Ready to play" : "Preparing video…"}
            </span>
            <label>
              Quality{" "}
              <select
                aria-label="Video quality"
                value={quality}
                onChange={(event) => {
                  const height = Number(event.target.value);
                  setQuality(height);
                  handle.current?.setQuality(height);
                }}
              >
                <option value={0}>Auto</option>
                {qualities.map((height) => (
                  <option key={height} value={height}>
                    {height}p
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && (
            <div role="alert" className="error" data-testid="playback-error">
              <p>{error}</p>
              <button onClick={() => setRetry((value) => value + 1)}>
                Retry playback
              </button>
            </div>
          )}
          <h1 className="watch-title">{item.title}</h1>
          <Link className="creator" href={`/channel?id=${item.channel_id}`}>
            <span className="avatar">PS</span>
            <span>
              <strong>{item.channel_title}</strong>
              <br />
              <span className="muted">
                {item.source_kind === "fixture" ? "Generated video · " : ""}
                {Math.round(item.duration_seconds / 60)} minute
              </span>
            </span>
          </Link>
          <p className="muted">{item.description}</p>
          <div className="sharing">
            <label>
              <input
                type="checkbox"
                checked={sharing}
                onChange={(event) => setSharing(event.target.checked)}
                disabled={
                  !ready ||
                  !peerSupported ||
                  !item.playback.peer_sharing_available
                }
                aria-describedby="sharing-description"
              />
              Help share this video
            </label>
            <p id="sharing-description">
              Peer sharing uses your upload bandwidth. Connected peers can
              discover your network address. You can turn sharing off at any
              time.
            </p>
          </div>
          <details open>
            <summary>Delivery details</summary>
            <dl className="stats">
              <div className="stat">
                <dt>HTTP media bytes</dt>
                <dd data-testid="http-bytes">{stats.httpBytes}</dd>
              </div>
              <div className="stat">
                <dt>Peer media bytes</dt>
                <dd data-testid="peer-bytes">{stats.peerBytes}</dd>
              </div>
              <div className="stat">
                <dt>Uploaded peer bytes</dt>
                <dd data-testid="uploaded-bytes">{stats.uploadedBytes}</dd>
              </div>
              <div className="stat">
                <dt>Connected peers</dt>
                <dd data-testid="peer-count">{stats.peerCount}</dd>
              </div>
            </dl>
            <p className="muted">
              Completed media payload bytes received since the player last
              connected. These are not network wire bytes or billed delivery.
            </p>
            <p className="muted">
              Verified segments:{" "}
              <span data-testid="verified-segments">
                {stats.verifiedSegments}
              </span>{" "}
              · Rejected segments:{" "}
              <span data-testid="rejected-segments">
                {stats.rejectedSegments}
              </span>
            </p>
          </details>
        </section>
        <aside className="side-panel">
          <span className="eyebrow">About this preview</span>
          <h2>A real delivery test</h2>
          <p className="muted">
            Accounts and channels now use persisted data. This video is a
            generated delivery fixture; uploads and publishing arrive next.
          </p>
          <Link href="/">← Explore the lab</Link>
        </aside>
      </div>
    </main>
  );
}
