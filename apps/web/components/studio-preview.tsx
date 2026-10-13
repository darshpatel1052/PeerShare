"use client";

import { useEffect, useRef, useState } from "react";
import { createPlayer } from "@peerscreen/player";
import { api, type VideoPreview } from "../lib/api";
import VideoPlayer from "./video-player";

export default function StudioPreview({ videoID }: { videoID: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState("Loading preview…");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setStatus("Loading preview…");
    setReady(false);
    let destroy: (() => void) | undefined;
    const load = async () => {
      const detail = await api<VideoPreview>(`/videos/${videoID}/preview`, {
        signal: controller.signal,
      });
      if (!video.current || controller.signal.aborted) return;
      video.current.poster = detail.thumbnail_url;
      const handle = await createPlayer({
        video: video.current,
        manifestUrl: detail.playback.manifest_url,
        integrityUrl: detail.playback.integrity_url,
        trackerUrl: detail.playback.tracker_url,
        mediaId: detail.id,
        acceptedVersionId: `${detail.accepted_generation_id}:${detail.accepted_attempt_id}`,
        peerSharing: false,
        authenticatedPreview: true,
        signal: controller.signal,
        onReady: () => {
          if (!controller.signal.aborted) {
            setStatus("Preview ready");
            setReady(true);
          }
        },
        onError: (message) => {
          if (!controller.signal.aborted) setError(message);
        },
        onStats: () => {},
      });
      if (controller.signal.aborted) handle.destroy();
      else destroy = () => handle.destroy();
    };
    void load().catch((cause) => {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "Preview unavailable.",
        );
    });
    return () => {
      controller.abort();
      destroy?.();
    };
  }, [videoID, retry]);
  return (
    <div className="studio-preview">
      <VideoPlayer
        videoRef={video}
        title="Private video preview"
        ready={ready}
      />
      <p role={error ? "alert" : "status"}>{error || status}</p>
      {error && (
        <button
          className="secondary-button"
          onClick={() => setRetry((value) => value + 1)}
        >
          Retry preview
        </button>
      )}
    </div>
  );
}
