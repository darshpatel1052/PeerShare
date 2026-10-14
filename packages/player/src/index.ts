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
  mediaId: string;
  acceptedVersionId: string;
  peerSharing: boolean;
  authenticatedPreview?: boolean;
  stunUrls?: string[];
  signal: AbortSignal;
  onStats: (stats: PlayerStats) => void;
  onReady: (
    qualities: number[],
    peerSupported: boolean,
    mode: "verified_hls" | "native_hls",
  ) => void;
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
    AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]),
    options.authenticatedPreview ? "same-origin" : "omit",
  );
  if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (!Hls.isSupported()) {
    if (!options.video.canPlayType("application/vnd.apple.mpegurl"))
      throw new Error("This browser cannot play HLS video");
    options.video.src = options.manifestUrl;
    options.onReady([], false, "native_hls");
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
  const peerSupported =
    typeof RTCPeerConnection !== "undefined" && window.isSecureContext;
  if (options.peerSharing && !peerSupported)
    throw new Error("Peer sharing is unavailable in this browser");
  const hlsConfig = {
    startLevel: 0,
    loader: verifiedHttpLoader(validate, (bytes) => {
      stats.httpBytes += bytes;
      options.onStats({ ...stats });
    }),
  };
  let hls: Hls;
  if (options.peerSharing) {
    // Import and instantiate peer networking only after explicit opt-in.
    const { HlsJsP2PEngine } = await import("p2p-media-loader-hlsjs");
    if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const HlsWithP2P = HlsJsP2PEngine.injectMixin(Hls);
    const assisted = new HlsWithP2P({
      ...hlsConfig,
      p2p: {
        core: {
          swarmId: `peerscreen:${options.mediaId}:${options.acceptedVersionId}:${descriptor.mediaVersion}`,
          announceTrackers: [options.trackerUrl],
          rtcConfig: {
            iceServers: (options.stunUrls ?? []).map((urls) => ({ urls })),
          },
          isP2PDisabled: false,
          isP2PUploadDisabled: false,
          segmentMemoryStorageLimit: 64,
          highDemandTimeWindow: 8,
          httpDownloadTimeWindow: 20,
          p2pDownloadTimeWindow: 60,
          httpDownloadInitialTimeoutMs: 1500,
          p2pMaxPeers: 8,
          webRtcOffersCount: 4,
          webRtcIceGatheringTimeoutMs: options.stunUrls?.length ? 5000 : 1000,
          validateP2PSegment: validate,
          validateHTTPSegment: validate,
        },
      },
    });
    const peers = new Set<string>();
    assisted.p2pEngine.addEventListener(
      "onPeerConnect",
      ({ peerId, infoHash }) => {
        peers.add(`${infoHash}:${peerId}`);
        stats.peerCount = peers.size;
        options.onStats({ ...stats });
      },
    );
    assisted.p2pEngine.addEventListener(
      "onPeerClose",
      ({ peerId, infoHash }) => {
        peers.delete(`${infoHash}:${peerId}`);
        stats.peerCount = peers.size;
        options.onStats({ ...stats });
      },
    );
    assisted.p2pEngine.addEventListener(
      "onSegmentLoaded",
      ({ bytesLength, downloadSource }) => {
        if (downloadSource === "p2p") stats.peerBytes += bytesLength;
        else stats.httpBytes += bytesLength;
        options.onStats({ ...stats });
      },
    );
    assisted.p2pEngine.addEventListener("onChunkUploaded", (bytes) => {
      stats.uploadedBytes += bytes;
      options.onStats({ ...stats });
    });
    hls = assisted;
  } else {
    hls = new Hls(hlsConfig);
  }
  hls.on(Hls.Events.MANIFEST_PARSED, (_, data) =>
    options.onReady(
      data.levels.map((level) => level.height),
      peerSupported,
      "verified_hls",
    ),
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
