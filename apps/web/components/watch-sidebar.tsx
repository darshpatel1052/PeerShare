"use client";
import Link from "next/link";
import type { Channel, VideoDetail } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { Avatar, ChannelCover, Icon } from "./ui";

export default function WatchSidebar({ video }: { video: VideoDetail }) {
  const { state } = useResource<Channel>(`/channels/${video.channel_id}`);
  return (
    <aside className="watch-sidebar">
      <section className="creator-panel">
        <ChannelCover compact />
        <div className="creator-panel-body">
          <span className="eyebrow">The channel</span>
          <Link className="creator" href={`/channel?id=${video.channel_id}`}>
            <Avatar name={video.channel_title} />
            <span>
              <strong>{video.channel_title}</strong>
              <small>@{video.channel_handle}</small>
            </span>
          </Link>
          {video.source_kind !== "fixture" &&
            state.status === "ready" &&
            state.value.description && (
              <p className="muted">{state.value.description}</p>
            )}
          <Link
            className="secondary-button"
            href={`/channel?id=${video.channel_id}`}
          >
            Visit channel
            <Icon name="arrow" />
          </Link>
        </div>
      </section>
      <section className="peer-panel">
        <div className="peer-panel-icon">
          <Icon name="signal" />
        </div>
        <h2>Video, shared.</h2>
        <p className="muted">
          Help another viewer by sharing a little bandwidth while you watch.
        </p>
        <a href="#peer-sharing">
          Choose how you share
          <Icon name="arrow" />
        </a>
      </section>
    </aside>
  );
}
