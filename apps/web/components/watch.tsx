"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  createPlayer,
  emptyStats,
  type PlayerHandle,
} from "@peerscreen/player";

export default function Watch() {
  const id = useSearchParams().get("v");
  const video = useRef<HTMLVideoElement>(null);
  const handle = useRef<PlayerHandle | null>(null);
  const [sharing, setSharing] = useState(false);
  const [stats, setStats] = useState(emptyStats);
  const [qualities, setQualities] = useState<number[]>([]);
  const [quality, setQuality] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (id !== "signal-garden" || !video.current) return;
    const controller = new AbortController();
    const element = video.current;
    const resumeAt = Number.isFinite(element.currentTime)
      ? element.currentTime
      : 0;
    const wasPlaying = !element.paused;
    setReady(false);
    setError("");
    setStats(emptyStats());
    setQuality(0);
    const mediaBase =
      process.env.NEXT_PUBLIC_MEDIA_BASE_URL ||
      `${window.location.origin}/media/fixture/`;
    const trackerUrl =
      process.env.NEXT_PUBLIC_TRACKER_URL ||
      `ws://${window.location.hostname}:8000`;
    createPlayer({
      video: element,
      manifestUrl: new URL("master.m3u8", mediaBase).href,
      integrityUrl: new URL("integrity.json", mediaBase).href,
      trackerUrl,
      peerSharing: sharing,
      signal: controller.signal,
      onStats: (value) => {
        if (!controller.signal.aborted) setStats(value);
      },
      onReady: (heights) => {
        if (controller.signal.aborted) return;
        setQualities(heights);
        setReady(true);
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
      controller.abort();
      handle.current?.destroy();
      handle.current = null;
    };
  }, [id, sharing, retry]);

  if (id !== "signal-garden")
    return (
      <main id="main">
        <h1>Video not found</h1>
        <p className="muted">This video is unavailable in the local preview.</p>
        <Link className="button" href="/">
          Back to explore
        </Link>
      </main>
    );
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
              poster="/media/fixture/thumbnail.jpg"
              aria-label="Signal garden video player"
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
          <h1 className="watch-title">Signal garden</h1>
          <Link className="creator" href="/channel?id=peerscreen-lab">
            <span className="avatar">PS</span>
            <span>
              <strong>PeerScreen Lab</strong>
              <br />
              <span className="muted">Generated video · 1 minute</span>
            </span>
          </Link>
          <p className="muted">
            A moving test pattern and a quiet tone, generated to check video
            quality, seeking, and delivery. Every frame and audio sample is
            generated locally.
          </p>
          <div className="sharing">
            <label>
              <input
                type="checkbox"
                checked={sharing}
                onChange={(event) => setSharing(event.target.checked)}
                disabled
                aria-describedby="sharing-description"
              />
              Help share this video
            </label>
            <p id="sharing-description">
              Peer sharing uses your upload bandwidth. Connected peers can
              discover your network address. The compatibility integration is
              being verified.
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
            This is the first implementation phase. Video playback is real;
            accounts, uploads, and publishing arrive in later phases.
          </p>
          <Link href="/">← Explore the lab</Link>
        </aside>
      </div>
    </main>
  );
}
