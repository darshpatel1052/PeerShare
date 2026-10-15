"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Avatar, Icon, LoadingState } from "./ui";
import WatchSidebar from "./watch-sidebar";
import VideoPlayer from "./video-player";
import { resourceID, duration, type VideoDetail } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { type PlaylistDetail } from "../lib/api";
import {
  createPlaybackCapture,
  type PlaybackCapture,
} from "../lib/playback-capture";
import SaveVideo from "./save-video";
import PlaylistQueue from "./playlist-queue";
import { useAuth } from "./auth-provider";
import {
  createPlayer,
  emptyStats,
  type PlayerHandle,
} from "@peerscreen/player";

export default function Watch() {
  const params = useSearchParams();
  const router = useRouter();
  const id = resourceID(params.get("v"), "video");
  const playlistID = resourceID(params.get("playlist"), "playlist");
  const autoplay = params.get("autoplay") === "1" && Boolean(playlistID);
  const auth = useAuth();
  const accountScope = auth.loading ? "loading" : (auth.me?.user.id ?? "guest");
  const currentAccount = useRef(accountScope);
  currentAccount.current = accountScope;
  const queue = useResource<PlaylistDetail>(
    playlistID && !auth.loading ? `/playlists/${playlistID}` : null,
    false,
    accountScope,
  );
  const resource = useResource<VideoDetail>(id ? `/videos/${id}` : null);
  const metadata =
    resource.state.status === "ready" ? resource.state.value : undefined;
  const activeID = useRef("");
  const video = useRef<HTMLVideoElement>(null);
  const handle = useRef<PlayerHandle | null>(null);
  const resume = useRef({ time: 0, playing: false });
  const capture = useRef<PlaybackCapture | null>(null);
  const autoplayAttempt = useRef("");
  const [sharing, setSharing] = useState(false);
  const [stats, setStats] = useState(emptyStats);
  const [qualities, setQualities] = useState<number[]>([]);
  const [quality, setQuality] = useState(0);
  const [ready, setReady] = useState(false);
  const [peerSupported, setPeerSupported] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [reporting, setReporting] = useState("Waiting for playback");
  const [mode, setMode] = useState<"verified_hls" | "native_hls">(
    "verified_hls",
  );
  const consentKey = metadata
    ? `peerscreen:sharing:${metadata.id}:${metadata.accepted_generation_id}:${metadata.accepted_attempt_id}`
    : "";
  useEffect(() => {
    if (!metadata || !video.current) return;
    const observer = createPlaybackCapture(
      video.current,
      metadata,
      setReporting,
    );
    capture.current = observer;
    return () => {
      observer.destroy();
      if (capture.current === observer) capture.current = null;
    };
  }, [metadata]);
  useEffect(() => {
    const element = video.current;
    if (!element || !playlistID || queue.state.status !== "ready" || !metadata)
      return;
    const items = queue.state.value.items.flatMap((item) =>
      item.video ? [item.video] : [],
    );
    const index = items.findIndex((item) => item.id === metadata.id);
    const next = index >= 0 ? items[index + 1] : undefined;
    const ended = () => {
      if (
        currentAccount.current === accountScope &&
        next &&
        next.id !== metadata.id
      )
        router.push(`/watch?v=${next.id}&playlist=${playlistID}&autoplay=1`);
    };
    element.addEventListener("ended", ended);
    return () => element.removeEventListener("ended", ended);
  }, [queue.state, metadata, playlistID, router, accountScope]);

  useEffect(() => {
    if (!metadata || !video.current) return;
    if (activeID.current !== consentKey) {
      activeID.current = consentKey;
      resume.current = { time: 0, playing: false };
      let remembered = false;
      try {
        remembered = sessionStorage.getItem(consentKey) === "true";
      } catch {}
      setSharing(remembered);
      if (remembered !== sharing) return;
    }
    const controller = new AbortController();
    const element = video.current;
    const resumeAt = resume.current.time;
    const wasPlaying = resume.current.playing;
    capture.current?.beginConnection(sharing);
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
      stunUrls: metadata.playback.stun_urls ?? [],
      signal: controller.signal,
      onStats: (value) => {
        if (!controller.signal.aborted) {
          setStats(value);
          capture.current?.updateStats(value);
        }
      },
      onReady: (heights, supportsPeer, measurementMode) => {
        if (controller.signal.aborted) return;
        setQualities(heights);
        setReady(true);
        setPeerSupported(supportsPeer);
        setMode(measurementMode);
        capture.current?.ready(measurementMode);
        element.currentTime = resumeAt;
        const startPlaylist =
          autoplay && autoplayAttempt.current !== metadata.id;
        if (startPlaylist) autoplayAttempt.current = metadata.id;
        if (wasPlaying || startPlaylist) void element.play().catch(() => {});
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
      capture.current?.finishConnection();
      handle.current?.destroy();
      handle.current = null;
    };
  }, [metadata, sharing, retry, consentKey, autoplay]);

  if (
    !id ||
    (resource.state.status === "error" && resource.state.error.status === 404)
  )
    return (
      <main id="main">
        <h1>Video not found</h1>
        <p className="muted">This video is no longer available.</p>
        <Link className="button" href="/">
          Back to explore
        </Link>
      </main>
    );
  if (resource.state.status === "loading")
    return (
      <main id="main">
        <LoadingState label="Loading video…" />
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
    <main id="main" className="watch-page">
      <div className="watch-breadcrumb">
        <Link href="/">Explore</Link>
        <span>/</span>
        <Link href={`/channel?id=${item.channel_id}`}>
          {item.channel_title}
        </Link>
      </div>
      <div className="watch-layout">
        <section>
          <VideoPlayer
            videoRef={video}
            title={item.title}
            poster={item.thumbnail_url}
            ready={ready}
            qualities={qualities}
            quality={quality}
            onQuality={(height) => {
              setQuality(height);
              handle.current?.setQuality(height);
            }}
          />
          <div className="controls">
            <span
              role="status"
              data-testid="player-status"
              className="player-status"
            >
              <span className={ready ? "status-dot ready" : "status-dot"} />
              {ready
                ? "Ready to play"
                : error
                  ? "Playback unavailable"
                  : "Preparing video…"}
            </span>
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
          <SaveVideo videoID={item.id} />
          <Link className="creator" href={`/channel?id=${item.channel_id}`}>
            <Avatar name={item.channel_title} />
            <span>
              <strong>{item.channel_title}</strong>
              <br />
              <span className="muted">
                {item.source_kind === "fixture" ? "Test film · " : ""}
                {duration(item.duration_seconds)} runtime
              </span>
            </span>
          </Link>
          <p className="watch-description">{item.description}</p>
          <div className="sharing" id="peer-sharing">
            <label>
              <input
                type="checkbox"
                className="sharing-toggle"
                checked={sharing}
                onChange={(event) => {
                  setSharing(event.target.checked);
                  try {
                    sessionStorage.setItem(
                      consentKey,
                      String(event.target.checked),
                    );
                  } catch {}
                }}
                disabled={
                  !sharing &&
                  (!ready ||
                    !peerSupported ||
                    !item.playback.peer_sharing_available)
                }
                aria-describedby="sharing-description"
              />
              Help share this video
            </label>
            <p id="sharing-description">
              Sharing uses your upload bandwidth. Other viewers and discovery
              services can see your network address. Your choice is remembered
              for this video in this tab. You can turn it off at any time.
            </p>
          </div>
          <details className="delivery-details">
            <summary>
              <Icon name="signal" />
              Connection details
            </summary>
            <dl className="stats">
              <div className="stat">
                <dt>HTTP media bytes</dt>
                <dd data-testid="http-bytes">
                  {mode === "native_hls" ? "Unavailable" : stats.httpBytes}
                </dd>
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
              {mode === "native_hls"
                ? "This browser's native player does not expose verified media payload measurements."
                : "Completed media payload bytes received since the player last connected. These are not network wire bytes or billed delivery."}
            </p>
            <p className="muted" data-testid="reporting-status">
              {reporting}
            </p>
            <button
              className="secondary-button"
              disabled={!ready}
              onClick={() => {
                const report = capture.current?.report();
                if (!report) return;
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(report, null, 2)], {
                    type: "application/json",
                  }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = `peerscreen-${item.id}-playback.json`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 2000);
              }}
            >
              Download playback report
              <Icon name="arrow" />
            </button>
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
        <div className="watch-side-column">
          <WatchSidebar video={item} />
          {playlistID && (
            <PlaylistQueue playlistID={playlistID} videoID={item.id} />
          )}
        </div>
      </div>
    </main>
  );
}
