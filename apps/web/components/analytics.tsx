"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { type CreatorAnalytics, resourceID } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { useAuth } from "./auth-provider";
import MemberGate from "./member-gate";
import { Icon, LoadingState } from "./ui";
export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let number = value / 1024;
  let index = 0;
  while (number >= 1024 && index < units.length - 1) {
    number /= 1024;
    index++;
  }
  return `${number.toFixed(number < 10 ? 1 : 0)} ${units[index]}`;
}
function watchTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
export default function Analytics() {
  const { me } = useAuth();
  const videoID = resourceID(useSearchParams().get("v"), "video");
  return (
    <main id="main" className="analytics-page">
      <MemberGate
        title="Creator analytics"
        description="Sign in to see how viewers watch your videos."
      >
        {me?.channel ? (
          <AnalyticsContents
            key={`${me.user.id}:${videoID ?? "channel"}`}
            channelID={me.channel.id}
            videoID={videoID}
          />
        ) : (
          <div className="page-state">
            <Icon name="chart" />
            <h1>Creator analytics</h1>
            <p className="muted">
              Create your channel to start publishing videos.
            </p>
            <Link className="button" href="/account">
              Create a channel
              <Icon name="arrow" />
            </Link>
          </div>
        )}
      </MemberGate>
    </main>
  );
}
function AnalyticsContents({
  channelID,
  videoID,
}: {
  channelID: string;
  videoID: string | null;
}) {
  const resource = useResource<CreatorAnalytics>(
    videoID
      ? `/videos/${videoID}/analytics`
      : `/channels/${channelID}/analytics`,
  );
  const totals =
    resource.state.status === "ready" ? resource.state.value.totals : null;
  const share = totals?.peer_delivery_share;
  return (
    <>
      <div className="explore-heading">
        <div>
          <span className="eyebrow">Your channel</span>
          <h1>
            Analytics<span className="accent-dot">.</span>
          </h1>
          <p className="muted">
            {videoID ? "This video" : "Your videos"} · Last 30 days
          </p>
        </div>
        <div className="analytics-heading-actions">
          {videoID && (
            <Link className="secondary-button" href="/analytics">
              All videos
            </Link>
          )}
          <button className="secondary-button" onClick={resource.retry}>
            <Icon name="chart" />
            Refresh
          </button>
        </div>
      </div>
      {resource.state.status === "loading" && (
        <LoadingState label="Loading analytics…" />
      )}
      {resource.state.status === "error" && (
        <div className="error" role="alert">
          <p>{resource.state.error.message}</p>
          <button onClick={resource.retry}>Retry analytics</button>
        </div>
      )}
      {totals && (
        <>
          <div className="analytics-metrics">
            <article>
              <span>Qualified plays</span>
              <strong data-testid="analytics-qualified-plays">
                {totals.qualified_plays.toLocaleString()}
              </strong>
              <small>30 seconds, or half a shorter video</small>
            </article>
            <article>
              <span>Watch time</span>
              <strong>{watchTime(totals.played_ms)}</strong>
              <small>Time spent actively playing</small>
            </article>
            <article>
              <span>Video delivered</span>
              <strong>
                {formatBytes(totals.http_bytes + totals.peer_bytes)}
              </strong>
              <small>Reported completed media payload</small>
            </article>
            <article>
              <span>Average startup</span>
              <strong>
                {totals.startup_average_ms === null
                  ? "—"
                  : `${(totals.startup_average_ms / 1000).toFixed(2)}s`}
              </strong>
              <small>From play request to playback</small>
            </article>
          </div>
          <div className="analytics-delivery">
            <section className="delivery-breakdown">
              <div>
                <span className="eyebrow">Video delivery</span>
                <h2>How viewers received your video</h2>
                <p className="muted">
                  Peer sharing helps viewers receive video from each other while
                  HTTP remains available.
                </p>
                <div className="delivery-legend">
                  <div>
                    <span className="legend-marker http" />
                    <span>HTTP</span>
                    <strong
                      data-testid="analytics-http-bytes"
                      data-bytes={totals.http_bytes}
                    >
                      {formatBytes(totals.http_bytes)}
                    </strong>
                  </div>
                  <div>
                    <span className="legend-marker peer" />
                    <span>Peers</span>
                    <strong
                      data-testid="analytics-peer-bytes"
                      data-bytes={totals.peer_bytes}
                    >
                      {formatBytes(totals.peer_bytes)}
                    </strong>
                  </div>
                </div>
              </div>
              <div
                className="delivery-ring"
                style={{
                  background: `conic-gradient(var(--accent) ${(share ?? 0) * 100}%, var(--raised) 0)`,
                }}
              >
                <div>
                  <strong>
                    {share === null || share === undefined
                      ? "—"
                      : `${(share * 100).toFixed(1)}%`}
                  </strong>
                  <span>Peer share</span>
                </div>
              </div>
            </section>
            <section className="playback-summary">
              <h2>Playback</h2>
              <dl>
                <div>
                  <dt>Reported sessions</dt>
                  <dd>{totals.sessions.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Rebuffer events</dt>
                  <dd>{totals.rebuffer_count.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Rebuffer time</dt>
                  <dd>{watchTime(totals.rebuffer_ms)}</dd>
                </div>
                <div>
                  <dt>Peer uploads</dt>
                  <dd>{formatBytes(totals.uploaded_bytes)}</dd>
                </div>
              </dl>
            </section>
          </div>
          {!totals.sessions && (
            <div className="analytics-empty">
              <Icon name="play" />
              <h2>No playback reports yet</h2>
              <p className="muted">
                Publish a video and share its watch link. Playback reports will
                appear here as viewers watch.
              </p>
              <Link className="secondary-button" href="/studio">
                Open Studio
                <Icon name="arrow" />
              </Link>
            </div>
          )}
          {resource.state.status === "ready" &&
            resource.state.value.videos.length > 0 && (
              <section className="analytics-video-section">
                <div className="section-heading">
                  <h2>
                    {videoID
                      ? "Video performance"
                      : "Video performance · latest 200"}
                  </h2>
                  <span className="muted">Browser-reported</span>
                </div>
                <div className="analytics-table-scroll">
                  <table className="analytics-table">
                    <thead>
                      <tr>
                        <th>Video</th>
                        <th>Qualified plays</th>
                        <th>Watch time</th>
                        <th>HTTP payload</th>
                        <th>Peer payload</th>
                        <th>Peer share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resource.state.value.videos.map((video) => (
                        <tr key={video.video_id}>
                          <td>
                            <Link href={`/analytics?v=${video.video_id}`}>
                              {video.title}
                            </Link>
                          </td>
                          <td>{video.totals.qualified_plays}</td>
                          <td>{watchTime(video.totals.played_ms)}</td>
                          <td>{formatBytes(video.totals.http_bytes)}</td>
                          <td>{formatBytes(video.totals.peer_bytes)}</td>
                          <td>
                            {video.totals.peer_delivery_share === null
                              ? "—"
                              : `${(video.totals.peer_delivery_share * 100).toFixed(1)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          <details className="analytics-method">
            <summary>About these measurements</summary>
            <p>
              Reports come from the player and are best-effort observations. A
              qualified play is one watch session reaching 30 seconds, or half a
              shorter video with a one-second minimum. These are not unique
              viewers. Sharing changes keep the same watch session; refreshing
              the page starts another.
            </p>
            <p>
              HTTP and peer totals count completed verified media payload. They
              exclude protocol overhead and are not billed delivery or proven
              cost savings. Peer upload bytes are separate and do not enter the
              peer-share percentage. Native HLS sessions report play time but
              cannot attribute payload; {totals.native_sessions} such sessions
              are included. Missing startup measurements and empty payload
              ratios appear as a dash.
            </p>
            <p>
              Channel totals cover all nondeleted videos, including unpublished
              ones. The detail table shows up to 200 recent videos. Reports are
              retained for 30 days.
            </p>
          </details>
        </>
      )}
    </>
  );
}
