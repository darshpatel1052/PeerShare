"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { duration, type Video, type VideosPage } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { useAuth } from "./auth-provider";
import { Avatar, Icon, LoadingState } from "./ui";

function VideoCard({
  item,
  featured = false,
}: {
  item: Video;
  featured?: boolean;
}) {
  return (
    <article className={featured ? "featured-video" : "video-card"}>
      <Link
        className="poster"
        href={`/watch?v=${item.id}`}
        aria-label={`Watch ${item.title}`}
      >
        <img src={item.thumbnail_url} alt={`Preview of ${item.title}`} />
        {featured && (
          <span className="poster-label">
            <span />
            Latest release
          </span>
        )}
        <span className="poster-play">
          <Icon name="play" />
        </span>
        <span className="duration">{duration(item.duration_seconds)}</span>
      </Link>
      <div className={featured ? "featured-info" : "video-info"}>
        {featured && <span className="eyebrow">On screen</span>}
        <h3>
          <Link href={`/watch?v=${item.id}`}>{item.title}</Link>
        </h3>
        <Link className="card-creator" href={`/channel?id=${item.channel_id}`}>
          <Avatar name={item.channel_title} />
          <span>
            {item.channel_title}
            <small>@{item.channel_handle}</small>
          </span>
        </Link>
        {featured && <p className="featured-description">{item.description}</p>}
        <div className="video-tags">
          {item.source_kind === "fixture" && (
            <span className="tag">Test film</span>
          )}
          {item.qualities.map((q) => (
            <span key={q} className="quality-tag">
              {q}p
            </span>
          ))}
        </div>
        {featured && (
          <Link className="button featured-watch" href={`/watch?v=${item.id}`}>
            <Icon name="play" />
            Watch video
            <Icon name="arrow" />
          </Link>
        )}
      </div>
    </article>
  );
}
export default function VideoList({
  channelID,
  featured = false,
  owner = false,
}: {
  channelID?: string;
  featured?: boolean;
  owner?: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [items, setItems] = useState<Video[]>([]);
  const [query, setQuery] = useState("");
  const { me } = useAuth();
  const params = new URLSearchParams({ limit: "12" });
  if (channelID) params.set("channel_id", channelID);
  if (cursor) params.set("cursor", cursor);
  const { state, retry } = useResource<VideosPage>(`/videos?${params}`);
  useEffect(() => {
    if (state.status === "ready")
      setItems((previous) =>
        cursor
          ? [
              ...previous,
              ...state.value.items.filter(
                (item) => !previous.some((old) => old.id === item.id),
              ),
            ]
          : state.value.items,
      );
  }, [state, cursor]);
  const matches = items.filter((item) =>
    `${item.title} ${item.channel_title} ${item.tags.join(" ")}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <section
      className="catalogue"
      aria-label="Published videos"
      aria-busy={state.status === "loading"}
    >
      {featured && (
        <div className="explore-heading">
          <div>
            <h1>
              Explore<span className="accent-dot">.</span>
            </h1>
            <p className="muted">Discover the latest from creators.</p>
          </div>
          <Link
            className="secondary-button"
            href={me?.channel ? `/channel?id=${me.channel.id}` : "/account"}
          >
            {me?.channel ? "Your channel" : "Create a channel"}
            <Icon name="arrow" />
          </Link>
        </div>
      )}
      {(featured || items.length > 0) && (
        <div className="catalogue-toolbar">
          <div className="catalogue-label">
            <Icon name="film" />
            <span>
              {query
                ? "Search results"
                : channelID
                  ? "All videos"
                  : "Latest videos"}
            </span>
            <span className="count-badge">
              {query ? matches.length : items.length}
            </span>
          </div>
          <div className="catalogue-search">
            <Icon name="search" />
            <input
              aria-label="Search loaded videos"
              placeholder="Search videos"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                className="icon-button"
                aria-label="Clear video search"
                onClick={() => setQuery("")}
              >
                <Icon name="close" />
              </button>
            )}
          </div>
        </div>
      )}
      {state.status === "loading" && (
        <LoadingState
          label={items.length ? "Loading more videos…" : "Loading videos…"}
        />
      )}
      {state.status === "error" && (
        <div className="error" role="alert" data-testid="catalogue-error">
          <p>{state.error.message}</p>
          <button onClick={retry}>Retry videos</button>
        </div>
      )}
      {state.status === "ready" && items.length === 0 && (
        <div className="empty-channel">
          <div className="empty-frame">
            <Icon name="film" />
            <span className="empty-frame-corner" />
          </div>
          <h2>No videos yet</h2>
          <p className="muted">
            {channelID
              ? "No videos have been published on this channel yet."
              : "There are no published videos to explore yet."}
          </p>
          {owner && (
            <p className="empty-hint">Publish your first video from Studio.</p>
          )}
          <Link className="secondary-button" href={owner ? "/studio" : "/"}>
            {owner ? "Upload a video" : "Back to explore"}
            <Icon name="arrow" />
          </Link>
        </div>
      )}
      {query && matches.length === 0 && items.length > 0 && (
        <div className="search-empty">
          <Icon name="search" />
          <h2>No matching videos</h2>
          <p className="muted">Try a different title, creator or tag.</p>
          <button className="text-button" onClick={() => setQuery("")}>
            Clear search
          </button>
        </div>
      )}
      {featured && matches[0] && <VideoCard item={matches[0]} featured />}
      <div className="video-grid">
        {(featured ? matches.slice(1) : matches).map((item) => (
          <VideoCard key={item.id} item={item} />
        ))}
      </div>
      {state.status === "ready" && state.value.next_cursor && (
        <button
          className="secondary-button"
          onClick={() => setCursor(state.value.next_cursor)}
        >
          Load more
          <Icon name="arrow" />
        </button>
      )}
      {query && state.status === "ready" && state.value.next_cursor && (
        <p className="search-scope muted">
          Search covers loaded videos. Load more to include the next page.
        </p>
      )}
    </section>
  );
}
