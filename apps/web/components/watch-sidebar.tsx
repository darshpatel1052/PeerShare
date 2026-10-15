"use client";
import Link from "next/link";
import type { Channel, VideoDetail, VideosPage } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { Avatar, ChannelCover, Icon } from "./ui";
import { duration } from "../lib/api";
import FollowButton from "./follow-button";
import { useAuth } from "./auth-provider";

export default function WatchSidebar({ video }: { video: VideoDetail }) {
  const { me } = useAuth();
  const { state } = useResource<Channel>(`/channels/${video.channel_id}`);
  const related = useResource<VideosPage>(
    `/videos?channel_id=${video.channel_id}&limit=5`,
  );
  const next =
    related.state.status === "ready"
      ? related.state.value.items
          .filter((item) => item.id !== video.id)
          .slice(0, 4)
      : [];
  return (
    <aside className="watch-sidebar">
      <section className="creator-panel">
        <ChannelCover
          compact
          imageURL={state.status === "ready" ? state.value.banner_url : ""}
        />
        <div className="creator-panel-body">
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
          <FollowButton
            channelID={video.channel_id}
            owner={me?.channel?.id === video.channel_id}
          />
        </div>
      </section>
      {next.length > 0 && (
        <section className="watch-next" aria-label="More from this channel">
          <div className="section-heading">
            <h2>More from this channel</h2>
            <Icon name="play" />
          </div>
          {next.map((item) => (
            <Link
              className="watch-next-item"
              key={item.id}
              href={`/watch?v=${item.id}`}
            >
              <span className="watch-next-poster">
                <img src={item.thumbnail_url} alt="" loading="lazy" />
                <small>{duration(item.duration_seconds)}</small>
              </span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.channel_title}</small>
              </span>
            </Link>
          ))}
        </section>
      )}
      <section className="peer-panel">
        <div className="peer-panel-icon">
          <Icon name="signal" />
        </div>
        <h2>Help other viewers</h2>
        <p className="muted">
          You can help other viewers load this video by enabling peer sharing.
        </p>
        <a href="#peer-sharing">
          Choose how you share
          <Icon name="arrow" />
        </a>
      </section>
    </aside>
  );
}
