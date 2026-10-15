import type { PlayerStats } from "@peershare/player";
import type {
  PlaybackAck,
  PlaybackMetrics,
  PlaybackSession,
  VideoDetail,
} from "./api";

export type MeasurementMode = "verified_hls" | "native_hls";
export type PlaybackCapture = {
  beginConnection: (sharing: boolean) => void;
  finishConnection: () => void;
  updateStats: (stats: PlayerStats) => void;
  ready: (mode: MeasurementMode) => void;
  report: () => unknown;
  destroy: () => void;
};
const zeroStats = () => ({
  httpBytes: 0,
  peerBytes: 0,
  uploadedBytes: 0,
  verifiedSegments: 0,
  rejectedSegments: 0,
});

// One watch session survives player reconnections. Counter bases make the SDK's
// per-connection resets explicit; capabilities stay in this closure, never in
// storage, React state, Kafka events, downloaded reports or account cookies.
export function createPlaybackCapture(
  video: HTMLVideoElement,
  metadata: VideoDetail,
  onStatus: (status: string) => void,
): PlaybackCapture {
  let mode: MeasurementMode | null = null;
  let grant: PlaybackSession | null = null;
  let closed = false,
    disabled = false,
    sending = false,
    live = false;
  let sharing = false,
    connections = 0,
    nextSequence = 1,
    lastAccepted = 0,
    superseded = 0;
  let connectedPeers = 0,
    peakConnectedPeers = 0;
  let base = zeroStats(),
    connection = zeroStats();
  let playedMS = 0,
    rebufferMS = 0,
    rebufferCount = 0;
  let lastTick = performance.now(),
    requestedAt: number | null = null,
    startupMS: number | null = null;
  let hasPlayed = false,
    waiting = false;
  let status = "Waiting for playback";
  type Batch = {
    sequence: number;
    metrics: PlaybackMetrics;
    keepalive: boolean;
  };
  let pending: Batch | null = null;
  let latest: { metrics: PlaybackMetrics; keepalive: boolean } | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const notify = (value: string) => {
    status = value;
    if (!closed) onStatus(value);
  };

  function tick() {
    const now = performance.now();
    const delta = Math.max(0, Math.min(1000, now - lastTick));
    lastTick = now;
    if (!live || !hasPlayed || video.paused || video.ended || video.seeking)
      return;
    if (waiting) rebufferMS += delta;
    else if (video.readyState >= 3) playedMS += delta;
  }
  function snapshot(): PlaybackMetrics {
    tick();
    const payload =
      mode === "native_hls"
        ? zeroStats()
        : {
            httpBytes: base.httpBytes + connection.httpBytes,
            peerBytes: base.peerBytes + connection.peerBytes,
            uploadedBytes: base.uploadedBytes + connection.uploadedBytes,
            verifiedSegments:
              base.verifiedSegments + connection.verifiedSegments,
            rejectedSegments:
              base.rejectedSegments + connection.rejectedSegments,
          };
    return {
      played_ms: Math.floor(playedMS),
      http_bytes: payload.httpBytes,
      peer_bytes: payload.peerBytes,
      uploaded_bytes: payload.uploadedBytes,
      verified_segments: payload.verifiedSegments,
      rejected_segments: payload.rejectedSegments,
      rebuffer_ms: Math.floor(rebufferMS),
      rebuffer_count: rebufferCount,
      quality: metadata.qualities.includes(video.videoHeight)
        ? video.videoHeight
        : 0,
      peer_sharing: mode === "native_hls" ? false : sharing,
      startup_ms: startupMS !== null && startupMS <= 120000 ? startupMS : null,
    };
  }
  async function send(batch: Batch) {
    if (!grant) throw new Error("No playback capability");
    return fetch("/api/v1/playback/telemetry", {
      method: "POST",
      credentials: "omit",
      keepalive: batch.keepalive,
      headers: {
        "Content-Type": "application/json",
        "Playback-Token": grant.token,
      },
      body: JSON.stringify({
        session_id: grant.session_id,
        sequence: batch.sequence,
        metrics: batch.metrics,
      }),
      signal: AbortSignal.timeout(5000),
    });
  }
  function acknowledge(value: PlaybackAck) {
    lastAccepted = Math.max(lastAccepted, value.last_sequence);
    nextSequence = Math.max(nextSequence, lastAccepted + 1);
  }
  async function pump() {
    if (closed || disabled || sending || !grant) return;
    if (!pending && latest) {
      pending = { sequence: nextSequence++, ...latest };
      latest = null;
    }
    if (!pending) return;
    if (pending.sequence > 720) {
      disabled = true;
      notify("Playback reporting finished");
      return;
    }
    const batch = pending;
    sending = true;
    let retry = false;
    try {
      const response = await send(batch);
      if (response.ok) {
        acknowledge((await response.json()) as PlaybackAck);
        if (pending === batch) pending = null;
        notify("Playback reports up to date");
      } else if (response.status === 409 && batch.sequence <= superseded) {
        if (pending === batch) pending = null;
      } else if ([400, 403, 404, 409, 422].includes(response.status)) {
        disabled = true;
        notify("Playback reports unavailable");
      } else {
        retry = true;
        notify("Playback report pending");
      }
    } catch {
      retry = true;
      notify("Playback report pending");
    } finally {
      sending = false;
      if (retry && !closed && !disabled)
        retryTimer = setTimeout(() => void pump(), 10000);
      else if (!closed && !disabled) void pump();
    }
  }
  function queue(keepalive = false) {
    if (disabled) return;
    latest = { metrics: snapshot(), keepalive };
    void pump();
  }
  // Final keepalive may overtake a pending request. A higher sequence with full
  // cumulative counters remains correct; an unseen older request can conflict.
  function finalReport() {
    if (!grant || disabled || nextSequence > 720) {
      if (!closed) queue(true);
      return;
    }
    const batch = {
      sequence: nextSequence++,
      metrics: snapshot(),
      keepalive: true,
    };
    superseded = batch.sequence;
    latest = null;
    void send(batch)
      .then(async (response) => {
        if (response.ok) acknowledge((await response.json()) as PlaybackAck);
      })
      .catch(() => {});
  }
  const onPlay = () => {
    requestedAt ??= performance.now();
  };
  const onPlaying = () => {
    tick();
    if (!hasPlayed && requestedAt !== null)
      startupMS = Math.max(0, Math.floor(performance.now() - requestedAt));
    hasPlayed = true;
    waiting = false;
    queue();
  };
  const onWaiting = () => {
    tick();
    if (hasPlayed && !video.paused && !video.seeking && !waiting) {
      waiting = true;
      rebufferCount++;
    }
  };
  const onPause = () => {
    tick();
    waiting = false;
    queue();
  };
  const onSeeking = () => {
    tick();
    waiting = false;
  };
  const onPageHide = () => finalReport();
  const onPageShow = () => {
    lastTick = performance.now();
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") finalReport();
  };
  const events: [string, EventListener][] = [
    ["play", onPlay],
    ["playing", onPlaying],
    ["waiting", onWaiting],
    ["pause", onPause],
    ["ended", onPause],
    ["seeking", onSeeking],
  ];
  for (const [name, listener] of events) video.addEventListener(name, listener);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("visibilitychange", onVisibility);
  const tickTimer = setInterval(tick, 200);
  const reportTimer = setInterval(() => {
    if (live) queue();
  }, 10000);

  return {
    beginConnection(value) {
      live = true;
      sharing = value;
      connections++;
      connection = zeroStats();
      connectedPeers = 0;
      lastTick = performance.now();
    },
    finishConnection() {
      tick();
      if (live) {
        base = {
          httpBytes: base.httpBytes + connection.httpBytes,
          peerBytes: base.peerBytes + connection.peerBytes,
          uploadedBytes: base.uploadedBytes + connection.uploadedBytes,
          verifiedSegments: base.verifiedSegments + connection.verifiedSegments,
          rejectedSegments: base.rejectedSegments + connection.rejectedSegments,
        };
        connection = zeroStats();
        live = false;
        waiting = false;
        queue();
      }
    },
    updateStats(stats) {
      connectedPeers = stats.peerCount;
      peakConnectedPeers = Math.max(peakConnectedPeers, stats.peerCount);
      if (live)
        connection = {
          httpBytes: Math.max(connection.httpBytes, stats.httpBytes),
          peerBytes: Math.max(connection.peerBytes, stats.peerBytes),
          uploadedBytes: Math.max(
            connection.uploadedBytes,
            stats.uploadedBytes,
          ),
          verifiedSegments: Math.max(
            connection.verifiedSegments,
            stats.verifiedSegments,
          ),
          rejectedSegments: Math.max(
            connection.rejectedSegments,
            stats.rejectedSegments,
          ),
        };
    },
    ready(value) {
      if (mode) return;
      mode = value;
      notify("Starting playback reports");
      void fetch("/api/v1/playback/sessions", {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_id: metadata.id,
          generation_id: metadata.accepted_generation_id,
          attempt_id: metadata.accepted_attempt_id,
          measurement_mode: mode,
        }),
        signal: AbortSignal.timeout(5000),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Playback reports unavailable");
          grant = (await response.json()) as PlaybackSession;
          if (!closed) queue();
          else finalReport();
        })
        .catch(() => {
          disabled = true;
          notify("Playback reports unavailable");
        });
    },
    report() {
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        scope: "this watch session; browser-reported completed media payload",
        video: {
          id: metadata.id,
          title: metadata.title,
          generation: metadata.accepted_generation_id,
          attempt: metadata.accepted_attempt_id,
          durationSeconds: metadata.duration_seconds,
        },
        browser: navigator.userAgent,
        secureContext: window.isSecureContext,
        measurementMode: mode,
        playerConnections: connections,
        connectedPeers,
        peakConnectedPeers,
        metrics: snapshot(),
        reporting: { status, lastAcceptedSequence: lastAccepted },
      };
    },
    destroy() {
      if (closed) return;
      finalReport();
      closed = true;
      clearInterval(tickTimer);
      clearInterval(reportTimer);
      if (retryTimer) clearTimeout(retryTimer);
      for (const [name, listener] of events)
        video.removeEventListener(name, listener);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
