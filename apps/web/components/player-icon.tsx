import type { ReactNode } from "react";

type PlayerIconName =
  | "play"
  | "pause"
  | "volume"
  | "volume-low"
  | "muted"
  | "fullscreen"
  | "minimize"
  | "chevron";

const shapes: Record<PlayerIconName, ReactNode> = {
  // The triangle's visual weight sits near x=12 without an extra CSS offset.
  play: (
    <path
      d="M8 6.7c0-.8.9-1.3 1.6-.9l10 5.3c.8.4.8 1.5 0 1.9l-10 5.3c-.7.4-1.6-.1-1.6-.9V6.7Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  pause: (
    <g fill="currentColor" stroke="none">
      <rect x="6.75" y="5.5" width="3.5" height="13" rx="1" />
      <rect x="13.75" y="5.5" width="3.5" height="13" rx="1" />
    </g>
  ),
  volume: (
    <>
      <path d="M10.75 5.25 6 9H3.5v6H6l4.75 3.75V5.25Z" />
      <path d="M14.5 8.5a5 5 0 0 1 0 7m3-10a9.25 9.25 0 0 1 0 13" />
    </>
  ),
  "volume-low": (
    <>
      <path d="M10.75 5.25 6 9H3.5v6H6l4.75 3.75V5.25Z" />
      <path d="M14.5 8.5a5 5 0 0 1 0 7" />
    </>
  ),
  muted: (
    <>
      <path d="M10.75 5.25 6 9H3.5v6H6l4.75 3.75V5.25Z" />
      <path d="m16 9 5 6m-5 0 5-6" />
    </>
  ),
  fullscreen: <path d="M8 4.5H4.5V8m11-3.5H19.5V8M4.5 16v3.5H8m8 0h3.5V16" />,
  minimize: <path d="M4.5 8H8V4.5m8 0V8h3.5M8 19.5V16H4.5m15 0H16v3.5" />,
  chevron: <path d="m8 10 4 4 4-4" />,
};

export function PlayerIcon({ name }: { name: PlayerIconName }) {
  return (
    <svg
      className={`player-icon player-icon-${name}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shapes[name]}
    </svg>
  );
}
