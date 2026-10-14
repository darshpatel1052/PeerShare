"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { duration, type Video, type VideosPage } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { useAuth } from "./auth-provider";
import { Avatar, Icon, LoadingState } from "./ui";
import { PlayerIcon } from "./player-icon";

export function VideoCard({
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
        <span className="poster-play" aria-hidden="true">
          <PlayerIcon name="play" />
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
            <PlayerIcon name="play" />
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
  following = false,
}: {
  channelID?: string;
  featured?: boolean;
  owner?: boolean;
  following?: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [collection, setCollection] = useState<{
    scope: string;
    items: Video[];
  }>({ scope: "", items: [] });
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const scope = `${channelID ?? "all"}:${following}:${search}`;
  const items = collection.scope === scope ? collection.items : [];
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setCursor(null);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  const { me } = useAuth();
  const params = new URLSearchParams({ limit: "12" });
  if (channelID) params.set("channel_id", channelID);
  if (cursor) params.set("cursor", cursor);
  if (search) params.set("q", search);
  if (following) params.set("feed", "following");
  const { state, retry } = useResource<VideosPage>(`/videos?${params}`);
  useEffect(() => {
    if (state.status !== "ready") return;
    setCollection((previous) => {
      const old = previous.scope === scope ? previous.items : [];
      return {
        scope,
        items: cursor
          ? [
              ...old,
              ...state.value.items.filter(
                (item) => !old.some((value) => value.id === item.id),
              ),
            ]
          : state.value.items,
      };
    });
  }, [state, cursor, scope]);
  const matches = items;
  return (
    <section
      className="catalogue"
      aria-label="Published videos"
      aria-busy={state.status === "loading"}
    >
      {(featured || following) && (
        <div className="explore-heading">
          <div>
            <h1>
              {following ? "Following" : "Explore"}
              <span className="accent-dot">.</span>
            </h1>
            <p className="muted">
              {following
                ? "The latest from channels you follow."
                : "Discover the latest from creators."}
            </p>
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
      <>
        <div className="catalogue-toolbar">
          <div className="catalogue-label">
            <Icon name="film" />
            <span>
              {query
                ? "Search results"
                : following
                  ? "Following"
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
              aria-label="Search videos"
              maxLength={120}
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
      </>
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
      {state.status === "ready" && items.length === 0 && !search && (
        <div className="empty-channel">
          <div className="empty-frame">
            <Icon name="film" />
            <span className="empty-frame-corner" />
          </div>
          <h2>No videos yet</h2>
          <p className="muted">
            {channelID
              ? "No videos have been published on this channel yet."
              : following
                ? "Follow channels to see their latest videos here."
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
      {search && state.status === "ready" && matches.length === 0 && (
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
    </section>
  );
}
