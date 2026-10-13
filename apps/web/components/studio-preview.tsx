"use client";

import { useEffect, useRef, useState } from "react";
import { createPlayer } from "@peerscreen/player";
import { api } from "../lib/api";

export default function StudioPreview({ videoID }: { videoID: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState("Loading preview…");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let destroy: (() => void) | undefined;
    const load = async () => {
      const detail = await api<{
        id: string;
        title: string;
        thumbnail_url: string;
        accepted_generation_id: string;
        accepted_attempt_id: string;
        playback: {
          manifest_url: string;
          integrity_url: string;
          tracker_url: string;
        };
      }>(`/videos/${videoID}/preview`, { signal: controller.signal });
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
        onReady: () => setStatus("Preview ready"),
        onError: setError,
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
  }, [videoID]);
  return (
    <div className="studio-preview">
      <video
        ref={video}
        controls
        playsInline
        preload="metadata"
        aria-label="Private video preview"
      />
      <p role={error ? "alert" : "status"}>{error || status}</p>
    </div>
  );
}
