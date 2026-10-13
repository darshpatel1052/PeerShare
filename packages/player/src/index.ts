import Hls from "hls.js";
import { createSegmentValidator, fetchDescriptor } from "./integrity";
import { verifiedHttpLoader } from "./http-loader";

export type PlayerStats = {
  httpBytes: number;
  peerBytes: number;
  uploadedBytes: number;
  peerCount: number;
  verifiedSegments: number;
  rejectedSegments: number;
};
export const emptyStats = (): PlayerStats => ({
  httpBytes: 0,
  peerBytes: 0,
  uploadedBytes: 0,
  peerCount: 0,
  verifiedSegments: 0,
  rejectedSegments: 0,
});
export type PlayerOptions = {
  video: HTMLVideoElement;
  manifestUrl: string;
  integrityUrl: string;
  trackerUrl: string;
  peerSharing: boolean;
  signal: AbortSignal;
  onStats: (stats: PlayerStats) => void;
  onReady: (qualities: number[]) => void;
  onError: (message: string) => void;
};
export type PlayerHandle = {
  destroy: () => void;
  setQuality: (height: number) => void;
};

export async function createPlayer(
  options: PlayerOptions,
): Promise<PlayerHandle> {
  const descriptor = await fetchDescriptor(
    options.integrityUrl,
    options.signal,
  );
  if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (!Hls.isSupported()) {
    if (!options.video.canPlayType("application/vnd.apple.mpegurl"))
      throw new Error("This browser cannot play HLS video");
    options.video.src = options.manifestUrl;
    options.onReady([]);
    return {
      destroy: () => {
        options.video.removeAttribute("src");
        options.video.load();
      },
      setQuality: () => {},
    };
  }
  const stats = emptyStats();
  const validate = createSegmentValidator(
    descriptor,
    options.integrityUrl,
    (valid) => {
      if (valid) stats.verifiedSegments += 1;
      else stats.rejectedSegments += 1;
      options.onStats({ ...stats });
    },
  );
  const hls = new Hls({
    startLevel: 0,
    loader: verifiedHttpLoader(validate, (bytes) => {
      stats.httpBytes += bytes;
      options.onStats({ ...stats });
    }),
  });
  hls.on(Hls.Events.MANIFEST_PARSED, (_, data) =>
    options.onReady(data.levels.map((level) => level.height)),
  );
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (data.fatal)
      options.onError("Video playback was interrupted. Retry to reconnect.");
  });
  hls.attachMedia(options.video);
  hls.loadSource(options.manifestUrl);
  let destroyed = false;
  return {
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      hls.destroy();
      options.video.removeAttribute("src");
      options.video.load();
    },
    setQuality: (height) => {
      hls.currentLevel =
        height === 0
          ? -1
          : hls.levels.findIndex((level) => level.height === height);
    },
  };
}
