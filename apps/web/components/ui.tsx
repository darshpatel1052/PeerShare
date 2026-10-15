export type IconName =
  | "upload"
  | "plus"
  | "bookmark"
  | "list"
  | "up"
  | "down"
  | "chart"
  | "trash"
  | "lock"
  | "play"
  | "arrow"
  | "grid"
  | "channel"
  | "sun"
  | "moon"
  | "settings"
  | "share"
  | "check"
  | "film"
  | "logout"
  | "signal"
  | "search"
  | "close"
  | "pause"
  | "volume"
  | "muted"
  | "fullscreen"
  | "minimize"
  | "chevron";
const paths: Record<IconName, React.ReactNode> = {
  upload: (
    <>
      <path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  bookmark: <path d="M6 3h12v18l-6-4-6 4V3Z" />,
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" strokeWidth="3" />
    </>
  ),
  up: <path d="m6 14 6-6 6 6" />,
  down: <path d="m6 10 6 6 6-6" />,
  chart: (
    <>
      <path d="M4 3v17h17M8 15l4-5 4 2 5-7" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3" />
    </>
  ),
  pause: (
    <>
      <path d="M8 5v14M16 5v14" strokeWidth="4" />
    </>
  ),
  volume: (
    <>
      <path d="M11 4 5 9H2v6h3l6 5V4Z" />
      <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
    </>
  ),
  muted: (
    <>
      <path d="M11 4 5 9H2v6h3l6 5V4Z" />
      <path d="m16 9 6 6m-6 0 6-6" />
    </>
  ),
  fullscreen: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" />,
  minimize: <path d="M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  play: <path d="m9 5 11 7-11 7Z" />,
  arrow: (
    <>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  channel: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="3" />
      <path d="M8 21h8m-4-4v4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4a8.5 8.5 0 1 0 11.5 11.5Z" />,
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="15" cy="17" r="3" />
    </>
  ),
  share: (
    <>
      <path d="M12 15V3m-5 5 5-5 5 5M5 13v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4m-9-7 3 2-3 2Z" />
    </>
  ),
  logout: (
    <>
      <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4m4-14 6 6-6 6M9 12h10" />
    </>
  ),
  signal: (
    <>
      <path d="M4 15v5M9 11v9M14 7v13M19 3v17" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
};
export function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function BrandMark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 6h20a5 5 0 0 1 5 5v14H10a5 5 0 0 1-5-5V6Z"
        fill="currentColor"
      />
      <path d="m15 12 9 6-9 6Z" fill="var(--accent-ink)" />
      <path d="M10 30h20V10" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] || "")
    .join("")
    .toUpperCase();
}
export function Avatar({
  name,
  large = false,
}: {
  name: string;
  large?: boolean;
}) {
  return (
    <span
      className={`avatar${large ? " avatar-large" : ""}`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
export function ChannelCover({
  compact = false,
  imageURL = "",
}: {
  compact?: boolean;
  imageURL?: string;
}) {
  return (
    <div
      className={`channel-cover${compact ? " cover-compact" : ""}${imageURL ? " custom-cover" : " default-cover"}`}
      aria-hidden="true"
    >
      {imageURL ? (
        <img src={imageURL} alt="" />
      ) : (
        <>
          <span className="cover-orbit orbit-one" />
          <span className="cover-orbit orbit-two" />
          <span className="cover-orbit orbit-three" />
        </>
      )}
    </div>
  );
}
export function LoadingState({ label }: { label: string }) {
  return (
    <div className="loading-state" role="status">
      <span className="loading-dot" />
      {label}
    </div>
  );
}
