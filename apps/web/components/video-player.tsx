"use client";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { PlayerIcon } from "./player-icon";

const clock = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};

export default function VideoPlayer({
  videoRef,
  title,
  poster,
  ready,
  qualities = [],
  quality = 0,
  onQuality,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  title: string;
  poster?: string;
  ready: boolean;
  qualities?: number[];
  quality?: number;
  onQuality?: (height: number) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function reveal() {
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setVisible(false);
    }, 3000);
  }
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      setPlaying(!video.paused && !video.ended);
      setTime(video.currentTime);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setVolume(video.volume);
      setMuted(video.muted);
      let bufferedEnd = 0;
      const ranges = video.buffered;
      for (let index = 0; index < ranges.length; index++) {
        if (
          ranges.start(index) <= video.currentTime &&
          ranges.end(index) >= video.currentTime
        ) {
          bufferedEnd = ranges.end(index);
          break;
        }
      }
      setBuffered(bufferedEnd);
    };
    const wait = () => setBuffering(true);
    const progress = () => setBuffering(false);
    const started = () => {
      setError("");
      setBuffering(false);
      sync();
    };
    const events = [
      "play",
      "pause",
      "ended",
      "timeupdate",
      "durationchange",
      "loadedmetadata",
      "volumechange",
      "progress",
    ];
    events.forEach((event) => video.addEventListener(event, sync));
    video.addEventListener("waiting", wait);
    video.addEventListener("playing", started);
    video.addEventListener("canplay", progress);
    const full = () =>
      setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", full);
    sync();
    return () => {
      events.forEach((event) => video.removeEventListener(event, sync));
      video.removeEventListener("waiting", wait);
      video.removeEventListener("playing", started);
      video.removeEventListener("canplay", progress);
      document.removeEventListener("fullscreenchange", full);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [videoRef]);
  async function toggle() {
    const video = videoRef.current;
    if (!video || !ready) return;
    reveal();
    if (video.paused) {
      try {
        await video.play();
        setError("");
      } catch {
        setError("Playback could not start. Try playing again.");
      }
    } else video.pause();
  }
  function seek(value: number) {
    const video = videoRef.current;
    if (!video || !duration) return;
    video.currentTime = Math.max(0, Math.min(duration, value));
    setTime(video.currentTime);
    reveal();
  }
  function mute() {
    const video = videoRef.current;
    if (video) {
      if (video.volume === 0) {
        video.volume = 0.5;
        video.muted = false;
      } else video.muted = !video.muted;
    }
    reveal();
  }
  async function full() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await frame.current?.requestFullscreen();
    } catch {
      setError("Fullscreen is unavailable in this browser.");
    }
    reveal();
  }
  return (
    <div
      ref={frame}
      className={`product-player${visible || !playing ? " controls-visible" : ""}`}
      tabIndex={0}
      role="region"
      aria-label="Video player"
      onPointerMove={reveal}
      onPointerDown={reveal}
      onFocus={reveal}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (
          [
            " ",
            "k",
            "K",
            "ArrowLeft",
            "ArrowRight",
            "m",
            "M",
            "f",
            "F",
          ].includes(e.key)
        ) {
          e.preventDefault();
          if (e.key === " " || e.key.toLowerCase() === "k") void toggle();
          else if (e.key === "ArrowLeft") seek(time - 5);
          else if (e.key === "ArrowRight") seek(time + 5);
          else if (e.key.toLowerCase() === "m") mute();
          else void full();
        }
      }}
    >
      <video
        ref={videoRef}
        playsInline
        preload="metadata"
        poster={poster}
        aria-label={
          title === "Private video preview" ? title : `${title} video player`
        }
        onClick={() => void toggle()}
      />
      {!playing && (
        <button
          className="player-big-play"
          aria-label="Play video"
          disabled={!ready}
          onClick={() => void toggle()}
        >
          <PlayerIcon name="play" />
        </button>
      )}
      {buffering && playing && (
        <span
          className="player-buffering"
          role="status"
          aria-label="Buffering video"
        />
      )}
      <div className="player-controls">
        <input
          className="player-seek"
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(time, duration || 1)}
          aria-label="Seek video"
          aria-valuetext={`${clock(time)} of ${clock(duration)}`}
          disabled={!ready || !duration}
          onChange={(e) => seek(Number(e.target.value))}
          style={
            {
              "--played": `${duration ? (time / duration) * 100 : 0}%`,
              "--buffered": `${duration ? (Math.min(Math.max(time, buffered), duration) / duration) * 100 : 0}%`,
            } as CSSProperties
          }
        />
        <div className="player-control-row">
          <button
            className="player-button player-toggle"
            aria-label={playing ? "Pause" : "Play"}
            disabled={!ready}
            onClick={() => void toggle()}
          >
            <PlayerIcon name={playing ? "pause" : "play"} />
          </button>
          <div className="player-volume">
            <button
              className="player-button"
              aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
              onClick={mute}
            >
              <PlayerIcon
                name={
                  muted || volume === 0
                    ? "muted"
                    : volume < 0.5
                      ? "volume-low"
                      : "volume"
                }
              />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Volume"
              style={
                { "--volume": `${muted ? 0 : volume * 100}%` } as CSSProperties
              }
              onChange={(e) => {
                const video = videoRef.current;
                if (video) {
                  video.volume = Number(e.target.value);
                  video.muted = false;
                }
                reveal();
              }}
            />
          </div>
          <span className="player-time" aria-live="off">
            {clock(time)} <span>/ {clock(duration)}</span>
          </span>
          <span className="player-control-spacer" />
          {onQuality && (
            <div className="player-quality">
              <select
                aria-label="Video quality"
                value={quality}
                onChange={(e) => onQuality(Number(e.target.value))}
              >
                <option value={0}>Auto</option>
                {qualities.map((height) => (
                  <option key={height} value={height}>
                    {height}p
                  </option>
                ))}
              </select>
              <PlayerIcon name="chevron" />
            </div>
          )}
          <button
            className="player-button"
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={() => void full()}
          >
            <PlayerIcon name={fullscreen ? "minimize" : "fullscreen"} />
          </button>
        </div>
      </div>
      {error && (
        <p className="player-action-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
